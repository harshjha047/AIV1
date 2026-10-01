import { createAlertStore, createAlerts, createActivityEmitter, createActivityStore, createAudit, createCollectionStore } from '@fab5/shared/activity';
import { cipherFromEnv } from '@fab5/shared/cipher';
import { createAccessLog, createAccessLogStore } from './accessLog.js';
import { createCredentialResolver, createCredentialStore } from './credentials/store.js';
import { createSourceGate } from './gate.js';
import { createRowLimiter } from './limiter.js';
import { createSourceLifecycle } from './lifecycle.js';
import { createDataSourceStore, createRegistry } from './registry.js';
import { createVault } from './vault.js';
import { createVerifier } from './verify/verifier.js';
import { createMongoEngine } from './engines/mongo.js';
import { createPostgresEngine } from './engines/postgres.js';

export async function loadSnapshotDb() {
  const mod = await import('@fab5/snapshot-db');
  const factory =
    mod.connectSnapshotDb ?? mod.createSnapshotDb ?? mod.connectSnapshot ?? mod.connect ?? mod.default;
  if (typeof factory !== 'function') {
    throw new Error('@fab5/snapshot-db must export connectSnapshotDb()');
  }
  const handle = await factory();
  const db = handle.db ?? handle;
  const close = handle.close ? () => handle.close() : async () => {};
  return { db, close };
}

export function createRuntime({ db, env = process.env, clock, bus, logger, queue, processName }) {
  const activity = createActivityEmitter({
    store: createActivityStore(db.collection('activity_events')),
    clock,
    logger
  });
  const audit = createAudit({ store: createCollectionStore(db.collection('admin_audit')), clock });
  const alerts = createAlerts({ store: createAlertStore(db.collection('alerts')), clock, activity });
  const store = createDataSourceStore(db.collection('data_sources'));
  const registry = createRegistry({
    store,
    bus,
    ttlMs: Number(env.SOURCE_STATE_TTL_S ?? 5) * 1000,
    logger
  });
  const credentialStore = env.SOURCE_CRED_MASTER_KEY
    ? createCredentialStore({
        collection: db.collection('source_credentials'),
        cipher: cipherFromEnv(env),
        clock
      })
    : null;
  const vault = createVault({ resolver: createCredentialResolver({ env, store: credentialStore }) });
  const accessLog = createAccessLog({
    store: createAccessLogStore(db.collection('source_access_log')),
    clock,
    activity,
    logger
  });
  const gate = createSourceGate({
    registry,
    vault,
    limiter: createRowLimiter(),
    accessLog,
    engines: { mongodb: createMongoEngine(), postgres: createPostgresEngine() },
    activity,
    queue,
    processName,
    logger
  });
  const verifier = createVerifier({ gate, store, registry, clock, activity });
  const lifecycle = createSourceLifecycle({
    store,
    registry,
    gate,
    verifier,
    audit,
    bus,
    alerts,
    clock,
    activity,
    logger
  });
  registry.start();
  if (bus) gate.subscribe(bus);
  return {
    activity,
    audit,
    alerts,
    store,
    registry,
    credentialStore,
    vault,
    accessLog,
    gate,
    verifier,
    lifecycle
  };
}
