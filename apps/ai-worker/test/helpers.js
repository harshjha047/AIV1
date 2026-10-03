import { DateTime } from 'luxon';
import { SourceDisabledError } from '@fab5/source-gate';

export const timeoutError = () =>
  Object.assign(new Error('operation exceeded time limit'), { code: 50, codeName: 'MaxTimeMSExpired' });

const getPath = (doc, path) =>
  path
    .split('.')
    .reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), doc);

const comparable = (value) => (value instanceof Date ? value.getTime() : value);

const equal = (value, operand) => {
  if (operand === null) return value === null || value === undefined;
  if (operand instanceof Date) return value instanceof Date && value.getTime() === operand.getTime();
  return value === operand;
};

const isOperators = (condition) =>
  condition !== null &&
  typeof condition === 'object' &&
  !(condition instanceof Date) &&
  Object.keys(condition).length > 0 &&
  Object.keys(condition).every((key) => key.startsWith('$'));

const operator = (op, value, operand) => {
  switch (op) {
    case '$ne':
      return !equal(value, operand);
    case '$exists':
      return (value !== undefined) === operand;
    case '$in':
      return operand.some((item) => equal(value, item));
    case '$nin':
      return !operand.some((item) => equal(value, item));
    case '$type':
      return operand === 'date' ? value instanceof Date : false;
    case '$gt':
      return value !== undefined && comparable(value) > comparable(operand);
    case '$gte':
      return value !== undefined && comparable(value) >= comparable(operand);
    case '$lt':
      return value !== undefined && comparable(value) < comparable(operand);
    case '$lte':
      return value !== undefined && comparable(value) <= comparable(operand);
    default:
      throw new Error(`unsupported operator ${op}`);
  }
};

export const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch));
    const value = getPath(doc, key);
    if (isOperators(condition)) {
      return Object.entries(condition).every(([op, operand]) => operator(op, value, operand));
    }
    return equal(value, condition);
  });

const sortDocs = (docs, spec) => {
  const keys = Object.keys(spec);
  return [...docs].sort((a, b) => {
    for (const key of keys) {
      const left = comparable(getPath(a, key));
      const right = comparable(getPath(b, key));
      if (left === right) continue;
      if (left === undefined) return -1 * spec[key];
      if (right === undefined) return 1 * spec[key];
      return (left < right ? -1 : 1) * spec[key];
    }
    return 0;
  });
};

export function createCollection({ name = 'c', docs = [], log = [], sourceId = null } = {}) {
  const store = docs.map((doc) => structuredClone(doc));
  const failures = {};
  const collection = {
    name,
    store,
    failures,
    record(entry) {
      log.push({ sourceId, view: name, ...entry });
    },
    guard(op) {
      if (failures[op]) throw failures[op];
    },
    find(filter = {}, options = {}) {
      const state = { filter, sort: options.sort ?? null, limit: options.limit ?? null, maxTimeMS: null };
      const run = () => {
        collection.guard('find');
        collection.record({
          op: 'find',
          limit: state.limit,
          maxTimeMS: state.maxTimeMS,
          sort: state.sort,
          filter
        });
        let found = store.filter((doc) => matches(doc, state.filter));
        if (state.sort) found = sortDocs(found, state.sort);
        if (state.limit !== null) found = found.slice(0, state.limit);
        return found.map((doc) => structuredClone(doc));
      };
      const cursor = {
        sort(spec) {
          state.sort = spec;
          return cursor;
        },
        limit(value) {
          state.limit = value;
          return cursor;
        },
        project() {
          return cursor;
        },
        maxTimeMS(value) {
          state.maxTimeMS = value;
          return cursor;
        },
        async toArray() {
          return run();
        },
        async *[Symbol.asyncIterator]() {
          for (const doc of run()) yield doc;
        }
      };
      return cursor;
    },
    async findOne(filter = {}, options = {}) {
      let found = store.filter((doc) => matches(doc, filter));
      if (options.sort) found = sortDocs(found, options.sort);
      return found[0] ? structuredClone(found[0]) : null;
    },
    async countDocuments(filter = {}, options = {}) {
      collection.guard('count');
      collection.record({ op: 'countDocuments', maxTimeMS: options.maxTimeMS ?? null });
      return store.filter((doc) => matches(doc, filter)).length;
    },
    async estimatedDocumentCount(options = {}) {
      collection.guard('count');
      collection.record({ op: 'estimatedDocumentCount', maxTimeMS: options.maxTimeMS ?? null });
      return store.length;
    },
    aggregate(pipeline, options = {}) {
      return {
        async toArray() {
          collection.guard('aggregate');
          collection.record({ op: 'aggregate', maxTimeMS: options.maxTimeMS ?? null, pipeline });
          const group = pipeline.find((stage) => stage.$group)?.$group;
          const field = group._id.$dateToString.date.slice(1);
          const buckets = new Map();
          for (const doc of store) {
            const value = doc[field];
            if (!(value instanceof Date)) continue;
            const key = DateTime.fromJSDate(value, { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM');
            buckets.set(key, (buckets.get(key) ?? 0) + 1);
          }
          return [...buckets.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, count]) => ({ _id: key, count }));
        }
      };
    },
    async insertOne(doc) {
      store.push(structuredClone(doc));
      return { insertedId: doc._id };
    },
    async bulkWrite(operations) {
      for (const { replaceOne } of operations) {
        const index = store.findIndex((doc) => matches(doc, replaceOne.filter));
        if (index >= 0) store[index] = structuredClone(replaceOne.replacement);
        else if (replaceOne.upsert) store.push(structuredClone(replaceOne.replacement));
      }
      collection.bulkWrites = (collection.bulkWrites ?? 0) + operations.length;
    },
    async deleteMany(filter) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        if (matches(store[index], filter)) store.splice(index, 1);
      }
    }
  };
  return collection;
}

export function createMemoryDb(seed = {}) {
  const collections = new Map();
  const db = {
    collection(name) {
      if (!collections.has(name)) collections.set(name, createCollection({ name, docs: seed[name] ?? [] }));
      return collections.get(name);
    }
  };
  return db;
}

export function createSourceClients(sourceViews, log) {
  const clients = {};
  for (const [sourceId, views] of Object.entries(sourceViews)) {
    const collections = {};
    for (const [view, docs] of Object.entries(views)) {
      collections[view] = createCollection({ name: view, docs, log, sourceId });
    }
    clients[sourceId] = { collections, db: () => ({ collection: (view) => collections[view] }) };
  }
  return clients;
}

export function createFakeGate({ sources, clients, limits = { pageSize: 500, maxTimeMs: 30000 } }) {
  const gate = {
    calls: [],
    switchOffAfter: null,
    async read(sourceId, fn, ctx = {}) {
      const source = sources.find((entry) => entry._id === sourceId);
      if (source.state !== 'active') throw new SourceDisabledError(sourceId, source.state);
      if (gate.switchOffAfter && gate.calls.length >= gate.switchOffAfter.reads) {
        gate.switchOffAfter.source.state = 'paused';
        throw new SourceDisabledError(sourceId, 'paused');
      }
      gate.calls.push({ sourceId, ctx });
      const controller = new AbortController();
      const outcome = await fn(clients[sourceId], { signal: controller.signal, limits });
      return outcome && typeof outcome === 'object' && 'value' in outcome ? outcome.value : outcome;
    }
  };
  return gate;
}

export function createFixedClock(start = '2026-09-01T00:00:00.000Z') {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    monotonic: () => ms,
    advance(delta) {
      ms += delta;
    }
  };
}

export const d = (text) => new Date(text);

export const sourceDoc = (id, overrides = {}) => ({
  _id: id,
  engine: 'mongodb',
  kind: 'real',
  logicalSource: id,
  state: 'active',
  onDisable: 'keep',
  ...overrides
});
