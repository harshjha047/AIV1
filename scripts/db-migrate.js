import { loadConfig } from '@fab5/shared/config';
import { createLogger } from '@fab5/shared/logger';
import { getMigrationStatus, openSnapshotDb, runMigrations } from '@fab5/snapshot-db';
import { migrations } from './migrations/index.js';

const config = loadConfig({ require: ['mongoUri'] });
const log = createLogger({ name: 'db-migrate', level: config.logLevel });
const statusOnly = process.argv.includes('--status');

const connection = await openSnapshotDb({ uri: config.mongoUri });
try {
  const result = statusOnly
    ? await getMigrationStatus(connection.db, migrations)
    : await runMigrations(connection.db, migrations, { context: { mode: config.mode } });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  log.error({ err: error }, 'migration failed');
  process.exitCode = 1;
} finally {
  await connection.close();
}
