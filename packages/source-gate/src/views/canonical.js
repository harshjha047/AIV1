import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function toLiteral(value, depth = 0) {
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const simple = value.every((item) => item === null || typeof item !== 'object');
    if (simple) return `[${value.map((item) => toLiteral(item, depth)).join(', ')}]`;
    return `[\n${value.map((item) => `${inner}${toLiteral(item, depth + 1)}`).join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const rendered = entries.map(([key, item]) => {
    const name = IDENTIFIER.test(key) ? key : toLiteral(key);
    return `${inner}${name}: ${toLiteral(item, depth + 1)}`;
  });
  return `{\n${rendered.join(',\n')}\n${pad}}`;
}
