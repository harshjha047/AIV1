import { createHash } from 'node:crypto';
import { SYSTEM_FIELDS } from './constants.js';

export const sha1Hex = (input) => createHash('sha1').update(input).digest('hex');

export const sha256Hex = (input) => createHash('sha256').update(input).digest('hex');

const encode = (value, path) => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
      return Object.is(value, -0) ? '0' : String(value);
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new TypeError(`unsupported value at ${path}`);
    default:
      break;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`invalid Date at ${path}`);
    return JSON.stringify(value.toISOString());
  }
  if (value instanceof Uint8Array)
    return JSON.stringify(`bin:${Buffer.from(value).toString('base64')}`);
  if (Array.isArray(value)) {
    return `[${value.map((item, i) => (item === undefined ? 'null' : encode(item, `${path}[${i}]`))).join(',')}]`;
  }
  if (typeof value.toJSON === 'function') return encode(value.toJSON(), path);

  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(value[key], `${path}.${key}`)}`).join(',')}}`;
};

export const stableStringify = (value) => encode(value, '$');

export const hashJson = (value) => sha1Hex(stableStringify(value));

export const contentHash = (mapped, { exclude = SYSTEM_FIELDS } = {}) => {
  const skipped = new Set(exclude);
  const content = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (!skipped.has(key)) content[key] = value;
  }
  return hashJson(content);
};

export const textHash = (text) => sha1Hex(String(text));
