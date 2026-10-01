import { MongoClient } from 'mongodb';
import { SNAPSHOT_DB_NAME } from './constants.js';

const DB_PATH = /^mongodb(?:\+srv)?:\/\/[^/?]*\/([^?]*)/i;

export const snapshotDbNameFromUri = (uri) => {
  const match = DB_PATH.exec(uri);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

export const assertSnapshotUri = (uri) => {
  if (typeof uri !== 'string' || !/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new Error('AI_MONGO_URI must be a mongodb:// or mongodb+srv:// URI');
  }
  const name = snapshotDbNameFromUri(uri);
  if (name !== null && name !== SNAPSHOT_DB_NAME) {
    throw new Error(`snapshot-db is hard-wired to ${SNAPSHOT_DB_NAME}, received ${name}`);
  }
  return uri;
};

export const openSnapshotDb = async ({
  uri,
  appName = 'fab5-ai-snapshot',
  maxPoolSize = 5,
  serverSelectionTimeoutMS = 10000,
} = {}) => {
  assertSnapshotUri(uri);
  const client = new MongoClient(uri, {
    appName,
    maxPoolSize,
    minPoolSize: 0,
    serverSelectionTimeoutMS,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(SNAPSHOT_DB_NAME);
  return {
    client,
    db,
    ping: async () => (await db.command({ ping: 1 })).ok === 1,
    close: () => client.close(),
  };
};
