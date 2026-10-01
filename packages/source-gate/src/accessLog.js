import { safeMessage } from '@fab5/shared/redact';

export function createAccessLogStore(collection) {
  return {
    async insert(doc) {
      await collection.insertOne(doc);
    }
  };
}

export function createAccessLog({ store, clock, activity, logger }) {
  async function write(doc) {
    try {
      await store.insert(doc);
    } catch (error) {
      logger?.error?.({ err: error.message, sourceId: doc.sourceId }, 'access log write failed');
    }
  }

  function base(sourceId, ctx, action) {
    const doc = {
      ts: clock.now(),
      sourceId,
      action,
      triggeredBy: ctx.triggeredBy ?? 'schedule'
    };
    if (ctx.entity) doc.entity = ctx.entity;
    if (ctx.runId) doc.runId = ctx.runId;
    return doc;
  }

  async function read(sourceId, ctx, rows, durationMs, stateAtRead = 'active') {
    const action = ctx.action ?? 'read_page';
    await write({
      ...base(sourceId, ctx, action),
      rows,
      durationMs: Math.round(durationMs),
      ok: true,
      stateAtRead
    });
    await activity?.emit({
      kind: 'source_read',
      sourceId,
      action: ctx.entity ?? action,
      count: rows,
      durationMs,
      runId: ctx.runId
    });
  }

  async function blocked(sourceId, state, ctx = {}, reason) {
    const doc = {
      ...base(sourceId, ctx, 'blocked'),
      rows: 0,
      durationMs: 0,
      ok: false,
      stateAtRead: state
    };
    if (reason) doc.error = safeMessage(reason, 200);
    await write(doc);
    await activity?.emit({
      kind: 'blocked',
      sourceId,
      level: 'info',
      action: ctx.entity ?? 'read',
      ok: false
    });
  }

  async function failed(sourceId, ctx, error, durationMs, stateAtRead = 'active') {
    await write({
      ...base(sourceId, ctx, ctx.action ?? 'read_page'),
      rows: 0,
      durationMs: Math.round(durationMs),
      ok: false,
      error: safeMessage(error, 200),
      stateAtRead
    });
    await activity?.emit({
      kind: 'source_read',
      sourceId,
      level: 'warn',
      action: ctx.entity ?? 'read',
      ok: false,
      durationMs,
      message: safeMessage(error, 200)
    });
  }

  async function verify(sourceId, ctx, ok, durationMs, error) {
    const doc = {
      ...base(sourceId, ctx, 'verify'),
      rows: 0,
      durationMs: Math.round(durationMs),
      ok
    };
    if (error) doc.error = safeMessage(error, 200);
    await write(doc);
  }

  return { read, blocked, failed, verify };
}
