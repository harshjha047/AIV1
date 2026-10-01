import { cipherFromEnv } from '@fab5/shared/cipher';
import { createRealClock } from '@fab5/shared/clock';
import { createModeService, createModeStore, modeFromEnv } from '@fab5/shared/mode';
import { createRunNow } from '@fab5/shared/runNow';
import {
  createActivityRangeProvider,
  createMemoryBus,
  createRedisBus,
  createRuntime,
  loadSnapshotDb
} from '@fab5/source-gate';
import { createApp } from './app.js';
import { createClientStore } from './auth/clientStore.js';
import { createEmployeeStore } from './auth/employeeStore.js';
import { createMemoryReplayCache, createRedisReplayCache } from './auth/replayCache.js';
import { createMemoryRateLimiter, createRedisRateLimiter } from './auth/rateLimiter.js';

export async function createServer({ env = process.env, logger = console, handle, redis } = {}) {
  const mode = modeFromEnv(env);
  const production = mode === 'production';
  const requireSignature = env.AI_REQUIRE_SIGNATURE !== 'false';
  if (production && !requireSignature) throw new Error('AI_REQUIRE_SIGNATURE=false is not allowed when MODE=production');
  if (production && !env.REDIS_URL && !redis) throw new Error('REDIS_URL is required when MODE=production');

  const clock = createRealClock();
  const snapshot = handle ?? (await loadSnapshotDb());
  const db = snapshot.db;
  const cache =
    redis ?? (env.REDIS_URL ? new (await import('ioredis')).default(env.REDIS_URL, { maxRetriesPerRequest: 2 }) : null);
  const bus = env.REDIS_URL ? await createRedisBus({ url: env.REDIS_URL, logger }) : createMemoryBus();

  const queued = [];
  const enqueue = cache
    ? async (name, payload) => {
        await cache.lpush(`ai:jobs:${name}`, JSON.stringify(payload));
      }
    : async (name, payload) => {
        queued.push({ name, payload });
      };

  const runtime = createRuntime({ db, env, clock, bus, logger, processName: 'ai-service' });
  const modeService = createModeService({
    store: createModeStore(db.collection('meta')),
    real: clock,
    env,
    activityRange: createActivityRangeProvider({ gate: runtime.gate, registry: runtime.registry, logger }),
    audit: runtime.audit,
    activity: runtime.activity,
    bus,
    logger
  });
  await modeService.load();
  modeService.start();

  const limiter = cache ? createRedisRateLimiter({ redis: cache, clock }) : createMemoryRateLimiter({ clock });
  const replay = cache ? createRedisReplayCache({ redis: cache }) : createMemoryReplayCache({ clock });
  const runNow = createRunNow({ mode: modeService, enqueue, activity: runtime.activity, audit: runtime.audit });

  const app = createApp({
    clients: createClientStore(db.collection('ai_clients')),
    employees: createEmployeeStore(db.collection('employees')),
    replay,
    limiter,
    cipher: cipherFromEnv(env, { keyVar: 'AI_CLIENT_MASTER_KEY' }),
    clock,
    mode: modeService,
    runNow,
    logger,
    requireSignature
  });

  async function close() {
    modeService.stop();
    await bus.close?.();
    await cache?.quit?.();
    await snapshot.close?.();
  }

  return { app, mode: modeService, runNow, runtime, queued, close };
}
