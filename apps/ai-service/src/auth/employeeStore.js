export function createEmployeeStore(collection) {
  return {
    async findByEmail(email) {
      return collection.findOne({ email });
    },
    async get(id) {
      return collection.findOne({ _id: id });
    },
    async upsertSeed(doc) {
      const { createdAt, ...rest } = doc;
      await collection.updateOne({ _id: doc._id }, { $set: rest, $setOnInsert: { createdAt } }, { upsert: true });
      return doc;
    }
  };
}
