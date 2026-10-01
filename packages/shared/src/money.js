const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

const toDecimalString = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) * 100 > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('amount exceeds the safe paise range');
    }
    const text = String(value);
    return /e/i.test(text) ? value.toFixed(12) : text;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.replace(/[\s,₹]|^rs\.?/gi, '');
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const text = value.toString();
    return typeof text === 'string' && text !== '[object Object]'
      ? text.replace(/[\s,]/g, '')
      : null;
  }
  return null;
};

export const toPaise = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const text = toDecimalString(value);
  if (text === null || !DECIMAL.test(text)) return null;

  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole = '', fraction = ''] = unsigned.split('.');
  const padded = `${fraction}00`;
  let paise = BigInt(`${whole || '0'}${padded.slice(0, 2)}`);
  if (padded.length > 2 && padded.charCodeAt(2) >= 53) paise += 1n;
  if (negative) paise = -paise;

  const result = Number(paise);
  if (!Number.isSafeInteger(result)) throw new RangeError('amount exceeds the safe paise range');
  return result === 0 ? 0 : result;
};

export const isPaise = (value) => Number.isSafeInteger(value);

export const assertPaise = (value, label = 'amount') => {
  if (!isPaise(value)) throw new TypeError(`${label} must be an integer number of paise`);
  return value;
};

export const sumPaise = (values) => {
  let total = 0;
  for (const value of values) total += assertPaise(value);
  if (!Number.isSafeInteger(total)) throw new RangeError('sum exceeds the safe paise range');
  return total;
};

export const groupIndian = (digits) => {
  if (!/^\d+$/.test(digits)) throw new TypeError('digits must be a non-negative integer string');
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
};

export const formatIndianNumber = (value, { decimals = 0 } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('value must be a finite number');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6)
    throw new RangeError('decimals must be 0 to 6');
  const negative = value < 0;
  const scaled = BigInt(Math.round(Math.abs(value) * 10 ** decimals));
  const text = scaled.toString().padStart(decimals + 1, '0');
  const whole = decimals === 0 ? text : text.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : text.slice(-decimals);
  const body = fraction ? `${groupIndian(whole)}.${fraction}` : groupIndian(whole);
  return negative && scaled !== 0n ? `-${body}` : body;
};

export const formatInr = (paise, { decimals = 2, symbol = '₹' } = {}) => {
  assertPaise(paise, 'paise');
  if (!['auto', 0, 2].includes(decimals)) throw new RangeError('decimals must be 0, 2 or auto');
  const negative = paise < 0;
  const absolute = BigInt(Math.abs(paise));
  const rupees = absolute / 100n;
  const remainder = Number(absolute % 100n);

  let wholeRupees = rupees;
  let fraction = '';
  if (decimals === 0) {
    if (remainder >= 50) wholeRupees += 1n;
  } else if (decimals === 2 || remainder !== 0) {
    fraction = `.${String(remainder).padStart(2, '0')}`;
  }

  const body = `${symbol}${groupIndian(wholeRupees.toString())}${fraction}`;
  const isZero = wholeRupees === 0n && (fraction === '' || remainder === 0);
  return negative && !isZero ? `-${body}` : body;
};
