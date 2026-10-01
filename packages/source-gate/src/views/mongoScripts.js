import { toLiteral } from './canonical.js';
import { buildMongoPipeline } from './compile.js';

export const DEFAULT_COLLECTION_INDEX = Object.freeze({ keys: { updatedAt: 1, _id: 1 }, name: 'ai_updatedAt_id' });

export function mongoViewDefinitions(spec) {
  return spec.views.map((view) => ({
    name: view.name,
    viewOn: view.allowList.collection,
    pipeline: buildMongoPipeline(view.allowList)
  }));
}

export function mongoCollections(spec) {
  return [...new Set(spec.views.map((view) => view.allowList.collection))].sort();
}

export function renderCreateViews(spec, database) {
  const definitions = mongoViewDefinitions(spec);
  const lines = [];
  lines.push(`const target = db.getSiblingDB(${toLiteral(database)});`);
  lines.push('const existing = target.getCollectionNames();');
  lines.push(
    'const upsertView = (name, viewOn, pipeline) => existing.includes(name) ? target.runCommand({ collMod: name, viewOn, pipeline }) : target.createView(name, viewOn, pipeline);'
  );
  for (const definition of definitions) {
    lines.push(
      `upsertView(${toLiteral(definition.name)}, ${toLiteral(definition.viewOn)}, ${toLiteral(definition.pipeline)});`
    );
  }
  const privileges = definitions.map((definition) => ({
    resource: { db: database, collection: definition.name },
    actions: ['find']
  }));
  lines.push(`const privileges = ${toLiteral(privileges)};`);
  lines.push(
    `if (target.getRole(${toLiteral(spec.roleName)})) target.updateRole(${toLiteral(spec.roleName)}, { privileges, roles: [] });`
  );
  lines.push(`else target.createRole({ role: ${toLiteral(spec.roleName)}, privileges, roles: [] });`);
  lines.push(
    `if (!target.getUser(${toLiteral(spec.userName)})) target.createUser({ user: ${toLiteral(spec.userName)}, pwd: passwordPrompt(), roles: [${toLiteral(spec.roleName)}] });`
  );
  lines.push(
    `else target.grantRolesToUser(${toLiteral(spec.userName)}, [${toLiteral(spec.roleName)}]);`
  );
  return `${lines.join('\n')}\n`;
}

export function mongoIndexSpecs(spec) {
  const result = [];
  for (const collection of mongoCollections(spec)) {
    result.push({ collection, ...DEFAULT_COLLECTION_INDEX });
    for (const extra of spec.indexes[collection] ?? []) result.push({ collection, ...extra });
  }
  return result;
}

export function renderMongoIndexes(spec, database) {
  const lines = [`const target = db.getSiblingDB(${toLiteral(database)});`];
  for (const index of mongoIndexSpecs(spec)) {
    lines.push(
      `target.getCollection(${toLiteral(index.collection)}).createIndex(${toLiteral(index.keys)}, { name: ${toLiteral(index.name)} });`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderMongoDisable(spec, database) {
  return `db.getSiblingDB(${toLiteral(database)}).revokeRolesFromUser(${toLiteral(spec.userName)}, [${toLiteral(spec.roleName)}]);\n`;
}

export function renderMongoEnable(spec, database) {
  return `db.getSiblingDB(${toLiteral(database)}).grantRolesToUser(${toLiteral(spec.userName)}, [${toLiteral(spec.roleName)}]);\n`;
}

export function renderMongoVerify(spec, database) {
  const definitions = mongoViewDefinitions(spec);
  const views = definitions.map((definition) => definition.name);
  const bases = mongoCollections(spec);
  return `${[
    `const target = db.getSiblingDB(${toLiteral(database)});`,
    `const views = ${toLiteral(views)};`,
    `const bases = ${toLiteral(bases)};`,
    'const report = { views: {}, bases: {}, ok: true };',
    'for (const name of views) {',
    '  try {',
    '    report.views[name] = target.getCollection(name).find({}).limit(1).toArray().length >= 0 ? "readable" : "empty";',
    '  } catch (error) {',
    '    report.views[name] = `error:${error.code ?? error.message}`;',
    '    report.ok = false;',
    '  }',
    '}',
    'for (const name of bases) {',
    '  try {',
    '    target.getCollection(name).find({}).limit(1).toArray();',
    '    report.bases[name] = "READABLE";',
    '    report.ok = false;',
    '  } catch (error) {',
    '    report.bases[name] = error.code === 13 ? "denied" : `error:${error.code ?? error.message}`;',
    '    if (error.code !== 13) report.ok = false;',
    '  }',
    '}',
    'print(JSON.stringify(report));',
    'if (!report.ok) quit(1);'
  ].join('\n')}\n`;
}

export function renderMongoExportLive(database) {
  return `${[
    `const target = db.getSiblingDB(${toLiteral(database)});`,
    'const infos = target.getCollectionInfos({ type: "view" });',
    'print(JSON.stringify(infos.map((info) => ({ name: info.name, viewOn: info.options.viewOn, pipeline: info.options.pipeline }))));'
  ].join('\n')}\n`;
}
