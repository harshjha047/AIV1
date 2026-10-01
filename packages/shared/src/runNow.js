import { randomUUID } from 'node:crypto';
import { ModeError, dateKeyOf } from './clock.js';

export const RUN_NOW_JOB = 'pipeline.run_now';

export function createRunNow({ mode, enqueue, activity, audit, idFactory = () => `run-${randomUUID()}` }) {
  let running = null;

  async function trigger({ actorEmployeeId, reason, sources } = {}) {
    if (!mode.isPractice()) throw new ModeError('Run now is available in practice mode only', 'RUN_NOW_DISABLED');
    if (running) throw new ModeError('A run is already in progress', 'RUN_IN_PROGRESS', { runId: running });
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed) throw new ModeError('A reason is required', 'REASON_REQUIRED');
    const state = mode.state();
    if (!state.referenceDate) throw new ModeError('No reference date is set', 'NO_REFERENCE_DATE');
    const runId = idFactory();
    running = runId;
    const payload = {
      runId,
      trigger: 'run_now',
      referenceDate: dateKeyOf(state.referenceDate),
      requestedBy: actorEmployeeId ?? null,
      sources: Array.isArray(sources) && sources.length > 0 ? [...sources] : null
    };
    try {
      await enqueue(RUN_NOW_JOB, payload);
    } catch (error) {
      running = null;
      throw error;
    }
    await audit?.record({
      actorEmployeeId,
      action: 'pipeline.run_now',
      target: runId,
      reason: trimmed,
      after: { referenceDate: payload.referenceDate, sources: payload.sources }
    });
    await activity?.emit({ kind: 'sync_run', action: 'run_now.requested', runId, message: `reference ${payload.referenceDate}` });
    return { runId, referenceDate: payload.referenceDate };
  }

  function finished(runId) {
    if (running === runId) running = null;
  }

  return { trigger, finished, current: () => running };
}
