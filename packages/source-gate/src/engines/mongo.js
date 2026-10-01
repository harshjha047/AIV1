import { MongoClient } from 'mongodb';
import { POOL_SIZES } from '../constants.js';

export function createMongoEngine({ MongoClientImpl = MongoClient } = {}) {
  return {
    kind: 'mongodb',
    async connect(source, secret) {
      const client = new MongoClientImpl(secret, {
        maxPoolSize: POOL_SIZES.mongodb,
        minPoolSize: 0,
        appName: 'fab5-ai-gate',
        readPreference: source.mode === 'production' ? 'secondaryPreferred' : 'primary',
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
      });
      await client.connect();
      return client;
    },
    async close(client) {
      await client.close(true);
    },
    async ping(client) {
      await client.db().command({ ping: 1 });
    },
    poolSize() {
      return POOL_SIZES.mongodb;
    }
  };
}
