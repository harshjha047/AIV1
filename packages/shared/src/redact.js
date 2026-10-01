const RULES = [
  [/\b(mongodb(?:\+srv)?|postgres(?:ql)?|rediss?|amqps?):\/\/[^\s'"<>]+/gi, '$1://[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]'],
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\b(\s*[:=]\s*)[^\s,;'"]+/gi,
    '$1$2[redacted]'
  ]
];

export function redactSecrets(text) {
  let result = String(text ?? '');
  for (const [pattern, replacement] of RULES) result = result.replace(pattern, replacement);
  return result;
}

export function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? value.slice(0, max) : value;
}

export function safeMessage(input, max = 200) {
  const raw = input instanceof Error ? input.message : input;
  return truncate(redactSecrets(raw), max);
}
