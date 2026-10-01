import { DateTime } from 'luxon';
import { IST } from './clock.js';

export function istNow(clock) {
  return DateTime.fromJSDate(clock.now(), { zone: IST });
}

export function todayKey(clock) {
  return istNow(clock).toFormat('yyyy-MM-dd');
}

export function relativePeriodKeys(clock) {
  const now = istNow(clock);
  const lastWeek = now.minus({ weeks: 1 });
  return {
    today: now.toFormat('yyyy-MM-dd'),
    month: now.toFormat('yyyy-MM'),
    lastMonth: now.minus({ months: 1 }).toFormat('yyyy-MM'),
    week: now.toFormat("kkkk-'W'WW"),
    lastWeek: lastWeek.toFormat("kkkk-'W'WW")
  };
}

export function freshnessAgeMs(clock, asOf) {
  return Math.max(0, clock.now().getTime() - new Date(asOf).getTime());
}
