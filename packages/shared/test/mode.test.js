import { describe, expect, it } from 'vitest';
import {
  ModeError,
  createModeClock,
  createRealClock,
  dateKeyOf,
  parseReferenceDate
} from '../src/clock.js';
import { MODE_CHANGED_CHANNEL, createModeService, createModeStore, modeFromEnv } from '../src/mode.js';
import { RUN_NOW_JOB, createRunNow } from '../src/runNow.js';
import { relativePeriodKeys, todayKey } from '../src/today.js';

const realNow = new Date('2026-10-01T05:00:00.000Z');
const fixedReal = () => createRealClock({ now: () => new Date(realNow.getTime()), monotonic: () => 0 });

function memoryCollection(initial) {
  let doc = initial ?? null;
  return {
    get doc() {
      return doc;
    },
    async findOne() {
      return doc ? structuredClone(doc) : null;
    },
    async replaceOne(_filter, next) {
      doc = structuredClone(next);
    }
  };
}

function memoryBus() {
  const handlers = new Set();
  return {
    published: [],
    async publish(channel, message) {
      this.published.push({ channel, message });
      for (const handler of handlers) handler(message);
    },
    subscribe(channel, handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }
  };
}

function build({ env = { MODE: 'practice' }, ranges = [], doc, bus } = {}) {
  const collection = memoryCollection(doc);
  const audits = [];
  const events = [];
  const state = { ranges };
  const service = createModeService({
    store: createModeStore(collection),
    real: fixedReal(),
    env,
    activityRange: async () => state.ranges,
    audit: { record: async (entry) => audits.push(entry) },
    activity: { emit: async (event) => events.push(event) },
    bus
  });
  return { service, collection, audits, events, state };
}

const range = (sourceId, min, max) => ({ sourceId, min: new Date(min), max: new Date(max) });

describe('reference dates', () => {
  it('parses a date key to noon IST', () => {
    const parsed = parseReferenceDate('2026-08-14');
    expect(parsed.toISOString()).toBe('2026-08-14T06:30:00.000Z');
    expect(dateKeyOf(parsed)).toBe('2026-08-14');
  });

  it('maps late UTC instants to the IST calendar day', () => {
    expect(dateKeyOf(new Date('2026-08-13T20:00:00Z'))).toBe('2026-08-14');
    expect(parseReferenceDate(new Date('2026-08-13T20:00:00Z')).toISOString()).toBe('2026-08-14T06:30:00.000Z');
  });

  it('rejects invalid values', () => {
    for (const value of ['2026-13-01', 'yesterday', 42, null, '2026-8-1']) {
      expect(() => parseReferenceDate(value)).toThrow(ModeError);
    }
  });
});

describe('mode clock', () => {
  it('returns the reference date in practice and real time in production', () => {
    const state = { mode: 'practice', referenceDate: parseReferenceDate('2026-08-14') };
    const clock = createModeClock({ real: fixedReal(), getState: () => state });
    expect(clock.now().toISOString()).toBe('2026-08-14T06:30:00.000Z');
    expect(clock.realNow().toISOString()).toBe(realNow.toISOString());
    expect(clock.isReference()).toBe(true);
    state.mode = 'production';
    expect(clock.now().toISOString()).toBe(realNow.toISOString());
    expect(clock.isReference()).toBe(false);
  });

  it('falls back to real time when no reference date exists', () => {
    const clock = createModeClock({ real: fixedReal(), getState: () => ({ mode: 'practice', referenceDate: null }) });
    expect(clock.now().toISOString()).toBe(realNow.toISOString());
  });

  it('does not let callers mutate the reference state', () => {
    const { service } = build();
    const first = service.clock.now();
    first.setUTCFullYear(1999);
    expect(service.clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('today resolves to the reference date', () => {
  it('uses the reference date for today, month and week', () => {
    const clock = createModeClock({
      real: fixedReal(),
      getState: () => ({ mode: 'practice', referenceDate: parseReferenceDate('2026-08-14') })
    });
    expect(todayKey(clock)).toBe('2026-08-14');
    expect(relativePeriodKeys(clock)).toEqual({
      today: '2026-08-14',
      month: '2026-08',
      lastMonth: '2026-07',
      week: '2026-W33',
      lastWeek: '2026-W32'
    });
  });

  it('uses the real date in production', () => {
    const clock = createModeClock({ real: fixedReal(), getState: () => ({ mode: 'production', referenceDate: null }) });
    expect(relativePeriodKeys(clock)).toMatchObject({ today: '2026-10-01', month: '2026-10', lastMonth: '2026-09', week: '2026-W40' });
  });

  it('handles month boundaries and year ends', () => {
    const clock = createModeClock({
      real: fixedReal(),
      getState: () => ({ mode: 'practice', referenceDate: parseReferenceDate('2026-01-02') })
    });
    expect(relativePeriodKeys(clock)).toMatchObject({ month: '2026-01', lastMonth: '2025-12', week: '2026-W01', lastWeek: '2025-W52' });
  });
});

describe('mode from env', () => {
  it('defaults to production and rejects unknown values', () => {
    expect(modeFromEnv({})).toBe('production');
    expect(modeFromEnv({ MODE: 'practice' })).toBe('practice');
    expect(() => modeFromEnv({ MODE: 'demo' })).toThrow(ModeError);
  });
});

describe('mode service load', () => {
  it('initialises a practice document with auto reference from active sources', async () => {
    const { service, collection } = build({
      ranges: [range('crm', '2026-06-14T10:00:00Z', '2026-08-14T08:00:00Z'), range('bahikhata', '2026-05-01T00:00:00Z', '2026-08-10T00:00:00Z')]
    });
    await service.load();
    expect(service.state()).toMatchObject({ mode: 'practice', referenceAuto: true });
    expect(dateKeyOf(service.state().referenceDate)).toBe('2026-08-14');
    expect(dateKeyOf(collection.doc.referenceDate)).toBe('2026-08-14');
    expect(service.clock.now().toISOString()).toBe('2026-08-14T06:30:00.000Z');
  });

  it('caps the auto date at the real date', async () => {
    const { service } = build({ ranges: [range('crm', '2026-06-14', '2027-03-01')] });
    await service.load();
    expect(dateKeyOf(service.state().referenceDate)).toBe('2026-10-01');
  });

  it('keeps the real clock when no active source has data', async () => {
    const { service } = build({ ranges: [] });
    await service.load();
    expect(service.state().referenceDate).toBeNull();
    expect(service.clock.now().toISOString()).toBe(realNow.toISOString());
  });

  it('survives a failing range provider', async () => {
    const collection = memoryCollection();
    const service = createModeService({
      store: createModeStore(collection),
      real: fixedReal(),
      env: { MODE: 'practice' },
      activityRange: async () => {
        throw new Error('gate down');
      }
    });
    await expect(service.load()).resolves.toMatchObject({ mode: 'practice', referenceDate: null });
  });

  it('forces production and clears the reference date when MODE=production', async () => {
    const { service, collection } = build({
      env: { MODE: 'production' },
      doc: { mode: 'practice', referenceDate: parseReferenceDate('2026-08-14'), referenceAuto: false }
    });
    await service.load();
    expect(service.state()).toMatchObject({ mode: 'production', referenceDate: null, referenceAuto: false });
    expect(collection.doc.mode).toBe('production');
    expect(service.clock.now().toISOString()).toBe(realNow.toISOString());
  });

  it('keeps a fixed override across restarts', async () => {
    const { service } = build({
      doc: { mode: 'practice', referenceDate: parseReferenceDate('2026-07-01'), referenceAuto: false },
      ranges: [range('crm', '2026-06-14', '2026-08-14')]
    });
    await service.load();
    expect(dateKeyOf(service.state().referenceDate)).toBe('2026-07-01');
  });
});

describe('mode service update', () => {
  const actor = { actorEmployeeId: 'emp1', reason: 'demo for finance' };

  it('overrides the reference date, audits and announces', async () => {
    const bus = memoryBus();
    const { service, audits, events } = build({ bus, ranges: [range('crm', '2026-06-14', '2026-08-14')] });
    await service.load();
    await service.update({ referenceDate: '2026-07-20' }, actor);
    expect(service.state()).toMatchObject({ referenceAuto: false, updatedBy: 'emp1' });
    expect(dateKeyOf(service.state().referenceDate)).toBe('2026-07-20');
    expect(audits[0]).toMatchObject({
      action: 'mode.update',
      target: 'meta.mode',
      reason: 'demo for finance',
      before: { referenceDate: '2026-08-14', referenceAuto: true },
      after: { referenceDate: '2026-07-20', referenceAuto: false }
    });
    expect(events[0]).toMatchObject({ kind: 'toggle', action: 'mode.update' });
    expect(bus.published.at(-1)).toEqual({ channel: MODE_CHANGED_CHANNEL, message: { mode: 'practice', reason: 'update' } });
  });

  it('switches back to auto and recomputes', async () => {
    const { service } = build({ ranges: [range('crm', '2026-06-14', '2026-08-14')] });
    await service.load();
    await service.update({ referenceDate: '2026-07-20' }, actor);
    await service.update({ referenceAuto: true }, actor);
    expect(service.state().referenceAuto).toBe(true);
    expect(dateKeyOf(service.state().referenceDate)).toBe('2026-08-14');
  });

  it('refuses without a reason, in the future, with conflicts and with a mode change', async () => {
    const { service } = build();
    await service.load();
    await expect(service.update({ referenceDate: '2026-07-20' }, { actorEmployeeId: 'e', reason: '  ' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(service.update({ referenceDate: '2026-10-02' }, actor)).rejects.toMatchObject({ code: 'REFERENCE_IN_FUTURE' });
    await expect(service.update({ referenceDate: '2026-07-20', referenceAuto: true }, actor)).rejects.toMatchObject({ code: 'REFERENCE_CONFLICT' });
    await expect(service.update({ mode: 'production' }, actor)).rejects.toMatchObject({ code: 'MODE_ENV_MISMATCH' });
    await expect(service.update({ referenceDate: 'nope' }, actor)).rejects.toMatchObject({ code: 'INVALID_REFERENCE_DATE' });
  });

  it('is locked in production', async () => {
    const { service } = build({ env: { MODE: 'production' } });
    await service.load();
    await expect(service.update({ referenceDate: '2026-07-20' }, actor)).rejects.toMatchObject({ code: 'PRODUCTION_LOCKED' });
    expect(service.state().referenceDate).toBeNull();
  });

  it('reloads state published by another process', async () => {
    const bus = memoryBus();
    const { service, collection } = build({ bus });
    await service.load();
    service.start({ intervalMs: 0 });
    collection.replaceOne({}, {
      mode: 'practice',
      referenceDate: parseReferenceDate('2026-06-30'),
      referenceAuto: false,
      updatedBy: 'other',
      updatedAt: realNow
    });
    await bus.publish(MODE_CHANGED_CHANNEL, { mode: 'practice' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(dateKeyOf(service.state().referenceDate)).toBe('2026-06-30');
    service.stop();
  });
});

describe('banner and describe', () => {
  it('returns the practice banner text and data range', async () => {
    const { service } = build({ ranges: [range('crm', '2026-06-14T10:00:00Z', '2026-08-14T08:00:00Z')] });
    await service.load();
    expect(await service.banner()).toEqual({
      practice: true,
      text: 'PRACTICE MODE: reference date 2026-08-14, data from 2026-06-14 to 2026-08-14',
      referenceDate: '2026-08-14',
      dataFrom: '2026-06-14',
      dataTo: '2026-08-14',
      runNowEnabled: true
    });
  });

  it('shows placeholders when no data range is known', async () => {
    const { service } = build({ ranges: [] });
    await service.load();
    expect((await service.banner()).text).toBe('PRACTICE MODE: reference date real clock, data from n/a to n/a');
  });

  it('has no banner in production', async () => {
    const { service } = build({ env: { MODE: 'production' } });
    await service.load();
    expect(await service.banner()).toEqual({ practice: false, text: null, referenceDate: null, dataFrom: null, dataTo: null, runNowEnabled: false });
  });

  it('describes mode for the admin endpoint', async () => {
    const { service } = build({ ranges: [range('crm', '2026-06-14', '2026-08-14')] });
    await service.load();
    const view = await service.describe();
    expect(view).toMatchObject({ mode: 'practice', referenceDate: '2026-08-14', referenceAuto: true });
    expect(view.sources).toEqual([{ sourceId: 'crm', from: '2026-06-14', to: '2026-08-14' }]);
  });
});

describe('run now', () => {
  const actor = { actorEmployeeId: 'emp1', reason: 'first pipeline run' };

  it('enqueues a run against the reference date and blocks concurrent runs', async () => {
    const { service } = build({ ranges: [range('crm', '2026-06-14', '2026-08-14')] });
    await service.load();
    const jobs = [];
    const audits = [];
    const runNow = createRunNow({
      mode: service,
      enqueue: async (name, payload) => jobs.push({ name, payload }),
      audit: { record: async (entry) => audits.push(entry) },
      idFactory: () => 'run-1'
    });
    const result = await runNow.trigger({ ...actor, sources: ['crm'] });
    expect(result).toEqual({ runId: 'run-1', referenceDate: '2026-08-14' });
    expect(jobs).toEqual([
      {
        name: RUN_NOW_JOB,
        payload: { runId: 'run-1', trigger: 'run_now', referenceDate: '2026-08-14', requestedBy: 'emp1', sources: ['crm'] }
      }
    ]);
    expect(audits[0]).toMatchObject({ action: 'pipeline.run_now', target: 'run-1' });
    await expect(runNow.trigger(actor)).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });
    runNow.finished('run-1');
    expect(runNow.current()).toBeNull();
  });

  it('refuses in production, without reason and without a reference date', async () => {
    const production = build({ env: { MODE: 'production' } });
    await production.service.load();
    const enqueue = async () => {};
    await expect(createRunNow({ mode: production.service, enqueue }).trigger(actor)).rejects.toMatchObject({ code: 'RUN_NOW_DISABLED' });
    const practice = build({ ranges: [] });
    await practice.service.load();
    const runNow = createRunNow({ mode: practice.service, enqueue });
    await expect(runNow.trigger({ actorEmployeeId: 'e', reason: '' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(runNow.trigger(actor)).rejects.toMatchObject({ code: 'NO_REFERENCE_DATE' });
  });

  it('releases the lock when enqueue fails', async () => {
    const { service } = build({ ranges: [range('crm', '2026-06-14', '2026-08-14')] });
    await service.load();
    let fail = true;
    const runNow = createRunNow({
      mode: service,
      enqueue: async () => {
        if (fail) throw new Error('queue down');
      }
    });
    await expect(runNow.trigger(actor)).rejects.toThrow('queue down');
    fail = false;
    await expect(runNow.trigger(actor)).resolves.toHaveProperty('runId');
  });
});
