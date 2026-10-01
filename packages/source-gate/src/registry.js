import { SOURCE_CHANGED_CHANNEL, DEFAULT_STATE_TTL_MS } from './constants.js';
import { SourceNotFoundError, SourceRegistryError } from './errors.js';

export function createDataSourceStore(collection) {
  return {
    async get(id) {
      return collection.findOne({ _id: id });
    },
    async list() {
      return collection.find({}).toArray();
    },
    async insert(doc) {
      await collection.insertOne(doc);
      return doc;
    },
    async update(id, patch) {
      return collection.findOneAndUpdate(
        { _id: id },
        { $set: patch },
        { returnDocument: 'after' }
      );
    },
    async transition(id, fromStates, patch) {
      return collection.findOneAndUpdate(
        { _id: id, state: { $in: fromStates } },
        { $set: patch },
        { returnDocument: 'after' }
      );
    },
    async setPool(id, processName, pool) {
      if (!/^[a-z0-9_-]+$/i.test(processName)) throw new TypeError('Invalid process name');
      await collection.updateOne({ _id: id }, { $set: { [`pools.${processName}`]: pool } });
    }
  };
}

export function createRegistry({
  store,
  bus,
  monotonic = () => performance.now(),
  ttlMs = DEFAULT_STATE_TTL_MS,
  logger
}) {
  const cache = new Map();
  const epochs = new Map();
  let listCache = null;
  let unsubscribe = null;

  const epochOf = (id) => epochs.get(id) ?? 0;

  async function load(id) {
    const startEpoch = epochOf(id);
    let doc;
    try {
      doc = await store.get(id);
    } catch (error) {
      throw new SourceRegistryError(id, error);
    }
    if (!doc) throw new SourceNotFoundError(id);
    if (epochOf(id) === startEpoch) cache.set(id, { doc, at: monotonic() });
    return doc;
  }

  async function get(id) {
    const hit = cache.get(id);
    if (hit && monotonic() - hit.at < ttlMs) return hit.doc;
    return load(id);
  }

  async function list() {
    if (listCache && monotonic() - listCache.at < ttlMs) return listCache.docs;
    let docs;
    try {
      docs = await store.list();
    } catch (error) {
      throw new SourceRegistryError('*', error);
    }
    listCache = { docs, at: monotonic() };
    return docs;
  }

  function invalidate(id) {
    listCache = null;
    if (id === undefined) {
      cache.clear();
      for (const key of epochs.keys()) epochs.set(key, epochOf(key) + 1);
      return;
    }
    cache.delete(id);
    epochs.set(id, epochOf(id) + 1);
  }

  async function reportPool(id, processName, pool) {
    try {
      await store.setPool(id, processName, pool);
    } catch (error) {
      logger?.warn?.({ err: error.message, sourceId: id }, 'pool heartbeat failed');
    }
  }

  function start() {
    if (!bus || unsubscribe) return;
    unsubscribe = bus.subscribe(SOURCE_CHANGED_CHANNEL, (message) => invalidate(message?.sourceId));
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
  }

  return { get, list, invalidate, reportPool, start, stop, store };
}
