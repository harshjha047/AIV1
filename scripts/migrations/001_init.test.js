import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  INDEX_SPECS,
  ensureCollections,
  ensureIndexes,
  getMigrationStatus,
  openSnapshotDb,
  resolveLlmTextStore,
  runMigrations,
} from '@fab5/snapshot-db';
import { migrations } from './index.js';

process.env.MONGOMS_VERSION ??= '7.0.14';

const skip = process.env.SKIP_MONGO_TESTS === '1';
const now = new Date('2026-10-01T10:00:00Z');

const employee = (overrides = {}) => ({
  _id: 'emp_01J9ZK3M8Q',
  email: 'employee@example.com',
  name: 'Example Employee',
  active: true,
  aiRole: 'employee',
  sources: { crmUserId: '6650f1' },
  ...overrides,
});

const rejects = async (promise, code) => {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error).not.toBeNull();
  expect(error.code).toBe(code);
};

describe.skipIf(skip)('001_init on a real MongoDB', { timeout: 120000 }, () => {
  let server;
  let connection;
  let db;
  let result;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await openSnapshotDb({ uri: `${server.getUri()}ai_snapshot` });
    db = connection.db;
    result = await runMigrations(db, migrations, {
      now: () => now,
      context: { mode: 'practice' },
    });
  }, 300000);

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  it('applies 001_init on a fresh database', () => {
    expect(result.ran.map((r) => r.id)).toEqual(['001_init']);
    expect(result.schemaVersion).toBe(1);
  });

  it('creates every collection of the schema', async () => {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    for (const name of COLLECTIONS) expect(names).toContain(name);
    expect(names).toContain('schema_migrations');
  });

  it('attaches moderate/error validators to curated and runtime collections', async () => {
    const info = await db.listCollections({ name: 'employees' }).toArray();
    expect(info[0].options.validationLevel).toBe('moderate');
    expect(info[0].options.validationAction).toBe('error');
    expect(info[0].options.validator.$jsonSchema.required).toContain('aiRole');
  });

  it('creates every index with its options', async () => {
    const textStore = await resolveLlmTextStore(db);
    for (const spec of INDEX_SPECS) {
      if (spec.optional && textStore !== 'llm_usage_events') continue;
      const live = await db.collection(spec.collection).indexes();
      const found = live.find((index) => index.name === spec.options.name);
      expect(found, `${spec.collection}.${spec.options.name}`).toBeDefined();
      expect(found.unique === true).toBe(spec.options.unique === true);
      expect(found.sparse === true).toBe(spec.options.sparse === true);
      expect(found.expireAfterSeconds).toBe(spec.options.expireAfterSeconds);
      expect(found.partialFilterExpression).toEqual(spec.options.partialFilterExpression);
    }
  });

  it('provides a TTL-backed store for text logging', async () => {
    const store = await resolveLlmTextStore(db);
    const indexes = await db.collection(store).indexes();
    expect(indexes.some((index) => index.expireAfterSeconds === 604800)).toBe(true);
  });

  it('seeds meta singletons and records the schema version', async () => {
    const meta = await db.collection('meta').find({}).sort({ _id: 1 }).toArray();
    expect(meta.map((m) => m._id)).toEqual(['embedding', 'flags', 'guard', 'mode', 'snapshot']);
    expect(meta.find((m) => m._id === 'snapshot').schemaVersion).toBe(1);
    expect(meta.find((m) => m._id === 'mode')).toMatchObject({
      mode: 'practice',
      referenceAuto: true,
    });
    expect(meta.find((m) => m._id === 'embedding').dim).toBe(768);
    const applied = await db.collection('schema_migrations').findOne({ _id: '001_init' });
    expect(applied.version).toBe(1);
  });

  it('is idempotent and never overwrites seeded meta', async () => {
    await db.collection('meta').updateOne({ _id: 'guard' }, { $set: { state: 'paused_large' } });
    const again = await runMigrations(db, migrations, { now: () => now });
    expect(again.ran).toEqual([]);
    await ensureCollections(db);
    await ensureIndexes(db);
    const guard = await db.collection('meta').findOne({ _id: 'guard' });
    expect(guard.state).toBe('paused_large');
    expect(await getMigrationStatus(db, migrations)).toEqual({
      applied: ['001_init'],
      pending: [],
      schemaVersion: 1,
    });
  });

  it('enforces validators with error 121', async () => {
    const employees = db.collection('employees');
    await rejects(employees.insertOne(employee({ _id: 'bad', aiRole: 'superuser' })), 121);
    await rejects(employees.insertOne(employee({ email: 'nope' })), 121);
    await rejects(employees.insertOne(employee({ sources: { invoicingUserId: null } })), 121);
    await rejects(db.collection('data_sources').insertOne({ _id: 'x', state: 'weird' }), 121);
    await rejects(
      db.collection('ai_clients').insertOne({
        _id: 'crm',
        name: 'CRM',
        keyHash: 'plain',
        enabled: true,
        createdAt: now,
      }),
      121,
    );
    await employees.insertOne(employee());
    await employees.deleteOne({ _id: 'emp_01J9ZK3M8Q' });
  });

  it('enforces unique and sparse unique indexes', async () => {
    const employees = db.collection('employees');
    await employees.insertOne(employee({ _id: 'emp_A', email: 'a@example.com', sources: {} }));
    await employees.insertOne(employee({ _id: 'emp_B', email: 'b@example.com', sources: {} }));
    await rejects(
      employees.insertOne(employee({ _id: 'emp_C', email: 'a@example.com', sources: {} })),
      11000,
    );
    await employees.insertOne(
      employee({ _id: 'emp_D', email: 'd@example.com', sources: { crmUserId: 'x1' } }),
    );
    await rejects(
      employees.insertOne(
        employee({ _id: 'emp_E', email: 'e@example.com', sources: { crmUserId: 'x1' } }),
      ),
      11000,
    );
    await db.collection('fact_tickets').insertOne({ _id: 'samadhan:1', ticketNo: 'T-1' });
    await rejects(
      db.collection('fact_tickets').insertOne({ _id: 'samadhan:2', ticketNo: 'T-1' }),
      11000,
    );
    await db.collection('embeddings').insertOne({ _id: 'c1:m', refId: 'c1', model: 'm' });
    await rejects(
      db.collection('embeddings').insertOne({ _id: 'c1:m2', refId: 'c1', model: 'm' }),
      11000,
    );
  });

  it('accepts the documented example documents', async () => {
    await db.collection('data_sources').insertOne({
      _id: 'crm',
      displayName: 'CRM (MongoDB)',
      engine: 'mongodb',
      kind: 'real',
      logicalSource: 'crm',
      mode: 'practice',
      state: 'active',
      onDisable: 'hide',
      exposedObjects: ['ai_connections_v'],
      credentialRef: 'env:SRC_CRM_URI',
      limits: { pageSize: 500, maxTimeMs: 30000, rowsPerMin: 20000 },
      readOnlyCheck: {
        ok: true,
        status: 'ok',
        checkedAt: now,
        details: 'find only',
        authEnforced: true,
      },
    });
    await db.collection('prepared_answers').insertOne({
      _id: 'pa_1',
      employeeId: 'emp_01J9ZK3M8Q',
      intent: 'my_kpi',
      paramsHash: 'b7f',
      snapshotVersion: '20261002-1',
      status: 'ready',
      finalText: 'text',
      usedSources: ['crm'],
      expiresAt: now,
    });
    await db.collection('activity_events').insertOne({
      ts: now,
      kind: 'source_read',
      level: 'info',
      sourceId: 'crm',
      action: 'connections page',
      ok: true,
    });
    await db.collection('llm_usage_events').insertMany([
      { ts: now, route: 'night_draft', model: 'm', outcome: 'ok' },
      {
        ts: now,
        route: 'live_small',
        model: 'm',
        outcome: 'ok',
        text: { prompt: 'p', answer: 'a' },
      },
    ]);
  });

  it('builds a fresh database in production mode', async () => {
    await db.dropDatabase();
    const rebuilt = await runMigrations(db, migrations, {
      now: () => now,
      context: { mode: 'production' },
    });
    expect(rebuilt.ran.map((r) => r.id)).toEqual(['001_init']);
    expect((await db.collection('meta').findOne({ _id: 'mode' })).mode).toBe('production');
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    for (const name of COLLECTIONS) expect(names).toContain(name);
  });
});
