import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export function isPasswordHash(value) {
  return typeof value === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value);
}

export async function verifyPassword(password, encoded) {
  if (!isPasswordHash(encoded)) return false;
  const [, n, r, p, salt, hash] = encoded.split('$');
  const expected = Buffer.from(hash, 'base64');
  const derived = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
