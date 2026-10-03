import { safeMessage } from '@fab5/shared/redact';
import { entitySpecs } from '@fab5/sources';
import { buildReadiness, writeReadiness } from './readiness.js';
import { createSnapshotMetrics } from './snapshotMetrics.js';
import { countSourceRows, isDisabledError, probeEntityDetails } from './sourceProbes.js';
import { PROFILE_DATA } from './constants.js';

const MINUTE_MS = 60000;
const MONGO = 'mongodb';

const viewsKeyOf = (source) => source.viewsFrom ?? source.logicalSource ?? source._id;

const specsFor = (source) => entitySpecs[viewsKeyOf(source)] ?? null;

const pick = (fresh, previous) => (fresh === undefined ? (previous ?? null) : fresh);

const profileEntities = () => {
  const keys = new Set();
  for (const entries of Object.values(PROFILE_DATA)) {
    for (const { sourceId, entity } of entries) keys.add(`${sourceId}.${entity}`);
  }
  return [...keys].map((key) => {
    const at = key.indexOf('.');
    return { sourceId: key.slice(0, at), entity: key.slice(at + 1) };
  });
};

export function createInventoryCollector({
  gate,
  registry,
  snapshotDb,
  clock,
  activity,
  logger,
  refreshMinutes = 15
}) {
  const inventory = snapshotDb.collection('source_inventory');
  const metrics = createSnapshotMetrics({ db: snapshotDb });
  const inflight = new Map();
  const cacheMs = refreshMinutes * MINUTE_MS;

  async function latestRow(sourceId, entity) {
    return inventory.findOne({ sourceId, entity }, { sort: { ts: -1 } });
  }

  async function emit(event) {
    try {
      await activity?.emit({ kind: 'inventory', ...event });
    } catch (error) {
      logger?.warn?.({ err: error.message }, 'inventory activity failed');
    }
  }

  async function refreshEntity({ source, spec, session, triggeredBy, runId }) {
    const sourceId = source._id;
    const previous = await latestRow(sourceId, spec.entity);
    const counted = await countSourceRows({ gate, sourceId, spec, triggeredBy, runId });
    const details = await probeEntityDetails({
      gate,
      sourceId,
      viewsKey: viewsKeyOf(source),
      spec,
      triggeredBy,
      runId
    });
    const syncedRows = await session.syncedRows(sourceId, spec);
    const flags = await session.flagsFor(sourceId, spec);
    const mappingCoverage = await session.mappingCoverage(spec);

    const row = {
      ts: clock.now(),
      sourceId,
      entity: spec.entity,
      sourceRows: counted.rows ?? previous?.sourceRows ?? null,
      syncedRows,
      minDate: pick(details.minDate, previous?.minDate),
      maxDate: pick(details.maxDate, previous?.maxDate),
      lastUpdatedAt: pick(details.lastUpdatedAt, previous?.lastUpdatedAt),
      perMonth: details.perMonth ?? previous?.perMonth ?? [],
      flags,
      countTimedOut: counted.rows === null
    };
    if (mappingCoverage) row.mappingCoverage = mappingCoverage;
    await inventory.insertOne(row);
    return {
      entity: spec.entity,
      timedOut: counted.timedOut || details.failures.some((failure) => failure.timedOut),
      failed:
        (counted.error !== null && !counted.timedOut ? 1 : 0) +
        details.failures.filter((failure) => !failure.timedOut).length
    };
  }

  async function refreshSource({ source, session, triggeredBy, runId }) {
    const specs = specsFor(source);
    if (!specs) return { status: 'skipped', reason: 'no_entity_specs' };
    if (source.engine && source.engine !== MONGO) return { status: 'skipped', reason: 'unsupported_engine' };
    if (source.state !== 'active') return { status: 'skipped', reason: source.state };

    const started = clock.monotonic();
    const entities = [];
    try {
      for (const spec of Object.values(specs)) {
        entities.push(await refreshEntity({ source, spec, session, triggeredBy, runId }));
      }
    } catch (error) {
      if (isDisabledError(error)) {
        await emit({
          sourceId: source._id,
          level: 'warn',
          action: 'inventory aborted',
          count: entities.length,
          durationMs: clock.monotonic() - started,
          ok: false,
          runId,
          message: 'source left active'
        });
        return { status: 'aborted', reason: error.state ?? 'inactive', entities: entities.length };
      }
      await emit({
        sourceId: source._id,
        level: 'error',
        action: 'inventory failed',
        count: entities.length,
        durationMs: clock.monotonic() - started,
        ok: false,
        runId,
        message: safeMessage(error, 200)
      });
      return { status: 'failed', reason: safeMessage(error, 200), entities: entities.length };
    }
    const timedOut = entities.filter((entry) => entry.timedOut).length;
    const failed = entities.reduce((sum, entry) => sum + entry.failed, 0);
    await emit({
      sourceId: source._id,
      level: timedOut > 0 || failed > 0 ? 'warn' : 'info',
      action: 'inventory refreshed',
      count: entities.length,
      durationMs: clock.monotonic() - started,
      ok: true,
      runId,
      message: timedOut > 0 || failed > 0 ? `timeouts=${timedOut} errors=${failed}` : undefined
    });
    return { status: 'ok', entities: entities.length, timedOut, failed };
  }

  async function isFresh(source) {
    const specs = specsFor(source);
    if (!specs) return false;
    const now = clock.now().getTime();
    for (const spec of Object.values(specs)) {
      const row = await latestRow(source._id, spec.entity);
      if (!row || now - new Date(row.ts).getTime() >= cacheMs) return false;
    }
    return true;
  }

  async function latestInventory() {
    const rows = new Map();
    const syncedBySource = new Map();
    const wanted = new Map(profileEntities().map((entry) => [`${entry.sourceId}.${entry.entity}`, entry]));
    for (const [sourceId, specs] of Object.entries(entitySpecs)) {
      for (const entity of Object.keys(specs)) {
        const row = await latestRow(sourceId, entity);
        if (!row) continue;
        syncedBySource.set(sourceId, (syncedBySource.get(sourceId) ?? 0) + (row.syncedRows ?? 0));
        if (wanted.has(`${sourceId}.${entity}`)) rows.set(`${sourceId}.${entity}`, row);
      }
    }
    return { rows, syncedBySource };
  }

  async function rebuildReadiness(session) {
    const sources = await registry.list();
    const { rows, syncedBySource } = await latestInventory();
    const employees = await snapshotDb
      .collection('employees')
      .find({ active: true }, { projection: { _id: 1, active: 1 } })
      .toArray();
    const profileEntries = await snapshotDb
      .collection('employee_kpi_profiles')
      .find({}, { projection: { employeeId: 1, profile: 1, effectiveFrom: 1, effectiveTo: 1 } })
      .toArray();
    const facts = await session.facts();
    const docs = buildReadiness({
      employees,
      profileEntries,
      inventory: rows,
      sources,
      syncedBySource,
      facts,
      now: clock.now()
    });
    return writeReadiness({ collection: snapshotDb.collection('kpi_readiness'), docs });
  }

  async function run({ sourceIds = null, triggeredBy = 'schedule', force = false, runId = null }) {
    const started = clock.monotonic();
    const sources = await registry.list();
    const session = metrics.session();
    const result = {};
    for (const source of sources) {
      if (!specsFor(source)) continue;
      if (sourceIds && !sourceIds.includes(source._id)) continue;
      if (source.state === 'active' && !force && (await isFresh(source))) {
        result[source._id] = { status: 'cached' };
        continue;
      }
      result[source._id] = await refreshSource({ source, session, triggeredBy, runId });
    }
    let readiness = null;
    try {
      readiness = await rebuildReadiness(session);
    } catch (error) {
      logger?.error?.({ err: error.message }, 'kpi readiness rebuild failed');
      await emit({
        level: 'error',
        action: 'kpi readiness failed',
        ok: false,
        runId,
        message: safeMessage(error, 200)
      });
    }
    return { durationMs: clock.monotonic() - started, sources: result, readiness };
  }

  function refresh(options = {}) {
    const key = options.sourceIds ? [...options.sourceIds].sort().join(',') : '*';
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = run(options).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  async function snapshot({ sourceId = null } = {}) {
    const rows = [];
    for (const [id, specs] of Object.entries(entitySpecs)) {
      if (sourceId && id !== sourceId) continue;
      for (const entity of Object.keys(specs)) {
        const row = await latestRow(id, entity);
        if (row) rows.push(row);
      }
    }
    return rows;
  }

  return { refresh, snapshot, rebuildReadiness: () => rebuildReadiness(metrics.session()) };
}

export function createInventoryScheduler({ collector, intervalMinutes = 15, logger }) {
  let timer = null;
  const tick = () =>
    collector.refresh({ triggeredBy: 'schedule' }).catch((error) =>
      logger?.error?.({ err: error.message }, 'inventory tick failed')
    );
  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMinutes * MINUTE_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick
  };
}
