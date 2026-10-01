import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { assertLocalUri } from '../src/practice/safety.js';
import { recordSamples } from '../src/practice/record.js';

const [sourceId, database] = process.argv.slice(2);
const uri = process.env[`PRACTICE_${String(sourceId).toUpperCase()}_ADMIN_URI`] ?? 'mongodb://127.0.0.1:27017';
const out = process.env.PRACTICE_SAMPLES_DIR ?? 'ops/samples';

if (!sourceId || !database) {
  console.error('usage: practice-record <sourceId> <database>');
  process.exit(1);
}

assertLocalUri(uri, { allowRemote: process.env.PRACTICE_ALLOW_REMOTE === '1' });
const client = new MongoClient(uri, { maxPoolSize: 1 });
try {
  await client.connect();
  const folder = join(out, sourceId);
  mkdirSync(folder, { recursive: true });
  const summary = await recordSamples({
    db: client.db(database),
    sourceId,
    sampleSize: Number(process.env.PRACTICE_SAMPLE_SIZE ?? 300),
    write: async (name, data) => writeFileSync(join(folder, name), `${JSON.stringify(data, null, 2)}\n`)
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.problems.length > 0 ? 1 : 0;
} finally {
  await client.close();
}
