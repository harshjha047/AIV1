import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function generateAppKey() {
  return `fab5ai_${randomBytes(32).toString('base64url')}`;
}

export function generateSigningSecret() {
  return randomBytes(32).toString('base64url');
}

export function hashAppKey(key) {
  return sha256Hex(String(key));
}

export function safeEqualHex(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyAppKey(presented, keyHash) {
  return safeEqualHex(hashAppKey(presented), keyHash);
}

export function signingPayload({ timestamp, method, path, body }) {
  const digest = sha256Hex(body ?? Buffer.alloc(0));
  return `${timestamp}\n${String(method).toUpperCase()}\n${path}\n${digest}`;
}

export function signRequest({ secret, timestamp, method, path, body }) {
  return createHmac('sha256', secret)
    .update(signingPayload({ timestamp, method, path, body }))
    .digest('hex');
}

export function verifySignature({ secret, signature, timestamp, method, path, body }) {
  const expected = signRequest({ secret, timestamp, method, path, body });
  return safeEqualHex(expected, signature);
}
