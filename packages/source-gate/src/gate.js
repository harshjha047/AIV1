import { resolveLimits } from './constants.js';
import { SourceDisabledError, SourceGateError } from './errors.js';

function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export function createSourceGate({
  registry,
  vault,
  limiter,
  accessLog,
  engines,
  activity,
  queue,
  processName = 'ai-service',
  monotonic = () => performance.now(),
  logger
}) {
  const clients = new Map();
  const inflight = new Map();
  const generations = new Map();
  const closed = new Set();

  const generationOf = (id) => generations.get(id) ?? 0;

  function engineFor(source) {
    const engine = engines[source.engine];
    if (!engine) throw new SourceGateError(`No engine for ${source.engine}`, 'NO_ENGINE');
    return engine;
  }

  async function safely(promise) {
    try {
      await promise;
    } catch (error) {
      logger?.error?.({ err: error.message }, 'gate side effect failed');
    }
  }

  function ensureClient(source) {
    const existing = clients.get(source._id);
    if (existing) return existing.promise;
    const engine = engineFor(source);
    const generation = generationOf(source._id);
    const entry = { engine, promise: null, client: null };
    entry.promise = (async () => {
      const secret = await vault.get(source);
      const client = await engine.connect(source, secret);
      if (generationOf(source._id) !== generation) {
        await engine.close(client).catch(() => {});
        throw new SourceDisabledError(source._id, 'inactive');
      }
      entry.client = client;
      closed.delete(source._id);
      return client;
    })();
    clients.set(source._id, entry);
    entry.promise.catch(() => {
      if (clients.get(source._id) === entry) clients.delete(source._id);
    });
    return entry.promise;
  }

  async function read(sourceId, fn, ctx = {}) {
    const source = await registry.get(sourceId);
    if (source.state !== 'active') {
      await safely(accessLog.blocked(sourceId, source.state, ctx));
      throw new SourceDisabledError(sourceId, source.state);
    }
    const limits = resolveLimits(source);
    const controller = new AbortController();
    const set = inflight.get(sourceId) ?? new Set();
    set.add(controller);
    inflight.set(sourceId, set);
    const estimated = ctx.estimatedRows ?? limits.pageSize;
    const started = monotonic();
    try {
      await limiter.take(sourceId, estimated, limits.rowsPerMin);
      const client = await raceAbort(ensureClient(source), controller.signal);
      const result = await raceAbort(
        Promise.resolve(fn(client, { signal: controller.signal, limits })),
        controller.signal
      );
      const hasShape = result && typeof result === 'object' && 'value' in result;
      const rows = hasShape ? (result.rows ?? 0) : 0;
      limiter.settle(sourceId, estimated, rows, limits.rowsPerMin);
      await safely(accessLog.read(sourceId, ctx, rows, monotonic() - started, source.state));
      return hasShape ? result.value : result;
    } catch (error) {
      if (controller.signal.aborted) {
        await safely(accessLog.blocked(sourceId, 'inactive', ctx, 'aborted'));
        throw controller.signal.reason;
      }
      await safely(accessLog.failed(sourceId, ctx, error, monotonic() - started, source.state));
      throw error;
    } finally {
      set.delete(controller);
    }
  }

  async function withTemporaryClient(sourceId, fn, ctx = {}) {
    const source = await registry.store.get(sourceId);
    if (!source) throw new SourceGateError(`Unknown source ${sourceId}`, 'SOURCE_NOT_FOUND');
    const engine = engineFor(source);
    const started = monotonic();
    let client = null;
    try {
      const secret = await vault.resolveOnce(source);
      client = await engine.connect(source, secret);
      const value = await fn(client, { engine, source });
      await safely(accessLog.verify(sourceId, ctx, true, monotonic() - started));
      return value;
    } catch (error) {
      await safely(accessLog.verify(sourceId, ctx, false, monotonic() - started, error));
      throw error;
    } finally {
      if (client) await engine.close(client).catch(() => {});
    }
  }

  async function leaveActive(sourceId, reason = 'inactive') {
    generations.set(sourceId, generationOf(sourceId) + 1);
    for (const controller of inflight.get(sourceId) ?? []) {
      controller.abort(new SourceDisabledError(sourceId, reason));
    }
    inflight.delete(sourceId);
    const entry = clients.get(sourceId);
    clients.delete(sourceId);
    let cancelled = 0;
    try {
      if (entry?.client) {
        try {
          await entry.engine.close(entry.client);
        } catch (error) {
          logger?.warn?.({ err: error.message, sourceId }, 'pool close failed');
        }
      }
    } finally {
      vault.wipe(sourceId);
      closed.add(sourceId);
      try {
        cancelled = (await queue?.cancelBySource?.(sourceId)) ?? 0;
      } catch (error) {
        logger?.warn?.({ err: error.message, sourceId }, 'queue cancel failed');
      }
      await safely(
        Promise.resolve(
          activity?.emit({
            kind: 'toggle',
            sourceId,
            action: 'pool_closed',
            count: cancelled,
            message: `reason=${reason}`
          })
        )
      );
      await reportPools();
    }
    return { cancelledJobs: cancelled };
  }

  function poolState(sourceId) {
    const entry = clients.get(sourceId);
    if (entry) return { state: 'open', size: entry.engine.poolSize?.() ?? 0 };
    return { state: 'closed', size: 0 };
  }

  async function reportPools(now = new Date()) {
    const ids = new Set([...clients.keys(), ...closed]);
    for (const id of ids) {
      const { state, size } = poolState(id);
      await registry.reportPool(id, processName, { state, size, updatedAt: now });
    }
  }

  function startPoolHeartbeat({ intervalMs = 30000, clock }) {
    const timer = setInterval(() => {
      reportPools(clock.now()).catch(() => {});
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  function subscribe(bus) {
    return bus.subscribe('ai:source:changed', (message) => {
      if (!message?.sourceId) return;
      registry.invalidate(message.sourceId);
      if (message.state !== 'active') {
        leaveActive(message.sourceId, message.state).catch((error) =>
          logger?.error?.({ err: error.message }, 'leaveActive failed')
        );
      }
    });
  }

  return {
    read,
    leaveActive,
    withTemporaryClient,
    poolState,
    reportPools,
    startPoolHeartbeat,
    subscribe,
    invalidate: registry.invalidate
  };
}
