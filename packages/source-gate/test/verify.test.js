import { describe, expect, it } from 'vitest';
import { verifyMongo } from '../src/verify/mongo.js';
import { verifyPostgres } from '../src/verify/postgres.js';
import { createVerifier } from '../src/verify/verifier.js';
import { createHarness, sourceDoc } from './helpers.js';

const VIEWS = ['ai_users_v', 'ai_connections_v'];

function mongoClient({ users = [{ user: 'ai_ro', db: 'crm' }], privileges }) {
  const commands = [];
  return {
    commands,
    db: (name) => ({
      command: async (command) => {
        commands.push({ db: name, command });
        return {
          authInfo: {
            authenticatedUsers: users,
            authenticatedUserPrivileges:
              privileges ??
              VIEWS.map((collection) => ({ resource: { db: 'crm', collection }, actions: ['find'] }))
          },
          ok: 1
        };
      }
    })
  };
}

const source = (overrides = {}) => sourceDoc({ exposedObjects: VIEWS, ...overrides });

describe('mongo read-only verification', () => {
  it('passes for find on exactly the exposed views', async () => {
    const client = mongoClient({});
    const result = await verifyMongo(client, source());
    expect(result).toMatchObject({ ok: true, status: 'ok', authEnforced: true });
    expect(result.details.grantedViews).toEqual([...VIEWS].sort());
  });

  it('never issues anything but connectionStatus', async () => {
    const client = mongoClient({});
    await verifyMongo(client, source());
    expect(client.commands).toEqual([
      { db: 'admin', command: { connectionStatus: 1, showPrivileges: true } }
    ]);
  });

  it('fails on a seeded write privilege', async () => {
    const client = mongoClient({
      privileges: [
        { resource: { db: 'crm', collection: 'ai_users_v' }, actions: ['find', 'insert'] },
        { resource: { db: 'crm', collection: 'ai_connections_v' }, actions: ['find'] }
      ]
    });
    const result = await verifyMongo(client, source());
    expect(result.status).toBe('fail');
    expect(result.details.writeActions).toEqual(['insert']);
  });

  it('fails on an extra resource, including base collections', async () => {
    const client = mongoClient({
      privileges: [
        ...VIEWS.map((collection) => ({ resource: { db: 'crm', collection }, actions: ['find'] })),
        { resource: { db: 'crm', collection: 'users' }, actions: ['find'] }
      ]
    });
    const result = await verifyMongo(client, source());
    expect(result.status).toBe('fail');
    expect(result.details.extraResources).toEqual(['crm.users']);
  });

  it('fails on database-wide, cluster and any-resource grants', async () => {
    for (const resource of [{ db: 'crm', collection: '' }, { cluster: true }, { anyResource: true }]) {
      const client = mongoClient({ privileges: [{ resource, actions: ['find'] }] });
      const result = await verifyMongo(client, source());
      expect(result.status).toBe('fail');
    }
  });

  it('fails when an exposed view is not granted', async () => {
    const client = mongoClient({
      privileges: [{ resource: { db: 'crm', collection: 'ai_users_v' }, actions: ['find'] }]
    });
    const result = await verifyMongo(client, source());
    expect(result.status).toBe('fail');
    expect(result.details.missingObjects).toEqual(['ai_connections_v']);
  });

  it('warns with authEnforced=false when no user is authenticated', async () => {
    const client = mongoClient({ users: [] });
    expect(await verifyMongo(client, source())).toMatchObject({
      ok: true,
      status: 'warn',
      authEnforced: false
    });
  });
});

function pgPool({
  role = {},
  readOnly = 'on',
  relations
}) {
  const queries = [];
  const base = ['employees_v', 'tickets_v'].map((name) => ({
    schema_name: 'ai_export',
    relation_name: name,
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false
  }));
  return {
    queries,
    query: async (text) => {
      queries.push(text.trim());
      if (/FROM pg_roles/.test(text)) {
        return {
          rows: [
            {
              rolname: 'ai_ro',
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolreplication: false,
              rolbypassrls: false,
              ...role
            }
          ]
        };
      }
      if (/SHOW default_transaction_read_only/.test(text)) {
        return { rows: [{ default_transaction_read_only: readOnly }] };
      }
      return { rows: relations ?? base };
    }
  };
}

const pgSource = () =>
  sourceDoc({
    _id: 'samadhan',
    engine: 'postgres',
    exposedObjects: ['ai_export.employees_v', 'ai_export.tickets_v']
  });

const relation = (schema, name, flags = {}) => ({
  schema_name: schema,
  relation_name: name,
  can_select: true,
  can_insert: false,
  can_update: false,
  can_delete: false,
  can_truncate: false,
  ...flags
});

describe('postgres read-only verification', () => {
  it('passes for a read-only role limited to ai_export views', async () => {
    const result = await verifyPostgres(pgPool({}), pgSource());
    expect(result).toMatchObject({ ok: true, status: 'ok', authEnforced: true });
  });

  it('only runs SELECT and SHOW statements', async () => {
    const pool = pgPool({});
    await verifyPostgres(pool, pgSource());
    expect(pool.queries.every((q) => /^(SELECT|SHOW)\b/i.test(q))).toBe(true);
  });

  it('fails for a superuser', async () => {
    const result = await verifyPostgres(pgPool({ role: { rolsuper: true } }), pgSource());
    expect(result.status).toBe('fail');
    expect(result.details.elevatedAttributes).toEqual(['rolsuper']);
  });

  it('fails when default_transaction_read_only is off', async () => {
    const result = await verifyPostgres(pgPool({ readOnly: 'off' }), pgSource());
    expect(result.status).toBe('fail');
    expect(result.details.defaultTransactionReadOnly).toBe(false);
  });

  it.each(['can_insert', 'can_update', 'can_delete', 'can_truncate'])(
    'fails on a seeded %s grant',
    async (flag) => {
      const relations = [
        relation('ai_export', 'employees_v'),
        relation('ai_export', 'tickets_v', { [flag]: true })
      ];
      const result = await verifyPostgres(pgPool({ relations }), pgSource());
      expect(result.status).toBe('fail');
      expect(result.details.dmlGrants).toHaveLength(1);
    }
  );

  it('fails when a base table is selectable', async () => {
    const relations = [
      relation('ai_export', 'employees_v'),
      relation('ai_export', 'tickets_v'),
      relation('public', 'users')
    ];
    const result = await verifyPostgres(pgPool({ relations }), pgSource());
    expect(result.status).toBe('fail');
    expect(result.details.extraResources).toEqual(['public.users']);
  });

  it('fails when an exposed view is missing', async () => {
    const result = await verifyPostgres(
      pgPool({ relations: [relation('ai_export', 'employees_v')] }),
      pgSource()
    );
    expect(result.status).toBe('fail');
    expect(result.details.missingObjects).toEqual(['ai_export.tickets_v']);
  });
});

describe('verifier', () => {
  function build(sourceOverrides, client) {
    const h = createHarness({ sources: [source(sourceOverrides)] });
    h.engine.connect = async () => client;
    h.engine.close = async () => {};
    const verifier = createVerifier({
      gate: h.gate,
      store: h.store,
      registry: h.registry,
      clock: h.clock,
      activity: { emit: async (event) => h.activityRows.push(event) },
      monotonic: h.clock.monotonic
    });
    return { h, verifier };
  }

  it('stores the result on the source with a timestamp', async () => {
    const { h, verifier } = build({ state: 'paused' }, mongoClient({}));
    const result = await verifier.run('crm', { triggeredBy: 'manual' });
    expect(result.status).toBe('ok');
    expect(h.store.docs.get('crm').readOnlyCheck).toMatchObject({ status: 'ok', authEnforced: true });
    expect(h.store.docs.get('crm').readOnlyCheck.checkedAt).toBeInstanceOf(Date);
    expect(h.activityRows.at(-1)).toMatchObject({ kind: 'verify', action: 'readonly_ok' });
    expect(h.accessRows.find((row) => row.action === 'verify')).toMatchObject({ ok: true });
  });

  it('records auth-disabled as warn with authEnforced=false', async () => {
    const { h, verifier } = build({ state: 'paused' }, mongoClient({ users: [] }));
    await verifier.run('crm');
    expect(h.store.docs.get('crm').readOnlyCheck).toMatchObject({
      status: 'warn',
      authEnforced: false
    });
    expect(h.activityRows.at(-1).level).toBe('warn');
  });

  it('converts connection errors into a redacted failure', async () => {
    const h = createHarness({ sources: [source({ state: 'paused' })] });
    h.engine.failConnect = true;
    const verifier = createVerifier({
      gate: h.gate,
      store: h.store,
      registry: h.registry,
      clock: h.clock,
      monotonic: h.clock.monotonic
    });
    const result = await verifier.run('crm');
    expect(result.status).toBe('fail');
    expect(JSON.stringify(result)).not.toContain('u:p@h');
    expect(JSON.stringify(h.accessRows)).not.toContain('u:p@h');
  });

  it('does not expose credentials in stored details', async () => {
    const { h, verifier } = build({ state: 'paused' }, mongoClient({}));
    await verifier.run('crm');
    expect(JSON.stringify(h.store.docs.get('crm'))).not.toMatch(/mongodb:\/\/|pw@/);
  });
});
