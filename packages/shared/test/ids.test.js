import { describe, expect, it } from 'vitest';
import {
  createIdGenerator,
  createUlidFactory,
  factId,
  isCustomerId,
  isEmployeeId,
  isUlid,
  parseFactId,
  ulidTime,
} from '../src/index.js';

const at = (value) => new Date(value);
const MAX_RANDOM = (1n << 80n) - 1n;

describe('ULID factory', () => {
  it('encodes the timestamp like the ULID specification', () => {
    const next = createUlidFactory({ now: () => at(1469918176385), random: () => 0n });
    expect(next()).toBe('01ARYZ6S410000000000000000');
  });

  it('produces 26 valid characters and round-trips the time', () => {
    const instant = at('2026-09-14T10:00:00.123Z');
    const next = createUlidFactory({ now: () => instant });
    const id = next();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id).toISOString()).toBe('2026-09-14T10:00:00.123Z');
  });

  it('is monotonic within one millisecond', () => {
    const next = createUlidFactory({ now: () => at(1000), random: () => 0n });
    const ids = [next(), next(), next()];
    expect(ids.map((id) => id.slice(-1))).toEqual(['0', '1', '2']);
    expect([...ids].sort()).toEqual(ids);
  });

  it('draws fresh entropy when the millisecond changes', () => {
    let time = 1000;
    let draws = 0;
    const next = createUlidFactory({
      now: () => at(time),
      random: () => {
        draws += 1;
        return BigInt(draws * 7);
      },
    });
    next();
    time = 1001;
    next();
    expect(draws).toBe(2);
  });

  it('sorts by creation time', () => {
    let time = 1_700_000_000_000;
    const next = createUlidFactory({ now: () => at(time) });
    const first = next();
    time += 1;
    const second = next();
    expect(second > first).toBe(true);
  });

  it('refuses to overflow the entropy of a single millisecond', () => {
    const next = createUlidFactory({ now: () => at(1000), random: () => MAX_RANDOM });
    next();
    expect(() => next()).toThrow(RangeError);
  });

  it('rejects out-of-range times and a missing clock', () => {
    expect(() => createUlidFactory()).toThrow(TypeError);
    expect(() => createUlidFactory({ now: () => at(-1) })()).toThrow(RangeError);
  });

  it('generates unique ids with the default entropy source', () => {
    const next = createUlidFactory({ now: () => at(1_700_000_000_000) });
    const ids = new Set(Array.from({ length: 2000 }, next));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(isUlid(id)).toBe(true);
  });

  it('validates ULIDs strictly', () => {
    expect(isUlid('01ARYZ6S410000000000000000')).toBe(true);
    expect(isUlid('81ARYZ6S410000000000000000')).toBe(false);
    expect(isUlid('01ARYZ6S41000000000000000')).toBe(false);
    expect(isUlid('01ARYZ6S41000000000000000I')).toBe(false);
    expect(isUlid(null)).toBe(false);
    expect(() => ulidTime('nope')).toThrow(TypeError);
  });
});

describe('prefixed identifiers', () => {
  it('prefixes employee and customer ids and validates them', () => {
    const ids = createIdGenerator({ now: () => at('2026-10-02T01:00:00Z') });
    const employee = ids.employeeId();
    const customer = ids.customerId();
    expect(employee).toMatch(/^emp_[0-9A-Z]{26}$/);
    expect(customer).toMatch(/^cus_[0-9A-Z]{26}$/);
    expect(isEmployeeId(employee)).toBe(true);
    expect(isCustomerId(customer)).toBe(true);
    expect(isEmployeeId(customer)).toBe(false);
    expect(isCustomerId(employee)).toBe(false);
  });

  it('rejects malformed ids, including the shortened examples in the schema document', () => {
    expect(isEmployeeId('emp_01J9ZK3M8Q')).toBe(false);
    expect(isEmployeeId('emp_')).toBe(false);
    expect(isEmployeeId(undefined)).toBe(false);
    expect(isCustomerId('cus_8ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(false);
  });

  it('keeps ids unique across a burst in one millisecond', () => {
    const ids = createIdGenerator({ now: () => at(1_700_000_000_000) });
    const generated = new Set(Array.from({ length: 500 }, () => ids.employeeId()));
    expect(generated.size).toBe(500);
  });
});

describe('fact ids', () => {
  it('joins the source id and row ids with colons', () => {
    expect(factId('crm', '6650aa')).toBe('crm:6650aa');
    expect(factId('crm', '6650aa', '6650ab')).toBe('crm:6650aa:6650ab');
    expect(factId('samadhan_synthetic', 42)).toBe('samadhan_synthetic:42');
    expect(factId('bahikhata', 'x')).not.toBe(factId('invoicing', 'x'));
  });

  it('refuses unknown sources, empty parts and colons', () => {
    expect(() => factId('erp', '1')).toThrow(/unknown source/);
    expect(() => factId('crm')).toThrow(/at least one/);
    expect(() => factId('crm', '')).toThrow(TypeError);
    expect(() => factId('crm', 'a:b')).toThrow(TypeError);
  });

  it('parses ids back into their parts', () => {
    expect(parseFactId('crm:6650aa:6650ab')).toEqual({
      sourceId: 'crm',
      parts: ['6650aa', '6650ab'],
    });
    expect(parseFactId('samadhan_synthetic:42')).toEqual({
      sourceId: 'samadhan_synthetic',
      parts: ['42'],
    });
    expect(parseFactId(factId('invoicing', 'abc'))).toEqual({
      sourceId: 'invoicing',
      parts: ['abc'],
    });
  });

  it('rejects malformed fact ids', () => {
    for (const id of ['crm', 'crm:', 'erp:1', ':1', 'crm::1']) {
      expect(() => parseFactId(id)).toThrow(TypeError);
    }
    expect(() => parseFactId(5)).toThrow(TypeError);
  });
});
