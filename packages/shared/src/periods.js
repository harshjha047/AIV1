import { DateTime } from 'luxon';
import { TIME_ZONE } from './constants.js';
import { PeriodError } from './errors.js';

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const FY_KEY = /^FY(\d{4})-(\d{2})$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (value) => String(value).padStart(2, '0');

const assertInstant = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new PeriodError('expected a valid Date');
  }
  return date;
};

const istDateTime = (date) => DateTime.fromJSDate(assertInstant(date), { zone: TIME_ZONE });

const fromParts = (parts) => DateTime.fromObject(parts, { zone: TIME_ZONE });

export const monthKey = (date) => istDateTime(date).toFormat('yyyy-MM');

export const weekKey = (date) => {
  const dt = istDateTime(date);
  return `${dt.weekYear}-W${pad2(dt.weekNumber)}`;
};

export const fyStartYear = (date) => {
  const dt = istDateTime(date);
  return dt.month >= 4 ? dt.year : dt.year - 1;
};

export const fyLabel = (startYear) => `FY${startYear}-${pad2((startYear + 1) % 100)}`;

export const fyKey = (date) => fyLabel(fyStartYear(date));

export const dayKey = (date) => istDateTime(date).toFormat('yyyy-MM-dd');

const parseDay = (key) => {
  if (!DAY_KEY.test(key)) throw new PeriodError(`invalid day ${key}`);
  const dt = DateTime.fromISO(key, { zone: TIME_ZONE });
  if (!dt.isValid) throw new PeriodError(`invalid day ${key}`);
  return dt;
};

export const startOfIstDay = (key) => parseDay(key).startOf('day').toJSDate();

export const endOfIstDay = (key) => parseDay(key).endOf('day').toJSDate();

export const normalizeIstDate = (value) => {
  if (value instanceof Date) return dayKey(value);
  if (typeof value === 'string') return parseDay(value).toFormat('yyyy-MM-dd');
  throw new PeriodError('expected YYYY-MM-DD or Date');
};

export const periodType = (key) => {
  if (typeof key !== 'string') throw new PeriodError('period key must be a string');
  if (MONTH_KEY.test(key)) return 'month';
  if (WEEK_KEY.test(key)) return 'week';
  if (FY_KEY.test(key)) return 'fy';
  if (DAY_KEY.test(key)) return 'day';
  throw new PeriodError(`unrecognised period key ${key}`);
};

const startOf = (key) => {
  switch (periodType(key)) {
    case 'month': {
      const [, year, month] = MONTH_KEY.exec(key);
      return fromParts({ year: Number(year), month: Number(month), day: 1 });
    }
    case 'week': {
      const [, year, week] = WEEK_KEY.exec(key);
      const dt = fromParts({ weekYear: Number(year), weekNumber: Number(week), weekday: 1 });
      if (!dt.isValid) throw new PeriodError(`invalid week ${key}`);
      return dt;
    }
    case 'fy': {
      const [, year, suffix] = FY_KEY.exec(key);
      const startYear = Number(year);
      if (Number(suffix) !== (startYear + 1) % 100)
        throw new PeriodError(`invalid financial year ${key}`);
      return fromParts({ year: startYear, month: 4, day: 1 });
    }
    default:
      return parseDay(key);
  }
};

const unitOf = { month: 'months', week: 'weeks', fy: 'years', day: 'days' };

export const periodRange = (key) => {
  const type = periodType(key);
  const start = startOf(key);
  const end = start.plus({ [unitOf[type]]: 1 });
  return { type, key, start: start.toJSDate(), end: end.toJSDate() };
};

export const monthStart = (key) => {
  if (periodType(key) !== 'month') throw new PeriodError(`${key} is not a month key`);
  return periodRange(key).start;
};

export const periodContains = (key, instant) => {
  const { start, end } = periodRange(key);
  const time = assertInstant(instant).getTime();
  return time >= start.getTime() && time < end.getTime();
};

export const periodKeyOf = (type, date) => {
  switch (type) {
    case 'month':
      return monthKey(date);
    case 'week':
      return weekKey(date);
    case 'fy':
      return fyKey(date);
    case 'day':
      return dayKey(date);
    default:
      throw new PeriodError(`unknown period type ${type}`);
  }
};

export const shiftPeriod = (key, count) => {
  if (!Number.isInteger(count)) throw new PeriodError('shift count must be an integer');
  const type = periodType(key);
  const shifted = startOf(key).plus({ [unitOf[type]]: count });
  return periodKeyOf(type, shifted.toJSDate());
};

export const previousPeriod = (key) => shiftPeriod(key, -1);
export const nextPeriod = (key) => shiftPeriod(key, 1);

export const listMonthKeys = (fromKey, toKey) => {
  if (periodType(fromKey) !== 'month' || periodType(toKey) !== 'month') {
    throw new PeriodError('listMonthKeys requires month keys');
  }
  if (fromKey > toKey) return [];
  const keys = [];
  for (let key = fromKey; key <= toKey; key = nextPeriod(key)) keys.push(key);
  return keys;
};

export const RELATIVE_PERIODS = Object.freeze([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_fy',
  'last_fy',
]);

export const resolveRelativePeriod = (name, now) => {
  switch (name) {
    case 'today':
      return dayKey(now);
    case 'yesterday':
      return previousPeriod(dayKey(now));
    case 'this_week':
      return weekKey(now);
    case 'last_week':
      return previousPeriod(weekKey(now));
    case 'this_month':
      return monthKey(now);
    case 'last_month':
      return previousPeriod(monthKey(now));
    case 'this_fy':
      return fyKey(now);
    case 'last_fy':
      return previousPeriod(fyKey(now));
    default:
      throw new PeriodError(`unknown relative period ${name}`);
  }
};

export const istWeekday = (date) => istDateTime(date).weekday % 7;

export const istHour = (date) => istDateTime(date).hour;

export const daysBetweenIst = (fromDate, toDate) => {
  const from = istDateTime(fromDate).startOf('day');
  const to = istDateTime(toDate).startOf('day');
  return Math.round(to.diff(from, 'days').days);
};
