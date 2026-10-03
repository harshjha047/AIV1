import { contentHash } from '@fab5/shared/hash';
import { describe, expect, it } from 'vitest';
import {
  createCursorStore,
  createMapContext,
  defineEntity,
  getEntitySpec,
  mapPage,
  quarantineRecord,
  sampleRedacted
} from '../index.js';
import { crmConnection, crmUser, fixturesByEntity, ids } from './fixtures.js';
import { createFakeCollection, createFixedClock } from './helpers.js';

const connections = getEntitySpec('crm', 'connections');
const employees = getEntitySpec('crm', 'employees');
const context = createMapContext({ customers: new Map([[`crm:${ids.cust1}`, 'cus_A']]) });
const clock = createFixedClock();

const run = (overrides = {}) =>
  mapPage({
    spec: connections,
    source: 'crm',
    items: [crmConnection],
    page: 1,
    ctx: context,
    clock,
    runId: 'run-1',
    ...overrides
  });

describe('mapPage', () => {
  it('adds system fields to fact rows', async () => {
    const result = await run();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      _id: `crm:${ids.conn1}`,
      _src: 'crm',
      _runId: 'run-1',
      _deleted: false,
      _syncedAt: clock.now()
    });
    expect(result.rows[0]._hash).toMatch(/^[a-f0-9]{40}$/);
    expect(result).toMatchObject({ unchanged: 0, read: 1, quarantined: [] });
  });

  it('hashes mapped content only, ignoring system fields and key order', async () => {
    const { rows } = await run();
    const { _src, _hash, _runId, _syncedAt, _deleted, ...mapped } = rows[0];
    expect(_hash).toBe(contentHash(mapped));
    expect(_hash).toBe(contentHash({ ...mapped, _runId: 'other' }));
    const reordered = Object.fromEntries(Object.entries(mapped).reverse());
    expect(contentHash(reordered)).toBe(_hash);
    expect([_src, _runId, _syncedAt, _deleted]).toHaveLength(4);
  });

  it('skips rows whose hash is already stored', async () => {
    const first = await run();
    const known = new Map([[first.rows[0]._id, first.rows[0]._hash]]);
    const loadHashes = async (target, idsToLoad) => {
      expect(target).toBe('fact_connections');
      expect(idsToLoad).toEqual([first.rows[0]._id]);
      return known;
    };
    const second = await run({ loadHashes });
    expect(second.rows).toEqual([]);
    expect(second.unchanged).toBe(1);
  });

  it('re-emits a row whose content changed', async () => {
    const first = await run();
    const known = new Map([[first.rows[0]._id, first.rows[0]._hash]]);
    const changed = { ...crmConnection, status: 'Notice Period' };
    const second = await run({ items: [changed], loadHashes: async () => known });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].status).toBe('Notice Period');
    expect(second.rows[0]._hash).not.toBe(first.rows[0]._hash);
  });

  it('does not query hashes for an empty or fully quarantined page', async () => {
    let calls = 0;
    const loadHashes = async () => {
      calls += 1;
      return new Map();
    };
    await run({ items: [], loadHashes });
    await run({ items: [{ _id: ids.conn2 }], loadHashes });
    expect(calls).toBe(0);
  });

  it('quarantines rows that fail mapping and keeps the rest', async () => {
    const broken = { ...crmConnection, _id: ids.conn2, commercials: { mrc: 'abc' } };
    const result = await run({ items: [broken, crmConnection] });
    expect(result.rows.map((row) => row._id)).toEqual([`crm:${ids.conn1}`]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]).toMatchObject({
      source: 'crm',
      entity: 'connections',
      page: 1,
      createdAt: clock.now()
    });
    expect(result.quarantined[0].reason).toContain('commercials.mrc');
  });

  it('quarantines rows that violate the entity contract', async () => {
    const result = await run({ items: [{ ...crmConnection, status: null }] });
    expect(result.rows).toEqual([]);
    expect(result.quarantined[0].reason).toContain('status');
  });

  it('quarantines a user without a usable email', async () => {
    const result = await mapPage({
      spec: employees,
      source: 'crm',
      items: [{ ...crmUser, email: 'not-an-email' }],
      page: 1,
      ctx: context,
      clock,
      runId: 'run-1'
    });
    expect(result.rows).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
  });

  it('quarantines a mapped row carrying a deny-listed key even if the contract allows it', async () => {
    const leaky = defineEntity('crm', {
      entity: 'sales_targets',
      kind: 'fact',
      view: 'ai_sales_targets_v',
      cursor: { time: 'updatedAt', tie: '_id', tieType: 'objectId' },
      target: 'fact_sales_targets',
      contract: 'crm.sales_targets',
      map: () => ({ _id: 'crm:x', refreshToken: 'abc' })
    });
    const result = await mapPage({
      spec: leaky,
      source: 'crm',
      items: [fixturesByEntity.crm.sales_targets],
      page: 2,
      ctx: context,
      clock,
      runId: 'run-1',
      validate: () => ({ ok: true, reason: null })
    });
    expect(result.rows).toEqual([]);
    expect(result.quarantined[0].reason).toContain('denied key refreshToken');
  });

  it('quarantines rows whose mapping throws a non-finite number', async () => {
    const result = await run({
      items: [{ ...crmConnection, ips: { count: 1, cost: 1 } }],
      validate: () => {
        throw new TypeError('non-finite number at $.x');
      }
    });
    expect(result.quarantined[0].reason).toContain('non-finite');
  });

  it('returns identity rows with a hash and no system fields', async () => {
    const result = await mapPage({
      spec: employees,
      source: 'crm',
      items: [crmUser],
      page: 1,
      ctx: context,
      clock,
      runId: 'run-1',
      loadHashes: async () => {
        throw new Error('identity entities must not load hashes');
      }
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      _id: `crm:${ids.user1}`,
      email: 'asha.rao@example.com'
    });
    expect(result.rows[0]._hash).toMatch(/^[a-f0-9]{40}$/);
    expect(result.rows[0]).not.toHaveProperty('_src');
    expect(result.rows[0]).not.toHaveProperty('_runId');
  });
});

describe('quarantine records', () => {
  const doc = {
    _id: ids.conn2,
    status: 'Active',
    remarks: 'password: hunter2 and 123412341234',
    password: 'hunter2',
    technicalDetails: { aEnd: { address: 'secret' } }
  };

  it('describes the shape of a row without any of its values', () => {
    const sample = sampleRedacted(doc);
    expect(sample).toContain(`_id=${ids.conn2}`);
    expect(sample).toContain('status:string');
    expect(sample).not.toContain('hunter2');
    expect(sample).not.toContain('123412341234');
    expect(sample).not.toContain('secret');
    expect(sample).not.toContain('password');
  });

  it('is idempotent per row so reruns replace rather than pile up', () => {
    const base = { source: 'crm', spec: connections, doc, page: 1, now: clock.now() };
    const first = quarantineRecord({ ...base, reason: 'a' });
    const second = quarantineRecord({ ...base, reason: 'b', page: 4 });
    expect(first._id).toBe(second._id);
    expect(
      quarantineRecord({ ...base, doc: { ...doc, _id: ids.conn1 }, reason: 'a' })._id
    ).not.toBe(first._id);
  });

  it('redacts secrets from the reason and bounds its length', () => {
    const record = quarantineRecord({
      source: 'crm',
      spec: connections,
      doc,
      page: 1,
      now: clock.now(),
      reason: `failed mongodb://ai_ro:pw@host/db password=abc ${'x'.repeat(500)}`
    });
    expect(record.reason).not.toContain('ai_ro:pw');
    expect(record.reason).not.toContain('abc ');
    expect(record.reason.length).toBeLessThanOrEqual(200);
  });
});

describe('cursor store', () => {
  const make = () => {
    const collection = createFakeCollection();
    const time = createFixedClock();
    return { collection, time, store: createCursorStore({ collection, clock: time }) };
  };

  it('keys documents by source and entity', () => {
    expect(make().store.keyOf('crm', 'connections')).toBe('crm:connections');
  });

  it('starts empty and returns the saved cursor', async () => {
    const { store } = make();
    expect(await store.load('crm', 'connections')).toBeNull();
    await store.save('crm', 'connections', '2026-09-01T10:00:00.000Z|abc');
    expect(await store.load('crm', 'connections')).toBe('2026-09-01T10:00:00.000Z|abc');
  });

  it('keeps entities independent', async () => {
    const { store } = make();
    await store.save('crm', 'connections', 'a|1');
    await store.save('crm', 'customers', 'b|2');
    expect(await store.load('crm', 'connections')).toBe('a|1');
    expect(await store.load('crm', 'customers')).toBe('b|2');
  });

  it('records success, clears the error and stamps a full load', async () => {
    const { store, time } = make();
    await store.markError('crm', 'connections', 'timeout');
    await store.markSuccess('crm', 'connections', { cursor: 'c|3', fullLoad: true });
    const doc = await store.get('crm', 'connections');
    expect(doc).toMatchObject({
      cursor: 'c|3',
      lastError: null,
      lastSuccessAt: time.now(),
      lastFullLoadAt: time.now()
    });
  });

  it('records a bounded error without touching the cursor', async () => {
    const { store } = make();
    await store.save('crm', 'connections', 'a|1');
    await store.markError('crm', 'connections', 'x'.repeat(400));
    const doc = await store.get('crm', 'connections');
    expect(doc.cursor).toBe('a|1');
    expect(doc.lastError).toHaveLength(200);
  });

  it('resets the cursor for a full reload and stamps id reconciliation', async () => {
    const { store, time } = make();
    await store.save('crm', 'connections', 'a|1');
    await store.reset('crm', 'connections');
    await store.markIdReconcile('crm', 'connections');
    const doc = await store.get('crm', 'connections');
    expect(doc.cursor).toBeNull();
    expect(doc.lastIdReconcileAt).toEqual(time.now());
  });
});
