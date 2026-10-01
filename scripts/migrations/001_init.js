import { ensureCollections, ensureIndexes, seedMeta } from '@fab5/snapshot-db';

export default {
  id: '001_init',
  version: 1,
  up: async (db, { now, mode = 'practice' }) => {
    await ensureCollections(db);
    await ensureIndexes(db);
    await seedMeta(db, { now, mode });
  },
};
