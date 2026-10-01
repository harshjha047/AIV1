import { describe, expect, it } from 'vitest';
import {
  assertPaise,
  formatIndianNumber,
  formatInr,
  groupIndian,
  isPaise,
  sumPaise,
  toPaise,
} from '../src/index.js';

describe('toPaise', () => {
  it('converts plain numbers and strings exactly', () => {
    expect(toPaise(12.5)).toBe(1250);
    expect(toPaise(0)).toBe(0);
    expect(toPaise(99)).toBe(9900);
    expect(toPaise('12.50')).toBe(1250);
    expect(toPaise('.5')).toBe(50);
    expect(toPaise('5.')).toBe(500);
    expect(toPaise(5n)).toBe(500);
  });

  it('rounds half away from zero on the decimal digits, not the binary float', () => {
    expect(toPaise('12.345')).toBe(1235);
    expect(toPaise('-12.345')).toBe(-1235);
    expect(toPaise(1.005)).toBe(101);
    expect(toPaise(-1.005)).toBe(-101);
    expect(toPaise('0.005')).toBe(1);
    expect(toPaise('0.004')).toBe(0);
    expect(toPaise('-0.005')).toBe(-1);
    expect(toPaise('12.344999')).toBe(1234);
    expect(toPaise('12.3450')).toBe(1235);
  });

  it('absorbs float drift', () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(19.99)).toBe(1999);
    expect(toPaise(4.35)).toBe(435);
    expect(toPaise(1.1 * 3)).toBe(330);
  });

  it('accepts Indian grouping, currency markers and whitespace', () => {
    expect(toPaise('1,23,456.78')).toBe(12345678);
    expect(toPaise('₹ 99')).toBe(9900);
    expect(toPaise(' 250.5 ')).toBe(25050);
    expect(toPaise('Rs. 10')).toBe(1000);
  });

  it('accepts Decimal128-like objects through toString', () => {
    expect(toPaise({ toString: () => '123.456' })).toBe(12346);
  });

  it('never returns negative zero', () => {
    expect(Object.is(toPaise('-0'), 0)).toBe(true);
    expect(Object.is(toPaise(-0), 0)).toBe(true);
    expect(Object.is(toPaise('-0.004'), 0)).toBe(true);
  });

  it('returns null for missing or non-numeric input instead of zero', () => {
    for (const value of [
      null,
      undefined,
      '',
      'abc',
      '1e3',
      '12abc',
      NaN,
      Infinity,
      -Infinity,
      true,
      new Date(),
      {},
      [],
    ]) {
      expect(toPaise(value)).toBeNull();
    }
  });

  it('handles tiny exponent-form numbers', () => {
    expect(toPaise(1e-7)).toBe(0);
  });

  it('throws on amounts beyond the safe integer range', () => {
    expect(() => toPaise(1e21)).toThrow(RangeError);
    expect(() => toPaise(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => toPaise('99999999999999999999.99')).toThrow(RangeError);
  });
});

describe('paise arithmetic', () => {
  it('recognises integers only', () => {
    expect(isPaise(100)).toBe(true);
    expect(isPaise(-5)).toBe(true);
    expect(isPaise(1.5)).toBe(false);
    expect(isPaise('100')).toBe(false);
    expect(isPaise(null)).toBe(false);
  });

  it('asserts with a label', () => {
    expect(assertPaise(10)).toBe(10);
    expect(() => assertPaise(1.5, 'mrc')).toThrow(/mrc/);
  });

  it('sums integers and rejects fractional or missing entries', () => {
    expect(sumPaise([100, 250, -50])).toBe(300);
    expect(sumPaise([])).toBe(0);
    expect(() => sumPaise([100, 0.5])).toThrow(TypeError);
    expect(() => sumPaise([100, null])).toThrow(TypeError);
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toThrow(RangeError);
  });
});

describe('groupIndian', () => {
  it('groups the last three digits then pairs', () => {
    expect(groupIndian('0')).toBe('0');
    expect(groupIndian('999')).toBe('999');
    expect(groupIndian('1000')).toBe('1,000');
    expect(groupIndian('12345')).toBe('12,345');
    expect(groupIndian('123456')).toBe('1,23,456');
    expect(groupIndian('1234567')).toBe('12,34,567');
    expect(groupIndian('12345678')).toBe('1,23,45,678');
    expect(groupIndian('1000000000')).toBe('1,00,00,00,000');
  });

  it('rejects anything that is not a digit string', () => {
    expect(() => groupIndian('-1')).toThrow(TypeError);
    expect(() => groupIndian('1.5')).toThrow(TypeError);
    expect(() => groupIndian('')).toThrow(TypeError);
  });
});

describe('formatIndianNumber', () => {
  it('formats integers and decimals', () => {
    expect(formatIndianNumber(1234567)).toBe('12,34,567');
    expect(formatIndianNumber(1234567.891, { decimals: 2 })).toBe('12,34,567.89');
    expect(formatIndianNumber(500)).toBe('500');
    expect(formatIndianNumber(0, { decimals: 2 })).toBe('0.00');
    expect(formatIndianNumber(0.5, { decimals: 1 })).toBe('0.5');
  });

  it('keeps the sign and rounds half away from zero', () => {
    expect(formatIndianNumber(-1500)).toBe('-1,500');
    expect(formatIndianNumber(2.5)).toBe('3');
    expect(formatIndianNumber(-2.5)).toBe('-3');
  });

  it('never prints a negative zero', () => {
    expect(formatIndianNumber(-0.001, { decimals: 2 })).toBe('0.00');
    expect(formatIndianNumber(-0)).toBe('0');
  });

  it('validates input', () => {
    expect(() => formatIndianNumber(NaN)).toThrow(TypeError);
    expect(() => formatIndianNumber('5')).toThrow(TypeError);
    expect(() => formatIndianNumber(5, { decimals: 7 })).toThrow(RangeError);
    expect(() => formatIndianNumber(5, { decimals: 1.5 })).toThrow(RangeError);
  });
});

describe('formatInr', () => {
  it('formats paise with Indian grouping and two decimals', () => {
    expect(formatInr(12345678)).toBe('₹1,23,456.78');
    expect(formatInr(0)).toBe('₹0.00');
    expect(formatInr(5)).toBe('₹0.05');
    expect(formatInr(100)).toBe('₹1.00');
    expect(formatInr(100000000000)).toBe('₹1,00,00,00,000.00');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatInr(-12345678)).toBe('-₹1,23,456.78');
    expect(formatInr(-5)).toBe('-₹0.05');
  });

  it('drops zero decimals in auto mode only when exact', () => {
    expect(formatInr(150000, { decimals: 'auto' })).toBe('₹1,500');
    expect(formatInr(150001, { decimals: 'auto' })).toBe('₹1,500.01');
    expect(formatInr(0, { decimals: 'auto' })).toBe('₹0');
  });

  it('rounds to whole rupees half away from zero', () => {
    expect(formatInr(12350, { decimals: 0 })).toBe('₹124');
    expect(formatInr(12349, { decimals: 0 })).toBe('₹123');
    expect(formatInr(-12350, { decimals: 0 })).toBe('-₹124');
    expect(formatInr(-30, { decimals: 0 })).toBe('₹0');
    expect(formatInr(-60, { decimals: 0 })).toBe('-₹1');
  });

  it('supports another symbol', () => {
    expect(formatInr(12345, { symbol: 'Rs ' })).toBe('Rs 123.45');
  });

  it('rejects fractional paise and unsupported decimals', () => {
    expect(() => formatInr(10.5)).toThrow(TypeError);
    expect(() => formatInr('100')).toThrow(TypeError);
    expect(() => formatInr(100, { decimals: 1 })).toThrow(RangeError);
  });

  it('round-trips with toPaise', () => {
    for (const paise of [0, 1, 99, 100, 123456789, -4500000]) {
      const text = formatInr(paise);
      expect(toPaise(text)).toBe(paise);
    }
  });
});
