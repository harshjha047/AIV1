import { matchDeniedKey } from '@fab5/shared/pii';
import { ViewsSpecError } from './errors.js';

const SCALAR_EXTRACTION = /^[A-Za-z_]+\.[A-Za-z_]+->>'[A-Za-z_]+'$/;

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

export function selectSql(view) {
  const { columns, from } = view.select;
  const list = Object.entries(columns).map(([name, expression]) => `${expression} AS ${quote(name)}`);
  return `SELECT ${list.join(',\n       ')}\nFROM ${from}`;
}

export function assertSelectClean(view) {
  const hidden = new Set((view.allowList.neverExported ?? []).map((name) => name.toLowerCase()));
  const leaks = [];
  for (const expression of Object.values(view.select.columns)) {
    const scalarExtraction = SCALAR_EXTRACTION.test(expression.trim());
    for (const raw of new Set(expression.split(/[^A-Za-z0-9_]+/).filter(Boolean))) {
      const token = raw.toLowerCase();
      if (hidden.has(token) && !scalarExtraction) leaks.push({ view: view.name, token, rule: 'never_exported' });
      const rule = matchDeniedKey(token);
      if (rule) leaks.push({ view: view.name, token, rule });
    }
  }
  if (/\bselect\s+\*/i.test(selectSql(view)) || Object.values(view.select.columns).some((value) => value.trim() === '*')) {
    leaks.push({ view: view.name, token: '*', rule: 'wildcard' });
  }
  if (leaks.length > 0) throw new ViewsSpecError('Postgres select references denied columns', 'SELECT_LEAK', { leaks });
}

export function postgresViewDefinitions(spec) {
  return spec.views.map((view) => ({
    name: view.name,
    columns: Object.keys(view.select.columns),
    sql: selectSql(view)
  }));
}

export function renderPostgresCreate(spec) {
  const { schema, userName } = spec;
  const lines = ['\\set ON_ERROR_STOP on', 'BEGIN;', `CREATE SCHEMA IF NOT EXISTS ${schema};`];
  for (const definition of postgresViewDefinitions(spec)) {
    lines.push(`DROP VIEW IF EXISTS ${schema}.${definition.name};`);
    lines.push(`CREATE VIEW ${schema}.${definition.name} AS\n${definition.sql};`);
  }
  lines.push(
    `SELECT 'CREATE ROLE ${userName} LOGIN NOINHERIT' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${userName}') \\gexec`
  );
  lines.push(`ALTER ROLE ${userName} SET default_transaction_read_only = on;`);
  lines.push(`ALTER ROLE ${userName} SET statement_timeout = '30s';`);
  lines.push(`SELECT format('GRANT CONNECT ON DATABASE %I TO ${userName}', current_database()) \\gexec`);
  lines.push(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${userName};`);
  lines.push(`GRANT USAGE ON SCHEMA ${schema} TO ${userName};`);
  lines.push(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${userName};`);
  for (const definition of postgresViewDefinitions(spec)) {
    lines.push(`GRANT SELECT ON ${schema}.${definition.name} TO ${userName};`);
  }
  lines.push('COMMIT;');
  lines.push(`\\password ${userName}`);
  return `${lines.join('\n')}\n`;
}

export function postgresIndexSpecs(spec) {
  return spec.indexes.tables ?? [];
}

export function renderPostgresIndexes(spec) {
  const lines = postgresIndexSpecs(spec).map(
    (index) => `CREATE INDEX IF NOT EXISTS ${index.name} ON ${index.table} (${index.columns.join(', ')});`
  );
  return `${lines.join('\n')}\n`;
}

export function renderPostgresDisable(spec) {
  return `ALTER ROLE ${spec.userName} NOLOGIN;\nSELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${spec.userName}';\n`;
}

export function renderPostgresEnable(spec) {
  return `ALTER ROLE ${spec.userName} LOGIN;\n`;
}

export function renderPostgresVerify(spec) {
  const first = spec.views[0]?.name;
  const lines = [
    '\\set ON_ERROR_STOP off',
    `SELECT current_user, current_setting('default_transaction_read_only') AS read_only;`,
    ...spec.views.map((view) => `SELECT count(*) AS ${view.name}_rows FROM (SELECT 1 FROM ${spec.schema}.${view.name} LIMIT 1) sample;`),
    'SELECT * FROM users LIMIT 1;',
    `SELECT has_table_privilege('${spec.userName}', 'public.users', 'SELECT') AS base_select;`,
    `SELECT has_schema_privilege('${spec.userName}', '${spec.schema}', 'USAGE') AS schema_usage;`,
    first ? `SELECT has_table_privilege('${spec.userName}', '${spec.schema}.${first}', 'INSERT') AS view_insert;` : ''
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

export function renderPostgresExportLive(spec) {
  return `${[
    '\\pset tuples_only on',
    '\\pset format unaligned',
    `SELECT coalesce(json_agg(json_build_object('name', v.table_name, 'columns', (SELECT json_agg(c.column_name ORDER BY c.ordinal_position) FROM information_schema.columns c WHERE c.table_schema = v.table_schema AND c.table_name = v.table_name)) ORDER BY v.table_name), '[]'::json) FROM information_schema.views v WHERE v.table_schema = '${spec.schema}';`
  ].join('\n')}\n`;
}
