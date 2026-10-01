import { loadConfig } from '@fab5/shared/config';
import { createLogger } from '@fab5/shared/logger';
import { ensureIndexes, openSnapshotDb } from '@fab5/snapshot-db';

const config = loadConfig({ require: ['mongoUri'] });
const log = createLogger({ name: 'ensure-indexes', level: config.logLevel });

const connection = await openSnapshotDb({ uri: config.mongoUri });
try {
  const { count, llmTextStore } = await ensureIndexes(connection.db);
  console.log(JSON.stringify({ indexes: count, llmTextStore }, null, 2));
} catch (error) {
  log.error({ err: error }, 'ensure indexes failed');
  process.exitCode = 1;
} finally {
  await connection.close();
}
