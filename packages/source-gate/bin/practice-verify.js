import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { MongoClient } from 'mongodb';
import { viewsSpecs } from '@fab5/sources';
import { assertLocalUri } from '../src/practice/safety.js';
import { verifyPractice } from '../src/practice/verify.js';

const [sourceId, database] = process.argv.slice(2);
const uri = process.env[`PRACTICE_${String(sourceId).toUpperCase()}_AI_URI`];
const statusFile = process.env.PRACTICE_STATUS_FILE ?? 'ops/practice/status.json';

if (!sourceId || !database || !uri || !viewsSpecs[sourceId]) {
  console.error('usage: PRACTICE_<ID>_AI_URI=... practice-verify <sourceId> <database>');
  process.exit(1);
}

assertLocalUri(uri, { allowRemote: process.env.PRACTICE_ALLOW_REMOTE === '1' });
const client = new MongoClient(uri, { maxPoolSize: 1 });
try {
  await client.connect();
  const result = await verifyPractice({ client, spec: viewsSpecs[sourceId], database });
  const existing = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : {};
  existing[sourceId] = result;
  mkdirSync(dirname(statusFile), { recursive: true });
  writeFileSync(statusFile, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await client.close();
}
