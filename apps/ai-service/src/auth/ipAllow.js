function ipv4ToInt(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const number = Number(part);
    if (number > 255) return null;
    result = result * 256 + number;
  }
  return result;
}

export function normalizeIp(value) {
  const text = String(value ?? '').trim();
  return text.startsWith('::ffff:') ? text.slice(7) : text;
}

function matches(rule, ip) {
  if (!rule.includes('/')) return normalizeIp(rule) === ip;
  const [base, bitsText] = rule.split('/');
  const bits = Number(bitsText);
  const baseInt = ipv4ToInt(normalizeIp(base));
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const shift = 2 ** (32 - bits);
  return Math.floor(baseInt / shift) === Math.floor(ipInt / shift);
}

export function ipAllowed(rules, ip) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  const address = normalizeIp(ip);
  return rules.some((rule) => matches(String(rule).trim(), address));
}
