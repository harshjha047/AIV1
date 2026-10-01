import { describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  INDEX_SPECS,
  MigrationStateError,
  VALIDATORS,
  ensureCollections,
  ensureIndexes,
  getMigrationStatus,
  resolveLlmTextStore,
  runMigrations,
  seedMeta,
} from '../src/index.js';
import { createFakeDb } from './fake-db.js';

const migration = (id, version, up = async () => {}) => ({ id, version, up });

describe('ensureCollections', () => {
  it('creates every collection and attaches validators where defined', async () => {
    const { db, calls } = createFakeDb();
    const result = await ensureCollections(db);
    expect(result.created).toEqual([...COLLECTIONS]);
    expect(result.updated).toEqual([]);
    const validated = calls.createCollection.filter((c) => c.options.validator);
    expect(validated.map((c) => c.name).sort()).toEqual(Object.keys(VALIDATORS).sort());
    for (const call of validated) {
      expect(call.options).toMatchObject({
        validationLevel: 'moderate',
        validationAction: 'error',
      });
      expect(call.options.validator.$jsonSchema).toBe(VALIDATORS[call.name]);
    }
    for (const call of calls.createCollection.filter((c) => !c.options.validator)) {
      expect(call.options).toEqual({});
    }
  });

  it('updates validators with collMod when collections already exist', async () => {
    const { db, calls } = createFakeDb({ existing: [...COLLECTIONS] });
    const result = await ensureCollections(db);
    expect(result.created).toEqual([]);
    expect(result.updated.sort()).toEqual(Object.keys(VALIDATORS).sort());
    expect(calls.command).toHaveLength(Object.keys(VALIDATORS).length);
    expect(calls.command[0]).toHaveProperty('collMod');
    expect(calls.command[0].validationAction).toBe('error');
  });

  it('rethrows unexpected errors', async () => {
    const { db } = createFakeDb({ createFailures: { employees: 13 } });
    await expect(ensureCollections(db)).rejects.toMatchObject({ code: 13 });
  });
});

describe('ensureIndexes', () => {
  it('creates all indexes and keeps text logging inline when overlap is accepted', async () => {
    const { db, calls } = createFakeDb();
    const result = await ensureIndexes(db);
    expect(result.count).toBe(INDEX_SPECS.length);
    expect(result.llmTextStore).toBe('llm_usage_events');
    expect(calls.createIndex).toHaveLength(INDEX_SPECS.length);
    expect(await resolveLlmTextStore(db)).toBe('llm_usage_events');
  });

  it('falls back to llm_debug_text when the overlapping TTL index is rejected', async () => {
    for (const code of [67, 85, 86]) {
      const { db, calls } = createFakeDb({ indexFailures: { 'llm_usage_events.text_ttl': code } });
      const result = await ensureIndexes(db);
      expect(result.llmTextStore).toBe('llm_debug_text');
      expect(result.count).toBe(INDEX_SPECS.length);
      const debug = calls.createIndex.find((c) => c.collection === 'llm_debug_text');
      expect(debug.options).toMatchObject({ expireAfterSeconds: 604800 });
      expect(await resolveLlmTextStore(db)).toBe('llm_debug_text');
    }
  });

  it('does not swallow conflicts on non-optional indexes', async () => {
    const { db } = createFakeDb({ indexFailures: { 'employees.email_1': 85 } });
    await expect(ensureIndexes(db)).rejects.toMatchObject({ code: 85 });
  });

  it('does not swallow unrelated errors on the optional index', async () => {
    const { db } = createFakeDb({ indexFailures: { 'llm_usage_events.text_ttl': 13 } });
    await expect(ensureIndexes(db)).rejects.toMatchObject({ code: 13 });
  });
});

describe('seedMeta', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  it('seeds the five singleton documents once', async () => {
    const { db, store } = createFakeDb();
    expect(await seedMeta(db, { now, mode: 'production' })).toEqual([
      'snapshot',
      'embedding',
      'flags',
      'guard',
      'mode',
    ]);
    expect(store('meta').get('mode')).toMatchObject({
      mode: 'production',
      referenceDate: null,
      referenceAuto: true,
    });
    expect(store('meta').get('embedding')).toMatchObject({ dim: 768, activeModel: null });
    expect(store('meta').get('guard')).toMatchObject({ state: 'ok', since: now });
    expect(await seedMeta(db, { now, mode: 'practice' })).toEqual([]);
  });

  it('never overwrites existing values', async () => {
    const { db, store } = createFakeDb();
    await seedMeta(db, { now });
    store('meta').get('guard').state = 'paused_all';
    await seedMeta(db, { now });
    expect(store('meta').get('guard').state).toBe('paused_all');
  });
});

describe('migration runner', () => {
  const clock = () => new Date('2026-10-01T00:00:00Z');

  it('runs pending migrations in order and records them', async () => {
    const { db, store } = createFakeDb();
    const order = [];
    const migrations = [
      migration('001_init', 1, async () => order.push(1)),
      migration('002_more', 2, async () => order.push(2)),
    ];
    const result = await runMigrations(db, migrations, { now: clock });
    expect(order).toEqual([1, 2]);
    expect(result.ran.map((r) => r.id)).toEqual(['001_init', '002_more']);
    expect(result.schemaVersion).toBe(2);
    expect(store('schema_migrations').get('001_init')).toMatchObject({
      version: 1,
      appliedAt: clock(),
    });
    expect(store('meta').get('snapshot').schemaVersion).toBe(2);
  });

  it('passes context and the clock into each migration', async () => {
    const { db } = createFakeDb();
    let seen;
    await runMigrations(db, [migration('001_init', 1, async (_db, ctx) => (seen = ctx))], {
      now: clock,
      context: { mode: 'production' },
    });
    expect(seen).toEqual({ mode: 'production', now: clock() });
  });

  it('is a no-op when everything is applied', async () => {
    const { db } = createFakeDb();
    let runs = 0;
    const migrations = [migration('001_init', 1, async () => (runs += 1))];
    await runMigrations(db, migrations, { now: clock });
    const second = await runMigrations(db, migrations, { now: clock });
    expect(runs).toBe(1);
    expect(second.ran).toEqual([]);
    expect(second.schemaVersion).toBe(1);
  });

  it('applies only newly added migrations', async () => {
    const { db } = createFakeDb();
    const first = migration('001_init', 1);
    await runMigrations(db, [first], { now: clock });
    const ran = [];
    const second = migration('002_next', 2, async () => ran.push('002'));
    const result = await runMigrations(db, [first, second], { now: clock });
    expect(ran).toEqual(['002']);
    expect(result.schemaVersion).toBe(2);
  });

  it('reports status without changing anything', async () => {
    const { db, store } = createFakeDb();
    const migrations = [migration('001_init', 1), migration('002_next', 2)];
    await runMigrations(db, [migrations[0]], { now: clock });
    const status = await getMigrationStatus(db, migrations);
    expect(status).toEqual({ applied: ['001_init'], pending: ['002_next'], schemaVersion: 1 });
    expect(store('schema_migrations').size).toBe(1);
  });

  it('retries a failed migration on the next run', async () => {
    const { db, store } = createFakeDb();
    let attempts = 0;
    const flaky = migration('001_init', 1, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
    });
    await expect(runMigrations(db, [flaky], { now: clock })).rejects.toThrow('boom');
    expect(store('schema_migrations').size).toBe(0);
    await runMigrations(db, [flaky], { now: clock });
    expect(attempts).toBe(2);
    expect(store('schema_migrations').size).toBe(1);
  });

  it('tolerates a concurrent runner recording the same migration', async () => {
    const { db, store } = createFakeDb();
    const racing = migration('001_init', 1, async (database) => {
      await database.collection('schema_migrations').insertOne({ _id: '001_init', version: 1 });
    });
    const result = await runMigrations(db, [racing], { now: clock });
    expect(result.ran).toHaveLength(1);
    expect(store('schema_migrations').size).toBe(1);
  });

  it('refuses a database that is ahead of the code', async () => {
    const { db } = createFakeDb();
    const migrations = [migration('001_init', 1), migration('002_next', 2)];
    await runMigrations(db, migrations, { now: clock });
    await expect(runMigrations(db, [migrations[0]], { now: clock })).rejects.toBeInstanceOf(
      MigrationStateError,
    );
  });

  it('rejects malformed migration lists', async () => {
    const { db } = createFakeDb();
    await expect(runMigrations(db, [migration('init', 1)])).rejects.toThrow(/invalid migration id/);
    await expect(runMigrations(db, [migration('002_skip', 2)])).rejects.toThrow(
      /must have version 1/,
    );
    await expect(runMigrations(db, [migration('001_a', 1), migration('001_a', 2)])).rejects.toThrow(
      /duplicate|prefix/,
    );
    await expect(runMigrations(db, [migration('002_x', 1)])).rejects.toThrow(/prefix/);
  });
});
