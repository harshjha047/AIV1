import { DateTime } from 'luxon';

export const IST = 'Asia/Kolkata';
export const REFERENCE_HOUR_IST = 12;

export class ModeError extends Error {
  constructor(message, code = 'MODE_ERROR', details = {}) {
    super(message);
    this.name = 'ModeError';
    this.code = code;
    this.details = details;
  }
}

export function createRealClock({ now = () => new Date(), monotonic = () => performance.now() } = {}) {
  return {
    now,
    monotonic,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}

export function dateKeyOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ModeError('Invalid date', 'INVALID_REFERENCE_DATE');
  return DateTime.fromJSDate(date, { zone: IST }).toFormat('yyyy-MM-dd');
}

export function parseReferenceDate(value) {
  let parsed;
  if (value instanceof Date) parsed = DateTime.fromJSDate(value, { zone: IST });
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed = DateTime.fromISO(value, { zone: IST });
  } else if (typeof value === 'string') parsed = DateTime.fromISO(value, { setZone: true }).setZone(IST);
  else throw new ModeError('Reference date must be YYYY-MM-DD', 'INVALID_REFERENCE_DATE', { value: String(value) });
  if (!parsed.isValid) throw new ModeError('Reference date must be YYYY-MM-DD', 'INVALID_REFERENCE_DATE', { value: String(value) });
  return parsed.set({ hour: REFERENCE_HOUR_IST, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

export function createModeClock({ real = createRealClock(), getState }) {
  return {
    now() {
      const state = getState();
      if (state.mode === 'practice' && state.referenceDate) return new Date(state.referenceDate.getTime());
      return real.now();
    },
    realNow: () => real.now(),
    monotonic: () => real.monotonic(),
    sleep: (ms) => real.sleep(ms),
    mode: () => getState().mode,
    isReference() {
      const state = getState();
      return state.mode === 'practice' && Boolean(state.referenceDate);
    }
  };
}
