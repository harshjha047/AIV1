import { randomBytes } from 'node:crypto';
import { ID_PREFIXES, SOURCE_IDS } from './constants.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TIME_BITS = 48n;
const RANDOM_BITS = 80n;
const MAX_TIME = (1n << TIME_BITS) - 1n;
const MAX_RANDOM = (1n << RANDOM_BITS) - 1n;

const encodeBase32 = (value, length) => {
  let remaining = value;
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output = ALPHABET[Number(remaining & 31n)] + output;
    remaining >>= 5n;
  }
  return output;
};

const decodeBase32 = (text) => {
  let value = 0n;
  for (const char of text) value = (value << 5n) | BigInt(ALPHABET.indexOf(char));
  return value;
};

const defaultRandom = () => BigInt(`0x${randomBytes(10).toString('hex')}`);

export const createUlidFactory = ({ now, random = defaultRandom } = {}) => {
  if (typeof now !== 'function') throw new TypeError('createUlidFactory requires a now() function');
  let lastTime = -1n;
  let lastRandom = 0n;

  return () => {
    const instant = BigInt(now().getTime());
    if (instant < 0n || instant > MAX_TIME) throw new RangeError('time out of ULID range');
    let entropy;
    if (instant === lastTime) {
      entropy = lastRandom + 1n;
      if (entropy > MAX_RANDOM)
        throw new RangeError('ULID entropy overflow within one millisecond');
    } else {
      entropy = random() & MAX_RANDOM;
    }
    lastTime = instant;
    lastRandom = entropy;
    return encodeBase32(instant, 10) + encodeBase32(entropy, 16);
  };
};

export const isUlid = (value) => typeof value === 'string' && ULID.test(value);

export const ulidTime = (ulid) => {
  if (!isUlid(ulid)) throw new TypeError('not a ULID');
  return new Date(Number(decodeBase32(ulid.slice(0, 10))));
};

export const createIdGenerator = ({ now } = {}) => {
  const ulid = createUlidFactory({ now });
  const prefixed = (prefix) => () => `${prefix}_${ulid()}`;
  return Object.freeze({
    ulid,
    employeeId: prefixed(ID_PREFIXES.employee),
    customerId: prefixed(ID_PREFIXES.customer),
  });
};

const prefixedPattern = (prefix) => new RegExp(`^${prefix}_[0-7][0-9A-HJKMNP-TV-Z]{25}$`);
const EMPLOYEE_ID = prefixedPattern(ID_PREFIXES.employee);
const CUSTOMER_ID = prefixedPattern(ID_PREFIXES.customer);

export const isEmployeeId = (value) => typeof value === 'string' && EMPLOYEE_ID.test(value);
export const isCustomerId = (value) => typeof value === 'string' && CUSTOMER_ID.test(value);

export const factId = (sourceId, ...parts) => {
  if (!SOURCE_IDS.includes(sourceId)) throw new TypeError(`unknown source id ${sourceId}`);
  if (parts.length === 0) throw new TypeError('factId requires at least one source row id');
  for (const part of parts) {
    const text = String(part);
    if (text === '' || text.includes(':'))
      throw new TypeError('source row ids must be non-empty and contain no colon');
  }
  return [sourceId, ...parts.map(String)].join(':');
};

export const parseFactId = (id) => {
  if (typeof id !== 'string') throw new TypeError('fact id must be a string');
  const [sourceId, ...parts] = id.split(':');
  if (!SOURCE_IDS.includes(sourceId) || parts.length === 0 || parts.some((part) => part === '')) {
    throw new TypeError(`invalid fact id ${id}`);
  }
  return { sourceId, parts };
};
