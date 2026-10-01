export const createFakeDb = ({ existing = [], indexFailures = {}, createFailures = {} } = {}) => {
  const collections = new Map(existing.map((name) => [name, new Map()]));
  const calls = { createCollection: [], command: [], createIndex: [], failedIndex: [] };

  const store = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  const failure = (code, message) => Object.assign(new Error(message), { code });

  const collection = (name) => ({
    find: () => {
      const cursor = {
        sort: () => cursor,
        toArray: async () => [...store(name).values()].sort((a, b) => (a._id < b._id ? -1 : 1)),
      };
      return cursor;
    },
    insertOne: async (document) => {
      const documents = store(name);
      if (documents.has(document._id)) throw failure(11000, 'duplicate key');
      documents.set(document._id, { ...document });
      return { acknowledged: true };
    },
    updateOne: async (filter, update, options = {}) => {
      const documents = store(name);
      const current = documents.get(filter._id);
      if (current) {
        Object.assign(current, update.$set ?? {});
        return { upsertedCount: 0, matchedCount: 1 };
      }
      if (!options.upsert) return { upsertedCount: 0, matchedCount: 0 };
      documents.set(filter._id, {
        _id: filter._id,
        ...(update.$setOnInsert ?? {}),
        ...(update.$set ?? {}),
      });
      return { upsertedCount: 1, matchedCount: 0 };
    },
    createIndex: async (keys, options) => {
      const code = indexFailures[`${name}.${options.name}`];
      if (code) {
        calls.failedIndex.push({ collection: name, name: options.name, code });
        throw failure(code, 'index conflict');
      }
      calls.createIndex.push({ collection: name, keys, options });
      return options.name;
    },
    indexes: async () =>
      calls.createIndex
        .filter((call) => call.collection === name)
        .map((call) => ({ name: call.options.name, key: call.keys })),
  });

  const db = {
    collection,
    createCollection: async (name, options) => {
      calls.createCollection.push({ name, options });
      if (createFailures[name]) throw failure(createFailures[name], 'create failed');
      if (collections.has(name)) throw failure(48, 'already exists');
      collections.set(name, new Map());
      return collection(name);
    },
    command: async (command) => {
      calls.command.push(command);
      return { ok: 1 };
    },
  };

  return { db, calls, store };
};
