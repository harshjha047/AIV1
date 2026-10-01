import { loadConfig } from '@fab5/shared/config';
import { COLLECTIONS, MIGRATIONS_COLLECTION, openSnapshotDb } from '@fab5/snapshot-db';

const config = loadConfig({ require: ['mongoUri'] });
const connection = await openSnapshotDb({ uri: config.mongoUri });

try {
  const live = (await connection.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  const missing = COLLECTIONS.filter((name) => !live.includes(name));
  const meta = (await connection.db.collection('meta').find({}).toArray()).map((d) => d._id).sort();
  const validated = (await connection.db.listCollections({ name: 'employees' }).toArray())[0]?.options?.validationAction;
  const report = {
    collections: live.length,
    expected: COLLECTIONS.length + 1,
    missing,
    hasMigrationsCollection: live.includes(MIGRATIONS_COLLECTION),
    meta,
    employeesValidationAction: validated ?? null,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = missing.length === 0 && meta.length === 5 && validated === 'error' ? 0 : 1;
} finally {
  await connection.close();
}