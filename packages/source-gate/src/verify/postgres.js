const RELATIONS_SQL = `
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       has_table_privilege(c.oid, 'SELECT') AS can_select,
       has_table_privilege(c.oid, 'INSERT') AS can_insert,
       has_table_privilege(c.oid, 'UPDATE') AS can_update,
       has_table_privilege(c.oid, 'DELETE') AS can_delete,
       has_table_privilege(c.oid, 'TRUNCATE') AS can_truncate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
`;

const ROLE_SQL = `
SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
FROM pg_roles r
WHERE r.rolname = current_user
`;

export async function verifyPostgres(pool, source) {
  const exposed = new Set(source.exposedObjects ?? []);
  const role = (await pool.query(ROLE_SQL)).rows[0];
  const readOnly = (await pool.query('SHOW default_transaction_read_only')).rows[0]
    ?.default_transaction_read_only;
  const relations = (await pool.query(RELATIONS_SQL)).rows;
  const dmlGrants = [];
  const selectable = [];
  for (const row of relations) {
    const name = `${row.schema_name}.${row.relation_name}`;
    for (const [flag, label] of [
      ['can_insert', 'INSERT'],
      ['can_update', 'UPDATE'],
      ['can_delete', 'DELETE'],
      ['can_truncate', 'TRUNCATE']
    ]) {
      if (row[flag]) dmlGrants.push(`${label} ${name}`);
    }
    if (row.can_select) selectable.push(name);
  }
  const extraResources = selectable.filter(
    (name) => !name.startsWith('ai_export.') || !exposed.has(name)
  );
  const missingObjects = [...exposed].filter((name) => !selectable.includes(name));
  const elevated = ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']
    .filter((flag) => role?.[flag])
    .sort();
  const failed =
    elevated.length > 0 ||
    readOnly !== 'on' ||
    dmlGrants.length > 0 ||
    extraResources.length > 0 ||
    missingObjects.length > 0;
  return {
    ok: !failed,
    status: failed ? 'fail' : 'ok',
    authEnforced: true,
    details: {
      engine: 'postgres',
      user: role?.rolname ?? null,
      elevatedAttributes: elevated,
      defaultTransactionReadOnly: readOnly === 'on',
      dmlGrants: dmlGrants.sort(),
      extraResources: extraResources.sort(),
      missingObjects: missingObjects.sort()
    }
  };
}
