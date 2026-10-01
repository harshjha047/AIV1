import { assertViewSpecClean } from '@fab5/shared/pii';
import { sha256, stableStringify } from './canonical.js';
import { buildMongoPipeline, collectPipelineFields, projectionIsInclusionOnly } from './compile.js';
import { disableEnableCommands } from './commands.js';
import { PipelineLeakError, SampleCheckError, ViewsSpecError } from './errors.js';
import {
  mongoCollections,
  mongoIndexSpecs,
  mongoViewDefinitions,
  renderCreateViews,
  renderMongoDisable,
  renderMongoEnable,
  renderMongoExportLive,
  renderMongoIndexes,
  renderMongoVerify
} from './mongoScripts.js';
import {
  assertSelectClean,
  postgresIndexSpecs,
  postgresViewDefinitions,
  renderPostgresCreate,
  renderPostgresDisable,
  renderPostgresEnable,
  renderPostgresExportLive,
  renderPostgresIndexes,
  renderPostgresVerify
} from './postgresScripts.js';
import { checkViewAgainstSamples } from './samples.js';
import { matchDeniedKey } from '@fab5/shared/pii';

function assertPipelineClean(view) {
  const pipeline = buildMongoPipeline(view.allowList);
  const fields = collectPipelineFields(pipeline);
  const leaks = [];
  for (const field of fields) {
    const rule = matchDeniedKey(field);
    if (rule) leaks.push({ view: view.name, field, rule });
  }
  for (const problem of projectionIsInclusionOnly(pipeline)) leaks.push({ view: view.name, field: problem, rule: 'not_inclusion_only' });
  if (leaks.length > 0) throw new PipelineLeakError(leaks);
}

export function validateSpec(spec) {
  for (const view of spec.views) assertViewSpecClean(view.allowList);
  if (spec.engine === 'mongodb') for (const view of spec.views) assertPipelineClean(view);
  else for (const view of spec.views) assertSelectClean(view);
}

export function verifySamples(spec, samples, { allowUnverified = false } = {}) {
  const warnings = [];
  if (spec.engine !== 'mongodb') {
    warnings.push({ kind: 'samples_not_applicable', engine: spec.engine });
    return { problems: [], warnings, verified: false };
  }
  if (!samples) {
    if (allowUnverified || spec.status === 'draft') {
      warnings.push({ kind: 'unverified', status: spec.status });
      return { problems: [], warnings, verified: false };
    }
    throw new ViewsSpecError(`Sample documents required for ${spec.sourceId}`, 'SAMPLES_REQUIRED', {
      sourceId: spec.sourceId
    });
  }
  const problems = [];
  for (const view of spec.views) problems.push(...checkViewAgainstSamples(view.name, view.allowList, samples));
  return { problems, warnings, verified: true };
}

export function generateSource(spec, { database = spec.database, samples, allowUnverified = false } = {}) {
  validateSpec(spec);
  const sampleResult = verifySamples(spec, samples, { allowUnverified });
  if (sampleResult.problems.length > 0) throw new SampleCheckError(sampleResult.problems);
  const files = {};
  let definitions;
  if (spec.engine === 'mongodb') {
    definitions = mongoViewDefinitions(spec);
    files['create-views.js'] = renderCreateViews(spec, database);
    files['indexes.js'] = renderMongoIndexes(spec, database);
    files['disable.js'] = renderMongoDisable(spec, database);
    files['enable.js'] = renderMongoEnable(spec, database);
    files['verify.js'] = renderMongoVerify(spec, database);
    files['export-live.js'] = renderMongoExportLive(database);
  } else {
    definitions = postgresViewDefinitions(spec);
    files['create-views.sql'] = renderPostgresCreate(spec);
    files['indexes.sql'] = renderPostgresIndexes(spec);
    files['disable.sql'] = renderPostgresDisable(spec);
    files['enable.sql'] = renderPostgresEnable(spec);
    files['verify.sql'] = renderPostgresVerify(spec);
    files['export-live.sql'] = renderPostgresExportLive(spec);
  }
  const specHash = sha256(definitions);
  const manifest = {
    sourceId: spec.sourceId,
    engine: spec.engine,
    status: spec.status,
    specVersion: spec.specVersion,
    specHash,
    database,
    role: spec.roleName,
    user: spec.userName,
    views: definitions.map((definition) => definition.name),
    collections: spec.engine === 'mongodb' ? mongoCollections(spec) : [],
    indexes: spec.engine === 'mongodb' ? mongoIndexSpecs(spec).length : postgresIndexSpecs(spec).length,
    verified: sampleResult.verified,
    commands: disableEnableCommands(spec, database)
  };
  files['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { files, manifest, warnings: sampleResult.warnings };
}

export function specDigest(spec) {
  return sha256(stableStringify(spec.engine === 'mongodb' ? mongoViewDefinitions(spec) : postgresViewDefinitions(spec)));
}
