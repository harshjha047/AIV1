import { safeMessage } from '@fab5/shared/redact';
import { verifyMongo } from './mongo.js';
import { verifyPostgres } from './postgres.js';

const CHECKS = { mongodb: verifyMongo, postgres: verifyPostgres };

export function createVerifier({ gate, store, registry, clock, activity, monotonic = () => performance.now() }) {
  async function run(sourceId, { triggeredBy = 'manual' } = {}) {
    const started = monotonic();
    let result;
    try {
      result = await gate.withTemporaryClient(
        sourceId,
        (client, { source }) => CHECKS[source.engine](client, source),
        { triggeredBy }
      );
    } catch (error) {
      result = {
        ok: false,
        status: 'fail',
        authEnforced: false,
        details: { engine: null, error: safeMessage(error, 200) }
      };
    }
    const stored = { ...result, checkedAt: clock.now() };
    await store.update(sourceId, { readOnlyCheck: stored, updatedAt: stored.checkedAt });
    registry.invalidate(sourceId);
    await activity?.emit({
      kind: 'verify',
      sourceId,
      level: stored.status === 'ok' ? 'info' : stored.status === 'warn' ? 'warn' : 'error',
      action: `readonly_${stored.status}`,
      ok: stored.status !== 'fail',
      durationMs: monotonic() - started,
      message: stored.status === 'warn' ? 'authentication not enforced' : undefined
    });
    return stored;
  }
  return { run };
}
