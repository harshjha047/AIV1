import { describe, expect, it } from 'vitest';
import {
  ClockError,
  createClock,
  latestActivityDate,
  monthKey,
  resolveRelativePeriod,
  resolveReferenceDate,
} from '../src/index.js';

const at = (iso) => new Date(iso);
const real = at('2026-10-01T05:30:00Z');
const realNow = () => real;

describe('latestActivityDate', () => {
  it('returns the IST day of the latest valid date', () => {
    expect(latestActivityDate([at('2026-09-14T08:50:00Z'), at('2026-09-12T10:00:00Z')])).toBe(
      '2026-09-14',
    );
    expect(latestActivityDate([at('2026-09-14T20:00:00Z')])).toBe('2026-09-15');
  });

  it('ignores invalid and non-date entries', () => {
    expect(
      latestActivityDate([
        new Date('x'),
        null,
        '2026-09-14',
        undefined,
        at('2026-09-01T00:00:00Z'),
      ]),
    ).toBe('2026-09-01');
  });

  it('returns null when nothing usable is supplied', () => {
    expect(latestActivityDate([])).toBeNull();
    expect(latestActivityDate([null, new Date('x')])).toBeNull();
  });
});

describe('resolveReferenceDate precedence', () => {
  it('prefers the environment override, then the stored override, then auto', () => {
    expect(
      resolveReferenceDate({
        envOverride: '2026-09-01',
        metaOverride: '2026-09-02',
        auto: '2026-09-03',
      }),
    ).toEqual({
      date: '2026-09-01',
      source: 'override',
    });
    expect(resolveReferenceDate({ metaOverride: '2026-09-02', auto: '2026-09-03' })).toEqual({
      date: '2026-09-02',
      source: 'override',
    });
    expect(resolveReferenceDate({ auto: '2026-09-03' })).toEqual({
      date: '2026-09-03',
      source: 'auto',
    });
  });

  it('falls back to the real clock when nothing is known', () => {
    expect(resolveReferenceDate()).toEqual({ date: null, source: 'real' });
    expect(resolveReferenceDate({ envOverride: '', metaOverride: null, auto: undefined })).toEqual({
      date: null,
      source: 'real',
    });
  });
});

describe('createClock in practice mode', () => {
  it('resolves "now" to the end of the reference day in IST', () => {
    const clock = createClock({ mode: 'practice', referenceDate: '2026-09-14', realNow });
    expect(clock.now().toISOString()).toBe('2026-09-14T18:29:59.999Z');
    expect(clock.today()).toBe('2026-09-14');
    expect(clock.referenceDate).toBe('2026-09-14');
    expect(clock.referenceSource).toBe('override');
    expect(clock.isPractice).toBe(true);
  });

  it('makes relative periods resolve against the reference date', () => {
    const clock = createClock({ mode: 'practice', referenceDate: '2026-08-14', realNow });
    expect(resolveRelativePeriod('this_month', clock.now())).toBe('2026-08');
    expect(resolveRelativePeriod('last_month', clock.now())).toBe('2026-07');
    expect(monthKey(clock.now())).not.toBe(monthKey(real));
  });

  it('never consults the real clock while a reference date is set', () => {
    let calls = 0;
    const clock = createClock({
      mode: 'practice',
      referenceDate: '2026-09-14',
      realNow: () => {
        calls += 1;
        return real;
      },
    });
    clock.now();
    clock.today();
    clock.describe();
    expect(calls).toBe(0);
  });

  it('prefers the override over the auto-detected date', () => {
    const clock = createClock({
      mode: 'practice',
      referenceDate: '2026-09-01',
      autoReferenceDate: '2026-09-20',
      realNow,
    });
    expect(clock.today()).toBe('2026-09-01');
  });

  it('uses the auto-detected date when there is no override', () => {
    const clock = createClock({ mode: 'practice', autoReferenceDate: '2026-09-20', realNow });
    expect(clock.today()).toBe('2026-09-20');
    expect(clock.referenceSource).toBe('auto');
  });

  it('accepts Date instances as reference dates', () => {
    const clock = createClock({
      mode: 'practice',
      referenceDate: at('2026-09-14T20:00:00Z'),
      realNow,
    });
    expect(clock.referenceDate).toBe('2026-09-15');
  });

  it('falls back to the real clock when no reference exists', () => {
    const clock = createClock({ mode: 'practice', realNow });
    expect(clock.now()).toBe(real);
    expect(clock.referenceDate).toBeNull();
    expect(clock.referenceSource).toBe('real');
  });

  it('returns a fresh Date each call so callers cannot mutate the clock', () => {
    const clock = createClock({ mode: 'practice', referenceDate: '2026-09-14', realNow });
    const first = clock.now();
    first.setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('describes itself for the practice-mode banner', () => {
    const clock = createClock({ mode: 'practice', referenceDate: '2026-09-14', realNow });
    expect(clock.describe()).toEqual({
      mode: 'practice',
      referenceDate: '2026-09-14',
      referenceSource: 'override',
      asOf: '2026-09-14T18:29:59.999Z',
    });
  });

  it('rejects an impossible reference date', () => {
    expect(() => createClock({ mode: 'practice', referenceDate: '2026-02-30', realNow })).toThrow();
  });
});

describe('createClock in production mode', () => {
  it('returns real time and ignores any reference date', () => {
    const clock = createClock({
      mode: 'production',
      referenceDate: '2026-01-01',
      autoReferenceDate: '2026-02-02',
      realNow,
    });
    expect(clock.now()).toBe(real);
    expect(clock.today()).toBe('2026-10-01');
    expect(clock.referenceDate).toBeNull();
    expect(clock.referenceSource).toBe('production');
    expect(clock.isPractice).toBe(false);
  });

  it('follows the real clock as it advances', () => {
    let current = at('2026-10-01T05:30:00Z');
    const clock = createClock({ mode: 'production', realNow: () => current });
    expect(clock.today()).toBe('2026-10-01');
    current = at('2026-10-01T18:30:00Z');
    expect(clock.today()).toBe('2026-10-02');
  });

  it('still exposes the real time in practice mode for timestamps', () => {
    const clock = createClock({ mode: 'practice', referenceDate: '2026-09-14', realNow });
    expect(clock.realNow()).toBe(real);
  });
});

describe('createClock validation', () => {
  it('requires a known mode and a usable realNow', () => {
    expect(() => createClock()).toThrow(ClockError);
    expect(() => createClock({ mode: 'staging' })).toThrow(ClockError);
    expect(() => createClock({ mode: 'production', realNow: 'now' })).toThrow(ClockError);
    expect(() => createClock({ mode: 'production', realNow: () => 'x' }).now()).toThrow(ClockError);
    expect(() => createClock({ mode: 'production', realNow: () => new Date('x') }).now()).toThrow(
      ClockError,
    );
  });

  it('is immutable', () => {
    const clock = createClock({ mode: 'production', realNow });
    expect(Object.isFrozen(clock)).toBe(true);
  });

  it('defaults to the system clock', () => {
    const clock = createClock({ mode: 'production' });
    expect(Math.abs(clock.now().getTime() - clock.realNow().getTime())).toBeLessThan(1000);
  });
});
