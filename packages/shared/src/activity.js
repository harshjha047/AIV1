import { safeMessage } from './redact.js';

export const ACTIVITY_KINDS = Object.freeze([
  'source_read',
  'blocked',
  'sync_run',
  'kpi_compute',
  'draft',
  'validate',
  'llm_call',
  'toggle',
  'verify',
  'inventory',
  'purge',
  'alert'
]);

export const ACTIVITY_LEVELS = Object.freeze(['info', 'warn', 'error']);

const BLOCKED_WINDOW_MS = 60000;

export function createActivityStore(collection) {
  return {
    async insert(doc) {
      const result = await collection.insertOne(doc);
      return result.insertedId;
    },
    async increment(id, amount) {
      await collection.updateOne({ _id: id }, { $inc: { count: amount } });
    }
  };
}

export function createActivityEmitter({ store, clock, logger }) {
  const blocked = new Map();

  function build(event) {
    if (!ACTIVITY_KINDS.includes(event.kind)) throw new TypeError(`Unknown activity kind ${event.kind}`);
    const level = event.level ?? 'info';
    if (!ACTIVITY_LEVELS.includes(level)) throw new TypeError(`Unknown activity level ${level}`);
    const doc = {
      ts: clock.now(),
      kind: event.kind,
      level,
      action: String(event.action ?? event.kind),
      ok: event.ok ?? level !== 'error'
    };
    if (event.sourceId) doc.sourceId = event.sourceId;
    if (event.count !== undefined && event.count !== null) doc.count = event.count;
    if (event.durationMs !== undefined && event.durationMs !== null) {
      doc.durationMs = Math.round(event.durationMs);
    }
    if (event.runId) doc.runId = event.runId;
    const ref = event.ref ?? {};
    if (event.refType ?? ref.type) doc.refType = event.refType ?? ref.type;
    if (event.refId ?? ref.id) doc.refId = String(event.refId ?? ref.id);
    if (event.message) doc.message = safeMessage(event.message, 200);
    return doc;
  }

  async function emitBlocked(doc) {
    const bucket = Math.floor(doc.ts.getTime() / BLOCKED_WINDOW_MS);
    const key = doc.sourceId ?? '';
    const current = blocked.get(key);
    if (current && current.bucket === bucket) {
      const id = await current.idPromise;
      await store.increment(id, 1);
      return;
    }
    const idPromise = store.insert({ ...doc, count: 1 });
    blocked.set(key, { bucket, idPromise });
    try {
      await idPromise;
    } catch (error) {
      blocked.delete(key);
      throw error;
    }
  }

  async function emit(event) {
    const doc = build(event);
    try {
      if (doc.kind === 'blocked') {
        await emitBlocked(doc);
        return null;
      }
      return await store.insert(doc);
    } catch (error) {
      logger?.warn?.({ err: error.message, kind: doc.kind }, 'activity emit failed');
      return null;
    }
  }

  return { emit };
}

export function createAlertStore(collection) {
  return {
    async findOpen(ruleId, dedupeKey) {
      return collection.findOne({ ruleId, 'context.dedupeKey': dedupeKey, closedAt: { $exists: false } });
    },
    async insert(doc) {
      const result = await collection.insertOne(doc);
      return result.insertedId;
    }
  };
}

export function createAlerts({ store, clock, activity }) {
  async function raise({ ruleId, severity = 'warn', message, context = {} }) {
    const dedupeKey = context.dedupeKey ?? ruleId;
    const existing = await store.findOpen(ruleId, dedupeKey);
    if (existing) return existing._id;
    const id = await store.insert({
      ruleId,
      severity,
      message: safeMessage(message, 300),
      openedAt: clock.now(),
      ack: null,
      context: { ...context, dedupeKey }
    });
    await activity?.emit({
      kind: 'alert',
      level: severity === 'info' ? 'info' : severity === 'critical' ? 'error' : 'warn',
      action: ruleId,
      message,
      sourceId: context.sourceId,
      ref: { type: 'alert', id }
    });
    return id;
  }
  return { raise };
}

export function createAudit({ store, clock }) {
  async function record({ actorEmployeeId, action, target, reason, before, after, requestId }) {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (action.startsWith('source.') && trimmed.length === 0) {
      throw new TypeError('A reason is required for source actions');
    }
    const doc = {
      actorEmployeeId,
      action,
      target,
      reason: trimmed.slice(0, 500),
      at: clock.now()
    };
    if (before !== undefined) doc.before = before;
    if (after !== undefined) doc.after = after;
    if (requestId) doc.requestId = requestId;
    await store.insert(doc);
    return doc;
  }
  return { record };
}

export function createCollectionStore(collection) {
  return {
    async insert(doc) {
      const result = await collection.insertOne(doc);
      return result.insertedId;
    }
  };
}
