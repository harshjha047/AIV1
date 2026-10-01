export const ROUTES = Object.freeze(['night_draft', 'night_review', 'live_small', 'live_large', 'refine', 'embed']);
export const TEXT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TEXT_CAP = 20000;

export function createUsageStore(collection) {
  return {
    async insert(doc) {
      const result = await collection.insertOne(doc);
      return result.insertedId ?? doc._id;
    },
    async update(id, patch) {
      await collection.updateOne({ _id: id }, { $set: patch });
    }
  };
}

const cap = (text) => String(text ?? '').slice(0, TEXT_CAP);

export function buildUsageEvent({ ts, ctx, model, stats, attempts, outcome, errorClass, elapsedMs, ttftMs, text, textLogging }) {
  const doc = {
    ts,
    route: ctx.route,
    model,
    attempts,
    outcome,
    totalMs: stats.totalMs ?? Math.round(elapsedMs),
    ttftMs: ttftMs === null || ttftMs === undefined ? null : Math.round(ttftMs)
  };
  for (const key of ['requestId', 'jobId', 'employeeId', 'intent']) {
    if (ctx[key] !== undefined && ctx[key] !== null) doc[key] = String(ctx[key]);
  }
  if (typeof ctx.queueWaitMs === 'number') doc.queueWaitMs = Math.round(ctx.queueWaitMs);
  for (const key of ['loadMs', 'promptEvalMs', 'evalMs', 'promptTokens', 'completionTokens', 'decodeTokPerSec', 'promptTokPerSec']) {
    if (stats[key] !== null && stats[key] !== undefined) doc[key] = stats[key];
  }
  if (errorClass) doc.errorClass = errorClass;
  if (textLogging && text) {
    doc.text = { prompt: cap(text.prompt), answer: cap(text.answer) };
    doc.textExpireAt = new Date(ts.getTime() + TEXT_TTL_MS);
  }
  return doc;
}

export function activityFor(doc, usageId) {
  const level = doc.outcome === 'ok' ? 'info' : doc.outcome === 'error' || doc.outcome === 'timeout' ? 'error' : 'warn';
  const tokens =
    doc.promptTokens !== undefined || doc.completionTokens !== undefined
      ? ` ${doc.promptTokens ?? 0}+${doc.completionTokens ?? 0} tok`
      : '';
  return {
    kind: 'llm_call',
    level,
    action: doc.route,
    ok: doc.outcome === 'ok',
    durationMs: doc.totalMs,
    refType: 'llm_usage',
    refId: usageId === undefined || usageId === null ? undefined : String(usageId),
    message: `${doc.model} ${doc.outcome}${tokens}${doc.errorClass ? ` ${doc.errorClass}` : ''}`
  };
}
