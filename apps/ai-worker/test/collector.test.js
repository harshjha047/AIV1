import { describe, expect, it, vi } from 'vitest';
import { entitySpecs } from '@fab5/sources';
import {
  MAX_SOURCE_OPERATIONS_PER_ENTITY,
  MAX_SOURCE_READS_PER_ENTITY,
  createInventoryCollector,
  createInventoryScheduler
} from '../src/inventory/index.js';
import {
  createFakeGate,
  createFixedClock,
  createMemoryDb,
  createSourceClients,
  sourceDoc,
  timeoutError
} from './helpers.js';
import { bahikhataViews, crmViews, snapshotSeed } from './fixtures.js';

const ENTITY_COUNT = Object.values(entitySpecs).reduce(
  (sum, specs) => sum + Object.keys(specs).length,
  0
);

function setup({ states = {}, seed = snapshotSeed(), activity = null } = {}) {
  const sources = [
    sourceDoc('crm', { state: states.crm ?? 'active' }),
    sourceDoc('bahikhata', { state: states.bahikhata ?? 'active' }),
    sourceDoc('invoicing', { state: 'active' }),
    sourceDoc('samadhan', { engine: 'postgres', state: 'not_configured' })
  ];
  const log = [];
  const clients = createSourceClients({ crm: crmViews(), bahikhata: bahikhataViews() }, log);
  const gate = createFakeGate({ sources, clients });
  const snapshotDb = createMemoryDb(seed);
  const clock = createFixedClock();
  const registry = { list: async () => sources, get: async (id) => sources.find((s) => s._id === id) };
  const collector = createInventoryCollector({ gate, registry, snapshotDb, clock, activity });
  return { sources, log, clients, gate, snapshotDb, clock, collector };
}

const rowsOf = (snapshotDb) => snapshotDb.collection('source_inventory').store;
const rowFor = (snapshotDb, sourceId, entity) =>
  rowsOf(snapshotDb).filter((row) => row.sourceId === sourceId && row.entity === entity).at(-1);

describe('inventory collector', () => {
  it('writes one inventory row per entity for active sources only', async () => {
    const { collector, snapshotDb } = setup();
    const result = await collector.refresh({ triggeredBy: 'manual' });
    expect(Object.keys(result.sources).sort()).toEqual(['bahikhata', 'crm']);
    expect(result.sources.crm.status).toBe('ok');
    expect(rowsOf(snapshotDb)).toHaveLength(ENTITY_COUNT);
  });

  it('records counts, ranges, last updated and IST month histogram', async () => {
    const { collector, snapshotDb } = setup();
    await collector.refresh({ force: true });
    const connections = rowFor(snapshotDb, 'crm', 'connections');
    expect(connections.sourceRows).toBe(4);
    expect(connections.syncedRows).toBe(3);
    expect(connections.minDate).toEqual(new Date('2026-06-30T20:00:00.000Z'));
    expect(connections.maxDate).toEqual(new Date('2026-08-20T05:00:00.000Z'));
    expect(connections.lastUpdatedAt).toEqual(new Date('2026-08-21T09:30:00.000Z'));
    expect(connections.perMonth).toEqual([
      { monthKey: '2026-07', count: 2 },
      { monthKey: '2026-08', count: 2 }
    ]);
    expect(connections.countTimedOut).toBe(false);
    const ledger = rowFor(snapshotDb, 'bahikhata', 'ledger_entries');
    expect(ledger.perMonth).toEqual([
      { monthKey: '2026-07', count: 1 },
      { monthKey: '2026-08', count: 2 }
    ]);
  });

  it('leaves identity entities without ranges and uses canonical synced counts', async () => {
    const { collector, snapshotDb } = setup();
    await collector.refresh({ force: true });
    const employees = rowFor(snapshotDb, 'crm', 'employees');
    expect(employees.minDate).toBeNull();
    expect(employees.perMonth).toEqual([]);
    expect(employees.syncedRows).toBe(3);
    expect(employees.lastUpdatedAt).toEqual(new Date('2026-08-01T05:00:00.000Z'));
  });

  it('computes quality flags from the snapshot', async () => {
    const { collector, snapshotDb } = setup();
    await collector.refresh({ force: true });
    expect(rowFor(snapshotDb, 'crm', 'connections').flags).toEqual({
      bandwidthUnparsed: 1,
      noCustomerMapping: 1,
      noTargetForMonth: 1
    });
    expect(rowFor(snapshotDb, 'crm', 'connection_events').flags).toEqual({
      activationsWithoutCreator: 2
    });
    expect(rowFor(snapshotDb, 'crm', 'sales_targets').flags).toEqual({
      employeesWithActivityNoTarget: 1
    });
    expect(rowFor(snapshotDb, 'crm', 'service_requests').flags).toEqual({ noCustomerMapping: 1 });
    expect(rowFor(snapshotDb, 'crm', 'customers').flags).toEqual({
      noManager: 1,
      unmappedBetweenSystems: 1
    });
    expect(rowFor(snapshotDb, 'bahikhata', 'customers').flags).toEqual({
      noManager: 1,
      unmappedBetweenSystems: 1
    });
    expect(rowFor(snapshotDb, 'bahikhata', 'ledger_entries').flags).toEqual({
      pendingUnapproved: 1,
      noCustomerMapping: 1
    });
    expect(rowFor(snapshotDb, 'crm', 'employees').flags).toEqual({ presentInOneSystemOnly: 2 });
    expect(rowFor(snapshotDb, 'bahikhata', 'employees').flags).toEqual({ presentInOneSystemOnly: 1 });
  });

  it('reports mapping coverage for customers and employees', async () => {
    const { collector, snapshotDb } = setup();
    await collector.refresh({ force: true });
    expect(rowFor(snapshotDb, 'crm', 'customers').mappingCoverage).toEqual({
      bahikhata: { matched: 1, ambiguous: 0, unmatched: 1, rejected: 0 }
    });
    expect(rowFor(snapshotDb, 'bahikhata', 'employees').mappingCoverage).toEqual({
      complete: 1,
      partial: 3
    });
    expect(rowFor(snapshotDb, 'crm', 'connections').mappingCoverage).toBeUndefined();
  });

  it('stays within the source read budget', async () => {
    const { collector, log, gate } = setup();
    await collector.refresh({ force: true });
    expect(gate.calls.length).toBeLessThanOrEqual(ENTITY_COUNT * MAX_SOURCE_READS_PER_ENTITY);
    const perEntity = new Map();
    for (const entry of log) {
      const key = `${entry.sourceId}.${entry.view}`;
      perEntity.set(key, (perEntity.get(key) ?? 0) + 1);
    }
    expect(perEntity.size).toBe(ENTITY_COUNT);
    for (const total of perEntity.values()) {
      expect(total).toBeLessThanOrEqual(MAX_SOURCE_OPERATIONS_PER_ENTITY);
    }
    const finds = log.filter((entry) => entry.op === 'find');
    expect(finds.length).toBeGreaterThan(0);
    for (const entry of finds) {
      expect(entry.limit).toBe(1);
      expect(entry.maxTimeMS).toBeLessThanOrEqual(10000);
    }
    for (const entry of log.filter((item) => item.op !== 'find')) {
      expect(entry.maxTimeMS).toBeGreaterThan(0);
      expect(entry.maxTimeMS).toBeLessThanOrEqual(10000);
    }
    expect(log.some((entry) => entry.op === 'countDocuments')).toBe(false);
  });

  it('never touches a source that is not active', async () => {
    const { collector, log, gate, snapshotDb } = setup({ states: { crm: 'paused', bahikhata: 'disabled' } });
    const result = await collector.refresh({ force: true });
    expect(result.sources.crm).toEqual({ status: 'skipped', reason: 'paused' });
    expect(result.sources.bahikhata).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(gate.calls).toHaveLength(0);
    expect(log).toHaveLength(0);
    expect(rowsOf(snapshotDb)).toHaveLength(0);
  });

  it('skips only the switched-off source and still refreshes the other', async () => {
    const { collector, gate, snapshotDb } = setup({ states: { crm: 'not_configured' } });
    const result = await collector.refresh({ force: true });
    expect(result.sources.crm.reason).toBe('not_configured');
    expect(result.sources.bahikhata.status).toBe('ok');
    expect(gate.calls.every((call) => call.sourceId === 'bahikhata')).toBe(true);
    expect(rowsOf(snapshotDb).every((row) => row.sourceId === 'bahikhata')).toBe(true);
  });

  it('keeps the previous count and flags the row when the count times out', async () => {
    const { collector, clients, snapshotDb, clock } = setup();
    await collector.refresh({ force: true });
    clock.advance(20 * 60000);
    clients.crm.collections.ai_connections_v.failures.count = timeoutError();
    const result = await collector.refresh();
    const row = rowFor(snapshotDb, 'crm', 'connections');
    expect(row.sourceRows).toBe(4);
    expect(row.countTimedOut).toBe(true);
    expect(result.sources.crm.timedOut).toBe(1);
    expect(result.sources.crm.status).toBe('ok');
  });

  it('keeps previous range and histogram when a probe times out', async () => {
    const { collector, clients, snapshotDb, clock } = setup();
    await collector.refresh({ force: true });
    clock.advance(20 * 60000);
    clients.crm.collections.ai_connections_v.failures.aggregate = timeoutError();
    clients.crm.collections.ai_connections_v.failures.find = timeoutError();
    await collector.refresh();
    const row = rowFor(snapshotDb, 'crm', 'connections');
    expect(row.perMonth).toEqual([
      { monthKey: '2026-07', count: 2 },
      { monthKey: '2026-08', count: 2 }
    ]);
    expect(row.minDate).toEqual(new Date('2026-06-30T20:00:00.000Z'));
    expect(row.countTimedOut).toBe(false);
  });

  it('aborts a source that leaves active mid-run without partial rows for that entity', async () => {
    const { collector, gate, sources, snapshotDb } = setup({ states: { bahikhata: 'paused' } });
    gate.switchOffAfter = { reads: 4, source: sources[0] };
    const result = await collector.refresh({ force: true });
    expect(result.sources.crm.status).toBe('aborted');
    expect(result.sources.crm.entities).toBe(2);
    expect(rowsOf(snapshotDb)).toHaveLength(2);
  });

  it('serves cached results inside the refresh interval and refreshes after it', async () => {
    const { collector, gate, clock } = setup();
    await collector.refresh({ force: true });
    const reads = gate.calls.length;
    const cached = await collector.refresh();
    expect(cached.sources.crm.status).toBe('cached');
    expect(gate.calls).toHaveLength(reads);
    clock.advance(16 * 60000);
    const again = await collector.refresh();
    expect(again.sources.crm.status).toBe('ok');
    expect(gate.calls.length).toBeGreaterThan(reads);
  });

  it('shares one run between concurrent refresh calls', async () => {
    const { collector, snapshotDb } = setup();
    const [first, second] = await Promise.all([
      collector.refresh({ force: true }),
      collector.refresh({ force: true })
    ]);
    expect(first).toBe(second);
    expect(rowsOf(snapshotDb)).toHaveLength(ENTITY_COUNT);
  });

  it('limits a refresh to the requested sources', async () => {
    const { collector, gate } = setup();
    const result = await collector.refresh({ sourceIds: ['bahikhata'], force: true });
    expect(Object.keys(result.sources)).toEqual(['bahikhata']);
    expect(gate.calls.every((call) => call.sourceId === 'bahikhata')).toBe(true);
  });

  it('labels reads with the trigger and uses count and read_page actions', async () => {
    const { collector, gate } = setup();
    await collector.refresh({ triggeredBy: 'dashboard', force: true });
    expect(new Set(gate.calls.map((call) => call.ctx.triggeredBy))).toEqual(new Set(['dashboard']));
    expect(new Set(gate.calls.map((call) => call.ctx.action))).toEqual(new Set(['count', 'read_page']));
  });

  it('emits inventory activity per source and warns on timeouts', async () => {
    const emitted = [];
    const { collector, clients } = setup({ activity: { emit: async (event) => emitted.push(event) } });
    clients.crm.collections.ai_users_v.failures.count = timeoutError();
    await collector.refresh({ force: true });
    const crm = emitted.find((event) => event.sourceId === 'crm');
    expect(crm.kind).toBe('inventory');
    expect(crm.level).toBe('warn');
    expect(crm.message).toBe('timeouts=1 errors=0');
    expect(emitted.find((event) => event.sourceId === 'bahikhata').level).toBe('info');
  });

  it('returns the latest cached rows from snapshot', async () => {
    const { collector } = setup();
    await collector.refresh({ force: true });
    const rows = await collector.snapshot({ sourceId: 'crm' });
    expect(rows.map((row) => row.entity).sort()).toEqual(Object.keys(entitySpecs.crm).sort());
  });

  it('writes kpi readiness after a refresh', async () => {
    const { collector, snapshotDb } = setup();
    const result = await collector.refresh({ force: true });
    expect(result.readiness.rows).toBeGreaterThan(0);
    const byId = new Map(snapshotDb.collection('kpi_readiness').store.map((row) => [row._id, row]));
    expect(byId.get('emp_1:sales:2026-07').status).toBe('ready');
    expect(byId.get('emp_1:sales:2026-08').status).toBe('no_target');
    expect(byId.get('emp_3:sales:2026-07').status).toBe('no_activity');
    expect(byId.get('emp_2:collections:2026-07').status).toBe('ready');
    expect(byId.get('emp_2:collections:2026-08').status).toBe('no_activity');
    expect([...byId.keys()].some((id) => id.startsWith('emp_4:'))).toBe(false);
  });

  it('marks readiness source_off after the source is paused and its data is hidden', async () => {
    const { collector, sources, snapshotDb } = setup();
    await collector.refresh({ force: true });
    sources[0].state = 'disabled';
    sources[0].onDisable = 'hide';
    const result = await collector.refresh({ force: true });
    expect(result.sources.crm).toEqual({ status: 'skipped', reason: 'disabled' });
    const byId = new Map(snapshotDb.collection('kpi_readiness').store.map((row) => [row._id, row]));
    expect(byId.get('emp_1:sales:2026-07')).toMatchObject({ status: 'source_off', missingSources: ['crm'] });
    expect(byId.get('emp_2:collections:2026-07').status).toBe('ready');
  });
});

describe('inventory scheduler', () => {
  it('ticks on the configured interval and stops', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue({});
    const scheduler = createInventoryScheduler({ collector: { refresh }, intervalMinutes: 15 });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ triggeredBy: 'schedule' });
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(30 * 60000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('logs and survives a failed tick', async () => {
    const logger = { error: vi.fn() };
    const refresh = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = createInventoryScheduler({ collector: { refresh }, logger });
    await scheduler.tick();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
