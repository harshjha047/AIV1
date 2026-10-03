export function createCursorStore({ collection, clock }) {
  const keyOf = (sourceId, entity) => `${sourceId}:${entity}`;

  return {
    keyOf,
    async load(sourceId, entity) {
      const doc = await collection.findOne({ _id: keyOf(sourceId, entity) });
      return doc?.cursor ?? null;
    },
    async get(sourceId, entity) {
      return (await collection.findOne({ _id: keyOf(sourceId, entity) })) ?? null;
    },
    async save(sourceId, entity, cursor) {
      await collection.updateOne(
        { _id: keyOf(sourceId, entity) },
        { $set: { cursor, updatedAt: clock.now() } },
        { upsert: true }
      );
    },
    async markSuccess(sourceId, entity, { cursor, fullLoad = false } = {}) {
      const now = clock.now();
      const set = { lastSuccessAt: now, lastError: null, updatedAt: now };
      if (cursor !== undefined) set.cursor = cursor;
      if (fullLoad) set.lastFullLoadAt = now;
      await collection.updateOne({ _id: keyOf(sourceId, entity) }, { $set: set }, { upsert: true });
    },
    async markError(sourceId, entity, message) {
      await collection.updateOne(
        { _id: keyOf(sourceId, entity) },
        { $set: { lastError: String(message).slice(0, 200), updatedAt: clock.now() } },
        { upsert: true }
      );
    },
    async markIdReconcile(sourceId, entity) {
      await collection.updateOne(
        { _id: keyOf(sourceId, entity) },
        { $set: { lastIdReconcileAt: clock.now() } },
        { upsert: true }
      );
    },
    async reset(sourceId, entity) {
      await collection.updateOne(
        { _id: keyOf(sourceId, entity) },
        { $set: { cursor: null, updatedAt: clock.now() } },
        { upsert: true }
      );
    }
  };
}
