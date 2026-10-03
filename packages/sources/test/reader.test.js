import { SourceDisabledError } from '@fab5/source-gate';
import { describe, expect, it } from 'vitest';
import { createHarness, sourceDoc } from '../../source-gate/test/helpers.js';
import {
  SourceReaderError,
  createCursorStore,
  decodeCursor,
  encodeCursor,
  getEntitySpec,
  incrementalFilter,
  readEntity
} from '../index.js';
import {
  createFixedClock,
  createFakeCollection,
  createFakeGate,
  createFakeView
} from './helpers.js';

const spec = getEntitySpec('crm', 'connections');
const codec = { decode: (value) => value, encode: (value) => String(value) };

const row = (n, time) => ({
  _id: `id-${String(n).padStart(3, '0')}`,
  updatedAt: new Date(time)
});

const collect = async (generator) => {
  const pages = [];
  for await (const page of generator) pages.push(page);
  return pages;
};

describe('compound cursor', () => {
  it('round-trips time and id', () => {
    const doc = { _id: 'abc', updatedAt: new Date('2026-09-01T10:00:00.000Z') };
    const text = encodeCursor(spec, doc, codec);
    expect(text).toBe('2026-09-01T10:00:00.000Z|abc');
    expect(decodeCursor(text, spec, codec)).toEqual({ time: doc.updatedAt, id: 'abc' });
  });

  it('keeps ids that contain the separator', () => {
    const decoded = decodeCursor('2026-09-01T10:00:00.000Z|a|b', spec, codec);
    expect(decoded.id).toBe('a|b');
  });

  it('treats an absent cursor as the start', () => {
    expect(decodeCursor(null, spec, codec)).toBeNull();
    expect(decodeCursor(undefined, spec, codec)).toBeNull();
    expect(decodeCursor('', spec, codec)).toBeNull();
  });

  it.each(['garbage', '|abc', '2026-09-01T10:00:00.000Z|', 'not-a-date|abc'])(
    'rejects the malformed cursor %s',
    (text) => {
      expect(() => decodeCursor(text, spec, codec)).toThrow(SourceReaderError);
    }
  );

  it('refuses to cursor a row without a valid time or id', () => {
    expect(() => encodeCursor(spec, { _id: 'a', updatedAt: null }, codec)).toThrow(
      /valid updatedAt/
    );
    expect(() =>
      encodeCursor(spec, { updatedAt: new Date('2026-09-01T00:00:00.000Z') }, codec)
    ).toThrow(/no _id/);
  });

  it('builds the strict compound filter after a position', () => {
    const position = { time: new Date('2026-09-01T10:00:00.000Z'), id: 'abc' };
    expect(incrementalFilter(spec, { position })).toEqual({
      $or: [
        { updatedAt: { $gt: position.time } },
        { updatedAt: position.time, _id: { $gt: 'abc' } }
      ]
    });
  });

  it('uses an inclusive since filter when there is no position', () => {
    const since = new Date('2026-08-01T00:00:00.000Z');
    expect(incrementalFilter(spec, { since })).toEqual({ updatedAt: { $gte: since } });
    expect(incrementalFilter(spec, {})).toEqual({});
  });

  it('prefers the position over since', () => {
    const position = { time: new Date('2026-09-01T00:00:00.000Z'), id: 'x' };
    const filter = incrementalFilter(spec, {
      since: new Date('2020-01-01T00:00:00.000Z'),
      position
    });
    expect(filter.$or).toBeDefined();
  });
});

describe('readEntity paging', () => {
  const docs = [
    row(1, '2026-09-01T10:00:00.000Z'),
    row(2, '2026-09-01T10:00:00.000Z'),
    row(3, '2026-09-01T10:00:00.000Z'),
    row(4, '2026-09-01T10:00:00.000Z'),
    row(5, '2026-09-01T11:00:00.000Z'),
    row(6, '2026-09-01T12:00:00.000Z'),
    row(7, '2026-09-01T12:00:00.000Z')
  ];
  const makeGate = (pageSize = 3, source = docs) =>
    createFakeGate({ views: { ai_connections_v: createFakeView(source) }, pageSize });

  it('pages through every row once, in order', async () => {
    const gate = makeGate();
    const pages = await collect(readEntity({ gate, sourceId: 'crm', spec, codec }));
    expect(pages.map((page) => page.items.length)).toEqual([3, 3, 1]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
    expect(pages.flatMap((page) => page.items.map((item) => item._id))).toEqual(
      docs.map((doc) => doc._id)
    );
  });

  it('never skips rows that share a timestamp across a page boundary', async () => {
    const gate = makeGate(2);
    const pages = await collect(readEntity({ gate, sourceId: 'crm', spec, codec }));
    const seen = pages.flatMap((page) => page.items.map((item) => item._id));
    expect(seen).toHaveLength(docs.length);
    expect(new Set(seen).size).toBe(docs.length);
  });

  it('fetches one extra row to detect more pages and applies the limits', async () => {
    const view = createFakeView(docs);
    const gate = createFakeGate({
      views: { ai_connections_v: view },
      pageSize: 3,
      maxTimeMs: 1234
    });
    await collect(readEntity({ gate, sourceId: 'crm', spec, codec }));
    expect(view.queries[0]).toMatchObject({ limit: 4, maxTimeMS: 1234 });
    expect(view.queries[0].sort).toEqual({ updatedAt: 1, _id: 1 });
  });

  it('reports each page cursor as the last row of that page', async () => {
    const gate = makeGate();
    const pages = await collect(readEntity({ gate, sourceId: 'crm', spec, codec }));
    expect(pages[0].cursor).toBe('2026-09-01T10:00:00.000Z|id-003');
    expect(pages[2].cursor).toBe('2026-09-01T12:00:00.000Z|id-007');
  });

  it('honors since', async () => {
    const gate = makeGate(10);
    const pages = await collect(
      readEntity({
        gate,
        sourceId: 'crm',
        spec,
        codec,
        since: new Date('2026-09-01T11:00:00.000Z')
      })
    );
    expect(pages.flatMap((page) => page.items.map((item) => item._id))).toEqual([
      'id-005',
      'id-006',
      'id-007'
    ]);
  });

  it('returns a single empty page with the incoming cursor when nothing changed', async () => {
    const gate = makeGate();
    const cursor = '2026-09-01T12:00:00.000Z|id-007';
    const pages = await collect(readEntity({ gate, sourceId: 'crm', spec, codec, cursor }));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ items: [], hasMore: false, cursor });
  });

  it('tags every read with the entity and caller', async () => {
    const gate = makeGate();
    await collect(
      readEntity({ gate, sourceId: 'crm', spec, codec, triggeredBy: 'manual', runId: 'run-1' })
    );
    expect(gate.calls[0]).toMatchObject({
      sourceId: 'crm',
      ctx: { entity: 'connections', triggeredBy: 'manual', runId: 'run-1' }
    });
  });

  it('picks up a row updated after the cursor was saved', async () => {
    const live = docs.map((doc) => ({ ...doc }));
    const gate = makeGate(10, live);
    const first = await collect(readEntity({ gate, sourceId: 'crm', spec, codec }));
    const cursor = first.at(-1).cursor;
    live[1].updatedAt = new Date('2026-09-02T00:00:00.000Z');
    const second = await collect(readEntity({ gate, sourceId: 'crm', spec, codec, cursor }));
    expect(second.flatMap((page) => page.items.map((item) => item._id))).toEqual(['id-002']);
  });
});

describe('resuming after a kill', () => {
  const docs = Array.from({ length: 11 }, (_, i) =>
    row(i + 1, i < 6 ? '2026-09-01T10:00:00.000Z' : '2026-09-01T10:30:00.000Z')
  );

  it('continues exactly where the saved cursor stopped', async () => {
    const gate = createFakeGate({ views: { ai_connections_v: createFakeView(docs) }, pageSize: 4 });
    const store = createCursorStore({
      collection: createFakeCollection(),
      clock: createFixedClock()
    });
    const processed = [];

    for await (const page of readEntity({
      gate,
      sourceId: 'crm',
      spec,
      codec,
      cursor: await store.load('crm', 'connections')
    })) {
      processed.push(...page.items.map((item) => item._id));
      await store.save('crm', 'connections', page.cursor);
      if (page.page === 2) break;
    }
    expect(processed).toHaveLength(8);
    expect(await store.load('crm', 'connections')).toBe('2026-09-01T10:30:00.000Z|id-008');

    for await (const page of readEntity({
      gate,
      sourceId: 'crm',
      spec,
      codec,
      cursor: await store.load('crm', 'connections')
    })) {
      processed.push(...page.items.map((item) => item._id));
      await store.save('crm', 'connections', page.cursor);
    }
    expect(processed).toEqual(docs.map((doc) => doc._id));
  });

  it('loses nothing when the kill happens between reading a page and saving it', async () => {
    const gate = createFakeGate({ views: { ai_connections_v: createFakeView(docs) }, pageSize: 4 });
    const store = createCursorStore({
      collection: createFakeCollection(),
      clock: createFixedClock()
    });
    const processed = new Set();

    const iterator = readEntity({ gate, sourceId: 'crm', spec, codec });
    const first = await iterator.next();
    first.value.items.forEach((item) => processed.add(item._id));
    await store.save('crm', 'connections', first.value.cursor);
    const second = await iterator.next();
    second.value.items.forEach((item) => processed.add(item._id));

    for await (const page of readEntity({
      gate,
      sourceId: 'crm',
      spec,
      codec,
      cursor: await store.load('crm', 'connections')
    })) {
      page.items.forEach((item) => processed.add(item._id));
    }
    expect(processed.size).toBe(docs.length);
  });
});

describe('reads go through the Source Gate', () => {
  const docs = Array.from({ length: 5 }, (_, i) => row(i + 1, '2026-09-01T10:00:00.000Z'));
  const harness = () => {
    const h = createHarness({
      sources: [sourceDoc({ limits: { pageSize: 2, maxTimeMs: 30000, rowsPerMin: 100000 } })]
    });
    const client = {
      db: () => ({ collection: () => createFakeView(docs) })
    };
    h.engine.connect = async () => client;
    return h;
  };

  it('logs each page as a read against the entity', async () => {
    const h = harness();
    const pages = await collect(readEntity({ gate: h.gate, sourceId: 'crm', spec, codec }));
    expect(pages.map((page) => page.items.length)).toEqual([2, 2, 1]);
    const reads = h.accessRows.filter((entry) => entry.action === 'read_page');
    expect(reads).toHaveLength(3);
    expect(reads.map((entry) => entry.entity)).toEqual([
      'connections',
      'connections',
      'connections'
    ]);
    expect(reads.map((entry) => entry.rows)).toEqual([2, 2, 1]);
  });

  it('stops reading and records blocked attempts once the source leaves active', async () => {
    const h = harness();
    const iterator = readEntity({ gate: h.gate, sourceId: 'crm', spec, codec });
    const first = await iterator.next();
    expect(first.value.items).toHaveLength(2);

    await h.store.update('crm', { state: 'disabled' });
    h.clock.advance(6000);

    await expect(iterator.next()).rejects.toBeInstanceOf(SourceDisabledError);
    expect(h.accessRows.filter((entry) => entry.action === 'read_page')).toHaveLength(1);
    expect(h.accessRows.some((entry) => entry.action === 'blocked')).toBe(true);
  });

  it('resumes from the saved cursor after the source is re-enabled', async () => {
    const h = harness();
    const store = createCursorStore({ collection: createFakeCollection(), clock: h.clock });
    const seen = [];

    const iterator = readEntity({ gate: h.gate, sourceId: 'crm', spec, codec });
    const first = await iterator.next();
    seen.push(...first.value.items.map((item) => item._id));
    await store.save('crm', 'connections', first.value.cursor);

    await h.store.update('crm', { state: 'paused' });
    h.clock.advance(6000);
    await expect(iterator.next()).rejects.toBeInstanceOf(SourceDisabledError);

    await h.store.update('crm', { state: 'active' });
    h.clock.advance(6000);
    const cursor = await store.load('crm', 'connections');
    for await (const page of readEntity({ gate: h.gate, sourceId: 'crm', spec, codec, cursor })) {
      seen.push(...page.items.map((item) => item._id));
    }
    expect(seen).toEqual(docs.map((doc) => doc._id));
  });
});
