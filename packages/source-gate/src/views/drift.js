import { stableStringify } from './canonical.js';
import { mongoViewDefinitions } from './mongoScripts.js';
import { postgresViewDefinitions } from './postgresScripts.js';

const AI_PREFIXES = ['ai_'];

function isManaged(name, spec) {
  if (spec.engine === 'mongodb') return AI_PREFIXES.some((prefix) => name.startsWith(prefix));
  return true;
}

export function detectMongoDrift(spec, live) {
  const drift = [];
  const byName = new Map(live.map((view) => [view.name, view]));
  for (const expected of mongoViewDefinitions(spec)) {
    const actual = byName.get(expected.name);
    if (!actual) {
      drift.push({ view: expected.name, kind: 'missing' });
      continue;
    }
    if (actual.viewOn !== expected.viewOn) {
      drift.push({ view: expected.name, kind: 'source_changed', expected: expected.viewOn, actual: actual.viewOn });
    }
    if (stableStringify(actual.pipeline) !== stableStringify(expected.pipeline)) {
      drift.push({ view: expected.name, kind: 'pipeline_changed' });
    }
  }
  const expectedNames = new Set(spec.views.map((view) => view.name));
  for (const view of live) {
    if (!expectedNames.has(view.name) && isManaged(view.name, spec)) {
      drift.push({ view: view.name, kind: 'unexpected' });
    }
  }
  return drift;
}

export function detectPostgresDrift(spec, live) {
  const drift = [];
  const byName = new Map(live.map((view) => [view.name, view]));
  for (const expected of postgresViewDefinitions(spec)) {
    const actual = byName.get(expected.name);
    if (!actual) {
      drift.push({ view: expected.name, kind: 'missing' });
      continue;
    }
    if (JSON.stringify(actual.columns ?? []) !== JSON.stringify(expected.columns)) {
      drift.push({
        view: expected.name,
        kind: 'columns_changed',
        expected: expected.columns,
        actual: actual.columns ?? []
      });
    }
  }
  const expectedNames = new Set(spec.views.map((view) => view.name));
  for (const view of live) {
    if (!expectedNames.has(view.name)) drift.push({ view: view.name, kind: 'unexpected' });
  }
  return drift;
}

export function detectDrift(spec, live) {
  if (!Array.isArray(live)) return [{ view: '*', kind: 'live_unreadable' }];
  return spec.engine === 'mongodb' ? detectMongoDrift(spec, live) : detectPostgresDrift(spec, live);
}

export function detectArtifactDrift(expectedFiles, existingFiles) {
  const drift = [];
  for (const [name, content] of Object.entries(expectedFiles)) {
    if (!(name in existingFiles)) drift.push({ view: name, kind: 'artifact_missing' });
    else if (existingFiles[name] !== content) drift.push({ view: name, kind: 'artifact_stale' });
  }
  return drift;
}
