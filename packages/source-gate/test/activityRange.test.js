import { describe, expect, it } from 'vitest';
import { createActivityRangeProvider, dateFieldFor, planActivityRange, readActivityRange } from '../src/activityRange.js';
import { getViewAllowList } from '@fab5/shared/pii';
import { createHarness, sourceDoc } from './helpers.js';

const d = (value) => new Date(value);

function mongoClient(data, calls = []) {
  return {
    db: () => ({
      collection: (name) => ({
        find: (filter, options) => ({
          toArray: async () => {
            calls.push({ name, filter, options });
            const [field] = Object.keys(options.sort);
            const rows = (data[name] ?? []).filter((row) => row[field] instanceof Date);
            rows.sort((a, b) => (options.sort[field] === -1 ? b[field] - a[field] : a[field] - b[field]));
            return rows.slice(0, options.limit).map((row) => ({ [field]: row[field] }));
          }
        })
      })
    })
  };
}

function harnessWith(data, calls) {
  const harness = createHarness({
    sources: [
      sourceDoc({ _id: 'crm', exposedObjects: ['ai_users_v', 'ai_connections_v', 'ai_connection_events_v'] }),
      sourceDoc({ _id: 'bahikhata', logicalSource: 'bahikhata', exposedObjects: ['ai_ledger_v'] }),
      sourceDoc({ _id: 'invoicing', logicalSource: 'invoicing', state: 'paused', exposedObjects: ['ai_invoices_v'] })
    ]
  });
  harness.engine.connect = async () => mongoClient(data, calls);
  return harness;
}

describe('date field selection', () => {
  it('prefers updatedAt, then parentUpdatedAt, then createdAt', () => {
    expect(dateFieldFor('mongodb', getViewAllowList('crm', 'ai_users_v'))).toBe('updatedAt');
    expect(dateFieldFor('mongodb', getViewAllowList('crm', 'ai_connection_events_v'))).toBe('updatedAt');
    expect(dateFieldFor('postgres', getViewAllowList('samadhan', 'tickets_v'))).toBe('last_activity_at');
    expect(dateFieldFor('postgres', getViewAllowList('samadhan', 'email_logs_v'))).toBe('sent_at');
  });

  it('plans only exposed views and strips schema prefixes', () => {
    expect(planActivityRange('crm', ['ai_users_v', 'ai_sales_targets_v']).map((entry) => entry.name)).toEqual([
      'ai_users_v',
      'ai_sales_targets_v'
    ]);
    expect(planActivityRange('samadhan', ['ai_export.tickets_v']).map((entry) => entry.name)).toEqual(['tickets_v']);
  });
});

describe('reading ranges through the gate', () => {
  const data = {
    ai_users_v: [{ updatedAt: d('2026-06-10') }, { updatedAt: d('2026-08-14') }, { updatedAt: 'bad' }],
    ai_connections_v: [{ updatedAt: d('2026-07-01') }, { updatedAt: d('2026-06-14') }],
    ai_connection_events_v: [{ updatedAt: d('2026-08-01') }],
    ai_ledger_v: [{ updatedAt: d('2026-08-20') }, { updatedAt: d('2026-05-02') }]
  };

  it('returns min and max across views and logs one read', async () => {
    const calls = [];
    const harness = harnessWith(data, calls);
    const range = await readActivityRange({ gate: harness.gate, registry: harness.registry, sourceId: 'crm' });
    expect(range).toEqual({ sourceId: 'crm', min: d('2026-06-10'), max: d('2026-08-14') });
    expect(calls.every((call) => call.options.maxTimeMS === 30000)).toBe(true);
    expect(calls.every((call) => Object.keys(call.options.projection).length === 2)).toBe(true);
    expect(harness.accessRows).toHaveLength(1);
    expect(harness.accessRows[0]).toMatchObject({ sourceId: 'crm', action: 'activity_range', triggeredBy: 'mode' });
  });

  it('only includes active sources', async () => {
    const harness = harnessWith(data, []);
    const provider = createActivityRangeProvider({ gate: harness.gate, registry: harness.registry });
    const result = await provider();
    expect(result.map((entry) => entry.sourceId).sort()).toEqual(['bahikhata', 'crm']);
    expect(result.find((entry) => entry.sourceId === 'bahikhata').max).toEqual(d('2026-08-20'));
  });

  it('skips a failing source and keeps the others', async () => {
    const harness = harnessWith(data, []);
    const original = harness.engine.connect;
    harness.engine.connect = async (source, secret) => {
      if (source._id === 'crm') throw new Error('down');
      return original(source, secret);
    };
    const warnings = [];
    const provider = createActivityRangeProvider({
      gate: harness.gate,
      registry: harness.registry,
      logger: { warn: (...args) => warnings.push(args) }
    });
    const result = await provider();
    expect(result.map((entry) => entry.sourceId)).toEqual(['bahikhata']);
    expect(warnings).toHaveLength(1);
  });

  it('never reads a source that is not active', async () => {
    const harness = harnessWith(data, []);
    await expect(readActivityRange({ gate: harness.gate, registry: harness.registry, sourceId: 'invoicing' })).rejects.toMatchObject({
      code: 'SOURCE_NOT_ACTIVE'
    });
  });

  it('reads postgres through a pool-like client', async () => {
    const queries = [];
    const pgHarness = createHarness({
      sources: [sourceDoc({ _id: 'samadhan', engine: 'postgres', logicalSource: 'samadhan', exposedObjects: ['ai_export.tickets_v'] })]
    });
    const pgEngine = {
      kind: 'postgres',
      connect: async () => ({
        query: async (text) => {
          queries.push(text);
          return { rows: [{ min: d('2026-06-14'), max: d('2026-08-14') }] };
        }
      }),
      close: async () => {},
      ping: async () => {},
      poolSize: () => 3
    };
    const { createSourceGate } = await import('../src/gate.js');
    const gate = createSourceGate({
      registry: pgHarness.registry,
      vault: pgHarness.vault,
      limiter: pgHarness.limiter,
      accessLog: { read: async () => {}, blocked: async () => {}, failed: async () => {}, verify: async () => {} },
      engines: { mongodb: pgHarness.engine, postgres: pgEngine },
      activity: { emit: async () => {} },
      queue: pgHarness.queue,
      monotonic: pgHarness.clock.monotonic
    });
    const range = await readActivityRange({ gate, registry: pgHarness.registry, sourceId: 'samadhan' });
    expect(range.max).toEqual(d('2026-08-14'));
    expect(queries[0]).toContain('FROM ai_export."tickets_v"');
    expect(queries[0]).toContain('"last_activity_at"');
  });
});
