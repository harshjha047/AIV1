import { cipherFromEnv } from '@fab5/shared/cipher';
import { createRealClock } from '@fab5/shared/clock';
import { loadSnapshotDb } from '@fab5/source-gate';
import { createClientAdmin, createClientStore } from '../apps/ai-service/src/auth/clientStore.js';
import { createEmployeeStore } from '../apps/ai-service/src/auth/employeeStore.js';
import { seedHubClient, seedLocalAdmin } from '../apps/ai-service/src/auth/seed.js';

const clock = createRealClock();
const handle = await loadSnapshotDb();
try {
  const store = createClientStore(handle.db.collection('ai_clients'));
  const admin = createClientAdmin({ store, cipher: cipherFromEnv(process.env, { keyVar: 'AI_CLIENT_MASTER_KEY' }), clock });
  const hub = await seedHubClient({ admin, store });
  await seedLocalAdmin({ employees: createEmployeeStore(handle.db.collection('employees')), env: process.env, clock });
  if (hub.created) {
    process.stdout.write(`HUB_APP_KEY=${hub.appKey}\nHUB_SIGNING_SECRET=${hub.signingSecret}\n`);
  } else {
    process.stdout.write('hub client already exists\n');
  }
} finally {
  await handle.close();
}
