import { createAccessLog } from '../src/accessLog.js';
import { createMemoryBus } from '../src/bus.js';
import { createSourceGate } from '../src/gate.js';
import { createRowLimiter } from '../src/limiter.js';
import { createRegistry } from '../src/registry.js';
import { createVault } from '../src/vault.js';

export function createFakeClock(start = '2026-09-01T00:00:00.000Z') {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    monotonic: () => ms,
    advance(delta) {
      ms += delta;
    },
    sleep: async (delta) => {
      ms += delta;
    }
  };
}

export function sourceDoc(overrides = {}) {
  return {
    _id: 'crm',
    displayName: 'CRM',
    engine: 'mongodb',
    kind: 'real',
    logicalSource: 'crm',
    mode: 'practice',
    state: 'active',
    onDisable: 'hide',
    exposedObjects: ['ai_users_v', 'ai_connections_v'],
    credentialRef: 'env:SRC_CRM_URI',
    readOnlyCheck: null,
    limits: { pageSize: 500, maxTimeMs: 30000, rowsPerMin: 20000 },
    pools: {},
    ...overrides
  };
}

export function createMemoryDataSourceStore(initial = []) {
  const docs = new Map(initial.map((doc) => [doc._id, structuredClone(doc)]));
  const store = {
    docs,
    failing: false,
    getCalls: 0,
    async get(id) {
      store.getCalls += 1;
      if (store.failing) throw new Error('registry down');
      const doc = docs.get(id);
      return doc ? structuredClone(doc) : null;
    },
    async list() {
      if (store.failing) throw new Error('registry down');
      return [...docs.values()].map((doc) => structuredClone(doc));
    },
    async insert(doc) {
      docs.set(doc._id, structuredClone(doc));
      return doc;
    },
    async update(id, patch) {
      const doc = docs.get(id);
      if (!doc) return null;
      Object.assign(doc, patch);
      return structuredClone(doc);
    },
    async transition(id, from, patch) {
      const doc = docs.get(id);
      if (!doc || !from.includes(doc.state)) return null;
      Object.assign(doc, patch);
      return structuredClone(doc);
    },
    async setPool(id, processName, pool) {
      const doc = docs.get(id);
      doc.pools = { ...doc.pools, [processName]: pool };
    }
  };
  return store;
}

export function createFakeEngine(kind = 'mongodb') {
  const engine = {
    kind,
    connects: 0,
    closes: 0,
    secrets: [],
    clients: [],
    failConnect: false,
    async connect(_source, secret) {
      engine.connects += 1;
      engine.secrets.push(secret);
      if (engine.failConnect) throw new Error(`cannot connect to mongodb://u:p@h/db`);
      const client = { id: engine.connects, closed: false };
      engine.clients.push(client);
      return client;
    },
    async close(client) {
      client.closed = true;
      engine.closes += 1;
    },
    async ping() {},
    poolSize: () => 2
  };
  return engine;
}

export function createHarness({ sources = [sourceDoc()], ttlMs = 5000, rowsPerMin = 20000 } = {}) {
  const clock = createFakeClock();
  const store = createMemoryDataSourceStore(sources);
  const bus = createMemoryBus();
  const registry = createRegistry({ store, bus, monotonic: clock.monotonic, ttlMs });
  registry.start();
  const accessRows = [];
  const activityRows = [];
  const accessLog = createAccessLog({
    store: { insert: async (doc) => accessRows.push(doc) },
    clock,
    activity: { emit: async (event) => activityRows.push(event) }
  });
  const resolver = {
    resolves: 0,
    async resolve(source) {
      resolver.resolves += 1;
      return `mongodb://ai_ro:pw@localhost/${source._id}`;
    }
  };
  const vault = createVault({ resolver });
  const limiter = createRowLimiter({ monotonic: clock.monotonic, sleep: clock.sleep });
  const engine = createFakeEngine();
  const queue = { cancelled: [], cancelBySource: async (id) => (queue.cancelled.push(id), 3) };
  const gate = createSourceGate({
    registry,
    vault,
    limiter,
    accessLog,
    engines: { mongodb: engine, postgres: createFakeEngine('postgres') },
    activity: { emit: async (event) => activityRows.push(event) },
    queue,
    monotonic: clock.monotonic
  });
  limiter.take = limiter.take.bind(limiter);
  return {
    clock,
    store,
    bus,
    registry,
    accessRows,
    activityRows,
    vault,
    resolver,
    limiter,
    engine,
    queue,
    gate,
    rowsPerMin
  };
}

export const page = (rows = 3) => async () => ({ value: Array.from({ length: rows }, (_, i) => i), rows });
