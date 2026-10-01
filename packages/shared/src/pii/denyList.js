export const DENY_KEYS = Object.freeze([
  'password',
  'passwordResetOtp',
  'passwordResetToken',
  'refreshToken',
  'token',
  'otp',
  'otp_code',
  'secret',
  'apiKey',
  'adharNumber',
  'panNumber',
  'jti',
  'token_hash',
  'ip_address',
  'user_agent'
]);

export const DENY_KEY_WORDS = Object.freeze([
  'password',
  'passwd',
  'token',
  'otp',
  'secret',
  'aadhaar',
  'aadhar',
  'adhar',
  'pan'
]);

const SUBSTRING_WORDS = Object.freeze(['password', 'passwd', 'aadhaar', 'aadhar', 'adhar']);
const SUFFIX_WORDS = Object.freeze(['token', 'secret', 'otp']);

export const ALLOWED_EMAIL_TYPES = Object.freeze([
  'INVOICE',
  'CREDIT_NOTE',
  'PAYMENT_REMINDER_1',
  'PAYMENT_REMINDER_2',
  'SERVICE_SUSPENSION_NOTICE'
]);

export const DENIED_EMAIL_TYPE_PATTERNS = Object.freeze([
  /welcome/i,
  /password/i,
  /\botp\b/i,
  /reset/i
]);

export function compactKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function keyWords(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

const COMPACT_DENY_KEYS = new Set(DENY_KEYS.map(compactKey));

export function matchDeniedKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  const compact = compactKey(key);
  if (COMPACT_DENY_KEYS.has(compact)) return 'key_exact';
  const words = keyWords(key);
  if (words.some((word) => DENY_KEY_WORDS.includes(word))) return 'key_word';
  if (SUBSTRING_WORDS.some((word) => compact.includes(word))) return 'key_substring';
  if (SUFFIX_WORDS.some((word) => compact.endsWith(word))) return 'key_suffix';
  return null;
}

export function isDeniedKey(key) {
  return matchDeniedKey(key) !== null;
}

export function matchDeniedPath(path) {
  for (const segment of String(path).split('.')) {
    const rule = matchDeniedKey(segment.replace(/\[\d*\]/g, ''));
    if (rule) return { segment, rule };
  }
  return null;
}

const OTP_BEFORE = /\b(?:otp|code)\b(?:\s+(?:is|was))?\s*[:=#-]?\s*(?<!\d)\d{4,8}(?!\d)/i;
const OTP_AFTER = /(?<!\d)\d{4,8}(?!\d)\s*(?:is\s+(?:your|the)\s+)?\b(?:otp|code)\b/i;

export const VALUE_RULES = Object.freeze([
  Object.freeze({
    id: 'aadhaar_like',
    test: (text) => /(?<![A-Za-z0-9])\d{12}(?![A-Za-z0-9])/.test(text)
  }),
  Object.freeze({
    id: 'pan',
    test: (text) => /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/.test(text)
  }),
  Object.freeze({
    id: 'otp_code',
    test: (text) => OTP_BEFORE.test(text) || OTP_AFTER.test(text)
  }),
  Object.freeze({
    id: 'bearer',
    test: (text) => /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/.test(text)
  }),
  Object.freeze({
    id: 'password_text',
    test: (text) => /\b(?:password|passwd|pwd)\b\s*(?:is\b|[:=])\s*\S+/i.test(text)
  })
]);

export function isDeniedEmailType(type) {
  if (typeof type !== 'string') return true;
  if (!ALLOWED_EMAIL_TYPES.includes(type)) return true;
  return DENIED_EMAIL_TYPE_PATTERNS.some((pattern) => pattern.test(type));
}
