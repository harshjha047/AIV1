import { ModeError, createModeClock, createRealClock, dateKeyOf, parseReferenceDate } from './clock.js';

export const MODE_CHANGED_CHANNEL = 'ai:mode:changed';
export const MODES = Object.freeze(['practice', 'production']);
const MODE_ID = 'mode';

export function createModeStore(collection) {
  return {
    async get() {
      return collection.findOne({ _id: MODE_ID });
    },
    async put(doc) {
      await collection.replaceOne({ _id: MODE_ID }, { ...doc, _id: MODE_ID }, { upsert: true });
    }
  };
}

export function modeFromEnv(env = process.env) {
  const raw = env.MODE;
  if (raw === undefined || raw === '') return 'production';
  if (!MODES.includes(raw)) throw new ModeError(`MODE must be one of ${MODES.join(', ')}`, 'INVALID_MODE', { value: raw });
  return raw;
}

function clone(state) {
  return { ...state, referenceDate: state.referenceDate ? new Date(state.referenceDate.getTime()) : null };
}

function toDate(value) {
  return value ? new Date(value) : null;
}

function normalize(doc) {
  return {
    mode: doc.mode,
    referenceDate: toDate(doc.referenceDate),
    referenceAuto: Boolean(doc.referenceAuto),
    updatedBy: doc.updatedBy ?? null,
    updatedAt: toDate(doc.updatedAt)
  };
}

export function createModeService({
  store,
  real = createRealClock(),
  env = process.env,
  activityRange = async () => [],
  audit,
  activity,
  bus,
  logger,
  rangeTtlMs = 30000
}) {
  const envMode = modeFromEnv(env);
  let current = { mode: envMode, referenceDate: null, referenceAuto: envMode === 'practice', updatedBy: null, updatedAt: null };
  let range = { at: 0, from: null, to: null, sources: [] };
  let unsubscribe = null;
  let timer = null;
  const clock = createModeClock({ real, getState: () => current });

  async function persist(next) {
    await store.put({
      mode: next.mode,
      referenceDate: next.referenceDate,
      referenceAuto: next.referenceAuto,
      updatedBy: next.updatedBy,
      updatedAt: next.updatedAt
    });
    current = clone(next);
  }

  async function announce(reason) {
    if (!bus) return;
    try {
      await bus.publish(MODE_CHANGED_CHANNEL, { mode: current.mode, reason });
    } catch (error) {
      logger?.warn?.({ err: error.message }, 'mode change publish failed');
    }
  }

  async function measureRange(force = false) {
    if (!force && range.at && real.now().getTime() - range.at < rangeTtlMs) return range;
    const entries = await activityRange();
    const mins = entries.map((entry) => entry.min).filter(Boolean).map((value) => new Date(value));
    const maxes = entries.map((entry) => entry.max).filter(Boolean).map((value) => new Date(value));
    const cap = real.now();
    const cappedMax = maxes.map((value) => (value > cap ? cap : value));
    range = {
      at: real.now().getTime(),
      from: mins.length ? new Date(Math.min(...mins.map((value) => value.getTime()))) : null,
      to: cappedMax.length ? new Date(Math.max(...cappedMax.map((value) => value.getTime()))) : null,
      sources: entries.map((entry) => ({
        sourceId: entry.sourceId,
        min: entry.min ? new Date(entry.min) : null,
        max: entry.max ? new Date(entry.max) : null
      }))
    };
    return range;
  }

  async function refreshAuto({ force = true } = {}) {
    if (current.mode !== 'practice' || !current.referenceAuto) return clone(current);
    const measured = await measureRange(force);
    if (!measured.to) return clone(current);
    const nextDate = parseReferenceDate(dateKeyOf(measured.to));
    if (current.referenceDate && current.referenceDate.getTime() === nextDate.getTime()) return clone(current);
    await persist({ ...current, referenceDate: nextDate, updatedBy: 'auto', updatedAt: real.now() });
    await announce('auto');
    return clone(current);
  }

  async function load() {
    const doc = await store.get();
    if (!doc) {
      const initial = {
        mode: envMode,
        referenceDate: null,
        referenceAuto: envMode === 'practice',
        updatedBy: 'system',
        updatedAt: real.now()
      };
      await persist(initial);
    } else {
      const loaded = normalize(doc);
      if (loaded.mode !== envMode) {
        const aligned =
          envMode === 'production'
            ? { mode: 'production', referenceDate: null, referenceAuto: false, updatedBy: 'system', updatedAt: real.now() }
            : { ...loaded, mode: 'practice', referenceAuto: loaded.referenceAuto, updatedBy: 'system', updatedAt: real.now() };
        await persist(aligned);
      } else current = loaded;
    }
    if (current.mode === 'practice' && current.referenceAuto) {
      try {
        await refreshAuto();
      } catch (error) {
        logger?.warn?.({ err: error.message }, 'reference date auto refresh failed');
      }
    }
    return clone(current);
  }

  async function reload() {
    const doc = await store.get();
    if (!doc) return clone(current);
    const loaded = normalize(doc);
    if (loaded.mode === envMode) current = loaded;
    return clone(current);
  }

  async function update({ mode, referenceDate, referenceAuto } = {}, { actorEmployeeId, reason } = {}) {
    if (envMode === 'production') throw new ModeError('Mode is locked in production', 'PRODUCTION_LOCKED');
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed) throw new ModeError('A reason is required', 'REASON_REQUIRED');
    if (mode !== undefined && mode !== envMode) {
      throw new ModeError('Mode is set by the MODE environment variable', 'MODE_ENV_MISMATCH', { requested: mode, env: envMode });
    }
    if (referenceDate !== undefined && referenceDate !== null && referenceAuto === true) {
      throw new ModeError('Choose either a fixed reference date or auto', 'REFERENCE_CONFLICT');
    }
    const before = clone(current);
    const next = clone(current);
    if (referenceDate !== undefined && referenceDate !== null) {
      const parsed = parseReferenceDate(referenceDate);
      if (dateKeyOf(parsed) > dateKeyOf(real.now())) {
        throw new ModeError('Reference date cannot be in the future', 'REFERENCE_IN_FUTURE', { value: dateKeyOf(parsed) });
      }
      next.referenceDate = parsed;
      next.referenceAuto = false;
    } else if (referenceAuto !== undefined) {
      next.referenceAuto = Boolean(referenceAuto);
    }
    next.updatedBy = actorEmployeeId ?? null;
    next.updatedAt = real.now();
    await persist(next);
    if (next.referenceAuto && referenceDate === undefined) await refreshAuto({ force: true });
    const after = clone(current);
    if (audit) {
      await audit.record({
        actorEmployeeId,
        action: 'mode.update',
        target: 'meta.mode',
        reason: trimmed,
        before: summarize(before),
        after: summarize(after)
      });
    }
    await activity?.emit({ kind: 'toggle', action: 'mode.update', message: `reference ${summarize(after).referenceDate ?? 'real clock'}` });
    await announce('update');
    return clone(current);
  }

  async function banner() {
    if (current.mode !== 'practice') {
      return { practice: false, text: null, referenceDate: null, dataFrom: null, dataTo: null, runNowEnabled: false };
    }
    let measured = range;
    try {
      measured = await measureRange(false);
    } catch (error) {
      logger?.warn?.({ err: error.message }, 'data range unavailable');
    }
    const reference = current.referenceDate ? dateKeyOf(current.referenceDate) : null;
    const from = measured.from ? dateKeyOf(measured.from) : null;
    const to = measured.to ? dateKeyOf(measured.to) : null;
    return {
      practice: true,
      text: `PRACTICE MODE: reference date ${reference ?? 'real clock'}, data from ${from ?? 'n/a'} to ${to ?? 'n/a'}`,
      referenceDate: reference,
      dataFrom: from,
      dataTo: to,
      runNowEnabled: true
    };
  }

  async function describe() {
    const view = banner();
    const resolved = await view;
    return {
      mode: current.mode,
      referenceDate: current.referenceDate ? dateKeyOf(current.referenceDate) : null,
      referenceAuto: current.referenceAuto,
      updatedBy: current.updatedBy,
      updatedAt: current.updatedAt ? current.updatedAt.toISOString() : null,
      banner: resolved,
      sources: range.sources.map((entry) => ({
        sourceId: entry.sourceId,
        from: entry.min ? dateKeyOf(entry.min) : null,
        to: entry.max ? dateKeyOf(entry.max) : null
      }))
    };
  }

  function start({ intervalMs = 60000 } = {}) {
    if (bus && !unsubscribe) {
      unsubscribe = bus.subscribe(MODE_CHANGED_CHANNEL, () => {
        reload().catch((error) => logger?.warn?.({ err: error.message }, 'mode reload failed'));
      });
    }
    if (!timer && intervalMs > 0) {
      timer = setInterval(() => {
        reload()
          .then(() => refreshAuto({ force: false }))
          .catch((error) => logger?.warn?.({ err: error.message }, 'mode refresh failed'));
      }, intervalMs);
      timer.unref?.();
    }
  }

  function stop() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    clock,
    envMode,
    load,
    reload,
    update,
    refreshAuto,
    banner,
    describe,
    start,
    stop,
    state: () => clone(current),
    isPractice: () => current.mode === 'practice'
  };
}

function summarize(state) {
  return {
    mode: state.mode,
    referenceDate: state.referenceDate ? dateKeyOf(state.referenceDate) : null,
    referenceAuto: state.referenceAuto
  };
}
