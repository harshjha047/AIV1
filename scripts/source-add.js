import { cipherFromEnv } from '@fab5/shared/cipher';
import { createRealClock } from '@fab5/shared/clock';
import { SourceAddError, createCredentialStore, createDataSourceStore, loadSnapshotDb, readSecret, runSourceAdd } from '@fab5/source-gate';

if (!process.env.SOURCE_CRED_MASTER_KEY) {
  console.error('SOURCE_CRED_MASTER_KEY is required');
  process.exit(1);
}

const clock = createRealClock();
const handle = await loadSnapshotDb();
try {
  const argv = process.argv.slice(2);
  await runSourceAdd({
    argv,
    clock,
    store: createDataSourceStore(handle.db.collection('data_sources')),
    credentials: createCredentialStore({ collection: handle.db.collection('source_credentials'), cipher: cipherFromEnv(process.env), clock }),
    secretReader: () => readSecret({ prompt: 'Read-only connection string (input hidden): ' })
  });
} catch (error) {
  console.error(error instanceof SourceAddError ? error.message : 'source:add failed');
  process.exitCode = 1;
} finally {
  await handle.close();
}
