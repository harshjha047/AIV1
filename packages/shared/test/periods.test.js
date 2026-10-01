import { describe, expect, it } from 'vitest';
import {
  PeriodError,
  RELATIVE_PERIODS,
  daysBetweenIst,
  dayKey,
  endOfIstDay,
  fyKey,
  fyLabel,
  istHour,
  istWeekday,
  listMonthKeys,
  monthKey,
  monthStart,
  nextPeriod,
  normalizeIstDate,
  periodContains,
  periodKeyOf,
  periodRange,
  periodType,
  previousPeriod,
  resolveRelativePeriod,
  shiftPeriod,
  startOfIstDay,
  weekKey,
} from '../src/index.js';

const at = (iso) => new Date(iso);

describe('month keys around the IST boundary', () => {
  it('keeps the last IST millisecond of August in August', () => {
    expect(monthKey(at('2026-08-31T18:29:59.999Z'))).toBe('2026-08');
  });

  it('moves to September at 00:00 IST, which is still August in UTC', () => {
    expect(monthKey(at('2026-08-31T18:30:00.000Z'))).toBe('2026-09');
  });

  it('puts 19:00 UTC on the last day of September into October', () => {
    expect(monthKey(at('2026-09-30T19:00:00Z'))).toBe('2026-10');
    expect(at('2026-09-30T19:00:00Z').getUTCMonth()).toBe(8);
  });

  it('crosses the year boundary in IST', () => {
    expect(monthKey(at('2026-12-31T18:30:00Z'))).toBe('2027-01');
    expect(monthKey(at('2026-12-31T18:29:59Z'))).toBe('2026-12');
  });

  it('returns monthStart as the UTC instant of 00:00 IST', () => {
    expect(monthStart('2026-09').toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(monthStart('2026-01').toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('refuses monthStart for non-month keys', () => {
    expect(() => monthStart('2026-W39')).toThrow(PeriodError);
  });

  it('computes half-open month ranges including February in a leap year', () => {
    const feb = periodRange('2028-02');
    expect(feb.type).toBe('month');
    expect(feb.start.toISOString()).toBe('2028-01-31T18:30:00.000Z');
    expect(feb.end.toISOString()).toBe('2028-02-29T18:30:00.000Z');
    const nonLeap = periodRange('2027-02');
    expect(nonLeap.end.toISOString()).toBe('2027-02-28T18:30:00.000Z');
  });
});

describe('week keys (Monday to Sunday, ISO numbering)', () => {
  it('matches the TRD example: 2026-W39 is 21 to 27 September', () => {
    const range = periodRange('2026-W39');
    expect(range.start.toISOString()).toBe('2026-09-20T18:30:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-27T18:30:00.000Z');
    expect(weekKey(at('2026-09-21T00:00:00+05:30'))).toBe('2026-W39');
  });

  it('ends the week on Sunday night IST and starts the next on Monday 00:00 IST', () => {
    expect(weekKey(at('2026-09-27T23:59:59+05:30'))).toBe('2026-W39');
    expect(weekKey(at('2026-09-28T00:00:00+05:30'))).toBe('2026-W40');
    expect(weekKey(at('2026-09-27T18:29:59.999Z'))).toBe('2026-W39');
    expect(weekKey(at('2026-09-27T18:30:00.000Z'))).toBe('2026-W40');
  });

  it('uses the ISO week-year around New Year', () => {
    expect(weekKey(at('2026-12-31T12:00:00+05:30'))).toBe('2026-W53');
    expect(weekKey(at('2027-01-01T12:00:00+05:30'))).toBe('2026-W53');
    expect(weekKey(at('2027-01-04T12:00:00+05:30'))).toBe('2027-W01');
    expect(weekKey(at('2026-01-01T12:00:00+05:30'))).toBe('2026-W01');
    expect(weekKey(at('2025-12-29T12:00:00+05:30'))).toBe('2026-W01');
  });

  it('rejects week numbers that do not exist in that year', () => {
    expect(() => periodRange('2025-W53')).toThrow(PeriodError);
    expect(() => periodRange('2026-W00')).toThrow(PeriodError);
    expect(() => periodRange('2026-W54')).toThrow(PeriodError);
    expect(periodRange('2026-W53').type).toBe('week');
  });
});

describe('financial year keys (1 April to 31 March)', () => {
  it('splits on 1 April 00:00 IST', () => {
    expect(fyKey(at('2027-03-31T18:29:59.999Z'))).toBe('FY2026-27');
    expect(fyKey(at('2027-03-31T18:30:00.000Z'))).toBe('FY2027-28');
    expect(fyKey(at('2026-03-31T18:29:59.999Z'))).toBe('FY2025-26');
    expect(fyKey(at('2026-04-01T00:00:00+05:30'))).toBe('FY2026-27');
  });

  it('puts January to March in the year that started the previous April', () => {
    expect(fyKey(at('2027-01-15T12:00:00+05:30'))).toBe('FY2026-27');
    expect(fyKey(at('2026-12-31T12:00:00+05:30'))).toBe('FY2026-27');
  });

  it('computes the range and the century wrap label', () => {
    const range = periodRange('FY2026-27');
    expect(range.start.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(range.end.toISOString()).toBe('2027-03-31T18:30:00.000Z');
    expect(fyLabel(2099)).toBe('FY2099-00');
    expect(fyLabel(2009)).toBe('FY2009-10');
    expect(periodRange('FY2099-00').type).toBe('fy');
  });

  it('rejects inconsistent suffixes', () => {
    expect(() => periodRange('FY2026-28')).toThrow(PeriodError);
    expect(() => periodRange('FY2026-26')).toThrow(PeriodError);
  });
});

describe('day keys and IST day helpers', () => {
  it('derives the IST calendar day, not the UTC day', () => {
    expect(dayKey(at('2026-09-14T18:29:59.999Z'))).toBe('2026-09-14');
    expect(dayKey(at('2026-09-14T18:30:00.000Z'))).toBe('2026-09-15');
  });

  it('returns start and end instants of an IST day', () => {
    expect(startOfIstDay('2026-09-14').toISOString()).toBe('2026-09-13T18:30:00.000Z');
    expect(endOfIstDay('2026-09-14').toISOString()).toBe('2026-09-14T18:29:59.999Z');
  });

  it('normalizes dates and strings and rejects impossible days', () => {
    expect(normalizeIstDate('2026-09-14')).toBe('2026-09-14');
    expect(normalizeIstDate(at('2026-09-14T20:00:00Z'))).toBe('2026-09-15');
    expect(() => normalizeIstDate('2026-02-30')).toThrow(PeriodError);
    expect(() => normalizeIstDate('14/09/2026')).toThrow(PeriodError);
    expect(() => normalizeIstDate(20260914)).toThrow(PeriodError);
  });

  it('counts calendar days across the IST midnight', () => {
    expect(daysBetweenIst(at('2026-09-14T18:00:00Z'), at('2026-09-14T19:00:00Z'))).toBe(1);
    expect(daysBetweenIst(at('2026-09-14T00:00:00Z'), at('2026-09-14T10:00:00Z'))).toBe(0);
    expect(daysBetweenIst(at('2026-09-10T10:00:00Z'), at('2026-09-14T10:00:00Z'))).toBe(4);
    expect(daysBetweenIst(at('2026-09-14T10:00:00Z'), at('2026-09-10T10:00:00Z'))).toBe(-4);
  });

  it('numbers the IST weekday from Sunday = 0 and exposes the IST hour', () => {
    expect(istWeekday(at('2026-09-20T12:00:00+05:30'))).toBe(0);
    expect(istWeekday(at('2026-09-21T12:00:00+05:30'))).toBe(1);
    expect(istWeekday(at('2026-09-26T12:00:00+05:30'))).toBe(6);
    expect(istWeekday(at('2026-09-14T20:00:00Z'))).toBe(2);
    expect(istHour(at('2026-09-14T20:00:00Z'))).toBe(1);
    expect(istHour(at('2026-09-14T18:29:59Z'))).toBe(23);
  });
});

describe('period parsing and navigation', () => {
  it('detects the type of each key', () => {
    expect(periodType('2026-09')).toBe('month');
    expect(periodType('2026-W39')).toBe('week');
    expect(periodType('FY2026-27')).toBe('fy');
    expect(periodType('2026-09-14')).toBe('day');
  });

  it('rejects malformed keys and invalid dates', () => {
    for (const key of [
      '2026-13',
      '2026-9',
      '2026W39',
      'fy2026-27',
      '',
      '2026',
      'FY26-27',
      '2026-00',
    ]) {
      expect(() => periodType(key)).toThrow(PeriodError);
    }
    expect(() => periodType(202609)).toThrow(PeriodError);
    expect(() => monthKey(new Date('nope'))).toThrow(PeriodError);
    expect(() => monthKey('2026-09-14')).toThrow(PeriodError);
  });

  it('shifts every period type across year boundaries', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12');
    expect(nextPeriod('2026-12')).toBe('2027-01');
    expect(previousPeriod('2026-W01')).toBe('2025-W52');
    expect(nextPeriod('2026-W53')).toBe('2027-W01');
    expect(previousPeriod('FY2026-27')).toBe('FY2025-26');
    expect(nextPeriod('FY2099-00')).toBe('FY2100-01');
    expect(previousPeriod('2026-03-01')).toBe('2026-02-28');
    expect(shiftPeriod('2026-09', -12)).toBe('2025-09');
    expect(shiftPeriod('2026-09', 0)).toBe('2026-09');
    expect(() => shiftPeriod('2026-09', 1.5)).toThrow(PeriodError);
  });

  it('treats ranges as half-open', () => {
    expect(periodContains('2026-09', at('2026-08-31T18:30:00Z'))).toBe(true);
    expect(periodContains('2026-09', at('2026-09-30T18:29:59.999Z'))).toBe(true);
    expect(periodContains('2026-09', at('2026-09-30T18:30:00Z'))).toBe(false);
    expect(periodContains('2026-09', at('2026-08-31T18:29:59.999Z'))).toBe(false);
  });

  it('builds keys from a type name', () => {
    const instant = at('2026-09-14T10:00:00Z');
    expect(periodKeyOf('month', instant)).toBe('2026-09');
    expect(periodKeyOf('week', instant)).toBe('2026-W38');
    expect(periodKeyOf('fy', instant)).toBe('FY2026-27');
    expect(periodKeyOf('day', instant)).toBe('2026-09-14');
    expect(() => periodKeyOf('decade', instant)).toThrow(PeriodError);
  });

  it('lists inclusive month ranges', () => {
    expect(listMonthKeys('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(listMonthKeys('2026-09', '2026-09')).toEqual(['2026-09']);
    expect(listMonthKeys('2026-10', '2026-09')).toEqual([]);
    expect(() => listMonthKeys('2026-W01', '2026-09')).toThrow(PeriodError);
  });
});

describe('relative periods resolve against the supplied now', () => {
  const now = at('2026-09-14T10:00:00Z');

  it('resolves every documented name', () => {
    const resolved = Object.fromEntries(
      RELATIVE_PERIODS.map((name) => [name, resolveRelativePeriod(name, now)]),
    );
    expect(resolved).toEqual({
      today: '2026-09-14',
      yesterday: '2026-09-13',
      this_week: '2026-W38',
      last_week: '2026-W37',
      this_month: '2026-09',
      last_month: '2026-08',
      this_fy: 'FY2026-27',
      last_fy: 'FY2025-26',
    });
  });

  it('resolves last month across New Year and last FY across April', () => {
    expect(resolveRelativePeriod('last_month', at('2026-01-15T10:00:00Z'))).toBe('2025-12');
    expect(resolveRelativePeriod('last_fy', at('2026-04-01T00:00:00+05:30'))).toBe('FY2025-26');
    expect(resolveRelativePeriod('this_fy', at('2026-03-31T23:59:00+05:30'))).toBe('FY2025-26');
  });

  it('uses the IST day when UTC is still on the previous day', () => {
    const lateUtc = at('2026-09-30T19:00:00Z');
    expect(resolveRelativePeriod('today', lateUtc)).toBe('2026-10-01');
    expect(resolveRelativePeriod('this_month', lateUtc)).toBe('2026-10');
    expect(resolveRelativePeriod('yesterday', lateUtc)).toBe('2026-09-30');
  });

  it('rejects unknown names', () => {
    expect(() => resolveRelativePeriod('next_month', now)).toThrow(PeriodError);
  });
});
