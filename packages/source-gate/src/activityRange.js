import { getViewAllowList, listViews } from '@fab5/shared/pii';

const MONGO_DATE_FIELDS = ['updatedAt', 'parentUpdatedAt', 'createdAt', 'date'];
const PG_DATE_FIELDS = ['last_activity_at', 'updated_at', 'created_at', 'sent_at', 'joined_at'];

export function dateFieldFor(engine, view) {
  const names = new Set([
    ...view.include,
    ...(view.computed ?? []).map((field) => field.name),
    ...Object.keys(view.unwind?.rootAs ?? {}),
    ...(view.unwind?.include ?? [])
  ]);
  const candidates = engine === 'postgres' ? PG_DATE_FIELDS : MONGO_DATE_FIELDS;
  return candidates.find((name) => names.has(name)) ?? null;
}

export function planActivityRange(sourceId, exposedObjects) {
  const definitions = listViews(sourceId).map((name) => ({ name, view: getViewAllowList(sourceId, name) }));
  const exposed = exposedObjects ? new Set(exposedObjects.map((name) => String(name).split('.').pop())) : null;
  return definitions
    .filter(({ name }) => !exposed || exposed.has(name))
    .map(({ name, view }) => ({ name, view, field: dateFieldFor(view.relation ? 'postgres' : 'mongodb', view) }))
    .filter((entry) => entry.field !== null);
}

const asDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function mongoRange(client, plan, limits, signal) {
  let min = null;
  let max = null;
  let rows = 0;
  for (const { name, field } of plan) {
    if (signal?.aborted) throw signal.reason;
    const collection = client.db().collection(name);
    const options = { maxTimeMS: limits.maxTimeMs, projection: { [field]: 1, _id: 0 } };
    const [newest] = await collection.find({ [field]: { $type: 'date' } }, { ...options, sort: { [field]: -1 }, limit: 1 }).toArray();
    const [oldest] = await collection.find({ [field]: { $type: 'date' } }, { ...options, sort: { [field]: 1 }, limit: 1 }).toArray();
    rows += (newest ? 1 : 0) + (oldest ? 1 : 0);
    const high = asDate(newest?.[field]);
    const low = asDate(oldest?.[field]);
    if (high && (!max || high > max)) max = high;
    if (low && (!min || low < min)) min = low;
  }
  return { min, max, rows };
}

async function postgresRange(client, plan, limits, signal) {
  let min = null;
  let max = null;
  let rows = 0;
  for (const { name, field } of plan) {
    if (signal?.aborted) throw signal.reason;
    const result = await client.query(
      `SELECT min("${field}") AS min, max("${field}") AS max FROM ai_export."${name}"`
    );
    const row = result.rows[0] ?? {};
    rows += 1;
    const low = asDate(row.min);
    const high = asDate(row.max);
    if (high && (!max || high > max)) max = high;
    if (low && (!min || low < min)) min = low;
  }
  return { min, max, rows };
}

export async function readActivityRange({ gate, registry, sourceId, ctx = {} }) {
  const source = await registry.get(sourceId);
  const plan = planActivityRange(source.viewsFrom ?? source.logicalSource ?? sourceId, source.exposedObjects);
  if (plan.length === 0) return { sourceId, min: null, max: null };
  const outcome = await gate.read(
    sourceId,
    async (client, { signal, limits }) => {
      const range =
        source.engine === 'postgres'
          ? await postgresRange(client, plan, limits, signal)
          : await mongoRange(client, plan, limits, signal);
      return { value: { min: range.min, max: range.max }, rows: range.rows };
    },
    { ...ctx, entity: 'activity_range', action: 'activity_range', estimatedRows: plan.length * 2, triggeredBy: ctx.triggeredBy ?? 'mode' }
  );
  return { sourceId, min: outcome.min, max: outcome.max };
}

export function createActivityRangeProvider({ gate, registry, logger }) {
  return async function activityRange() {
    const sources = await registry.list();
    const active = sources.filter((source) => source.state === 'active');
    const results = [];
    for (const source of active) {
      try {
        results.push(await readActivityRange({ gate, registry, sourceId: source._id }));
      } catch (error) {
        logger?.warn?.({ err: error.message, sourceId: source._id }, 'activity range unavailable');
      }
    }
    return results;
  };
}
