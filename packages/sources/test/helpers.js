const comparable = (value) => (value instanceof Date ? value.getTime() : value);

const compare = (left, right) => {
  const a = comparable(left);
  const b = comparable(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const matches = (doc, filter) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch));
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      return Object.entries(condition).every(([op, operand]) => {
        const result = compare(doc[key], operand);
        if (op === '$gt') return result > 0;
        if (op === '$gte') return result >= 0;
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return compare(doc[key], condition) === 0;
  });

export function createFakeView(docs) {
  const view = {
    queries: [],
    find(filter = {}) {
      const state = { filter, sort: null, limit: Infinity, maxTimeMS: null };
      const chain = {
        sort(spec) {
          state.sort = spec;
          return chain;
        },
        limit(value) {
          state.limit = value;
          return chain;
        },
        maxTimeMS(value) {
          state.maxTimeMS = value;
          return chain;
        },
        async toArray() {
          view.queries.push({ ...state });
          const found = docs.filter((doc) => matches(doc, state.filter));
          if (state.sort) {
            const keys = Object.keys(state.sort);
            found.sort((a, b) => {
              for (const key of keys) {
                const result = compare(a[key], b[key]) * state.sort[key];
                if (result !== 0) return result;
              }
              return 0;
            });
          }
          return found.slice(0, state.limit);
        }
      };
      return chain;
    }
  };
  return view;
}

export function createFakeClient(views) {
  return { db: () => ({ collection: (name) => views[name] }) };
}

export function createFakeGate({ views, pageSize = 3, maxTimeMs = 30000 } = {}) {
  const client = createFakeClient(views);
  const gate = {
    calls: [],
    async read(sourceId, fn, ctx = {}) {
      gate.calls.push({ sourceId, ctx });
      const controller = new AbortController();
      const outcome = await fn(client, {
        signal: controller.signal,
        limits: { pageSize, maxTimeMs }
      });
      return outcome && typeof outcome === 'object' && 'value' in outcome ? outcome.value : outcome;
    }
  };
  return gate;
}

export function createFakeCollection() {
  const docs = new Map();
  return {
    docs,
    async findOne(filter) {
      const doc = docs.get(filter._id);
      return doc ? structuredClone(doc) : null;
    },
    async updateOne(filter, update, options = {}) {
      const existing = docs.get(filter._id);
      if (!existing && !options.upsert) return { matchedCount: 0 };
      docs.set(filter._id, { ...(existing ?? { _id: filter._id }), ...update.$set });
      return { matchedCount: existing ? 1 : 0 };
    }
  };
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

export function trackAccess(value, path = '', seen = new Set()) {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  return new Proxy(value, {
    get(target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver);
      const next = path ? `${path}.${key}` : key;
      if (!Array.isArray(target)) seen.add(next);
      return trackAccess(Reflect.get(target, key, receiver), next, seen);
    }
  });
}

export function trackedDoc(doc) {
  const seen = new Set();
  return { proxy: trackAccess(doc, '', seen), seen };
}
