import { parseBandwidthDetailed } from '@fab5/shared/bandwidth';
import { dateKeyOf } from '@fab5/shared/clock';
import { toPaise } from '@fab5/shared/money';
import { MappingError } from './errors.js';

const isMissing = (value) => value === null || value === undefined || value === '';

export const idOf = (value) => (value === null || value === undefined ? null : String(value));

export const requireId = (value, field) => {
  const id = idOf(value);
  if (id === null || id === '')
    throw new MappingError(`${field} is missing`, 'ID_MISSING', { field });
  return id;
};

export const asText = (value, max = null) => {
  if (isMissing(value)) return null;
  const text = typeof value === 'string' ? value : String(value);
  return max !== null && text.length > max ? text.slice(0, max) : text;
};

export const requireText = (value, field, max = null) => {
  const text = asText(value, max);
  if (text === null || text.trim() === '') {
    throw new MappingError(`${field} is missing`, 'TEXT_MISSING', { field });
  }
  return text;
};

export const asDate = (value, field, { nullable = true } = {}) => {
  if (isMissing(value)) {
    if (nullable) return null;
    throw new MappingError(`${field} is missing`, 'DATE_MISSING', { field });
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MappingError(`${field} is not a valid date`, 'DATE_INVALID', { field });
  }
  return date;
};

export const asPaise = (value, field, { nullable = true } = {}) => {
  if (isMissing(value)) return nullable ? null : 0;
  const paise = toPaise(value);
  if (paise === null) {
    throw new MappingError(`${field} is not a valid amount`, 'AMOUNT_INVALID', { field });
  }
  return paise;
};

export const asInt = (value, field, { nullable = true } = {}) => {
  if (isMissing(value)) return nullable ? null : 0;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new MappingError(`${field} is not an integer`, 'INT_INVALID', { field });
  }
  return number;
};

export const asNumber = (value, field, { nullable = true } = {}) => {
  if (isMissing(value)) return nullable ? null : 0;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new MappingError(`${field} is not a number`, 'NUMBER_INVALID', { field });
  }
  return number;
};

export const asBool = (value, fallback = true) =>
  value === null || value === undefined ? fallback : Boolean(value);

export const bandwidthOf = (raw) => {
  if (isMissing(raw)) return { raw: null, mbps: 0, parsed: false };
  const detail = parseBandwidthDetailed(raw);
  return { raw: String(raw), mbps: detail.mbps, parsed: detail.parsed };
};

export const monthKeyOf = (date) => dateKeyOf(date).slice(0, 7);

export const normalizeEmail = (value) => {
  const text = asText(value);
  return text === null ? null : text.trim().toLowerCase();
};

export const subtractPaise = (left, right) =>
  left === null || right === null ? null : left - right;

export const allNull = (object) => Object.values(object).every((value) => value === null);

export function createMapContext({ employees = new Map(), customers = new Map() } = {}) {
  const lookup = (table, source, id) => {
    if (id === null || id === undefined) return null;
    const key = `${source}:${id}`;
    return (table instanceof Map ? table.get(key) : table(source, id)) ?? null;
  };
  return Object.freeze({
    employeeId: (source, id) => lookup(employees, source, id),
    customerId: (source, id) => lookup(customers, source, id)
  });
}

export const NULL_MAP_CONTEXT = createMapContext();
