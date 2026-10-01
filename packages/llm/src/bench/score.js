const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const REL_TOLERANCE = 0.005;
const VARIANT_TOLERANCE = 0.011;

export function extractNumbers(text) {
  return (String(text).match(NUMBER) ?? []).map((token) => Number(token.replace(/,/g, ''))).filter(Number.isFinite);
}

function near(actual, expected, tolerance) {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerance;
}

export function allowedNumbers(fact) {
  const exact = new Set();
  const variants = [];
  for (const metric of fact.metrics) {
    exact.add(metric.value);
    exact.add(Math.round(metric.value));
    variants.push(metric.value / 100000, metric.value / 10000000, metric.value / 1000);
  }
  for (const number of extractNumbers(fact.period)) exact.add(number);
  return { exact, variants };
}

export function groundingCheck(text, fact) {
  const { exact, variants } = allowedNumbers(fact);
  const numbers = extractNumbers(text);
  const ungrounded = numbers.filter((value) => {
    for (const allowed of exact) if (near(value, allowed, REL_TOLERANCE)) return false;
    for (const allowed of variants) if (near(value, allowed, VARIANT_TOLERANCE)) return false;
    return true;
  });
  return { numbers, ungrounded };
}

export function validateCommentary(json, fact) {
  const problems = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['not_object'];
  if (typeof json.commentary !== 'string' || json.commentary.trim().length === 0) problems.push('commentary');
  if (!Array.isArray(json.flags) || json.flags.some((flag) => typeof flag !== 'string')) problems.push('flags');
  else if (json.flags.some((flag) => !fact.flags.includes(flag))) problems.push('flag_not_allowed');
  const extra = Object.keys(json).filter((key) => key !== 'commentary' && key !== 'flags');
  if (extra.length > 0) problems.push('extra_fields');
  return problems;
}

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

export function scoreCommentary(json, fact) {
  const problems = validateCommentary(json, fact);
  const schemaValid = !problems.includes('not_object') && !problems.includes('commentary') && !problems.includes('flags') && !problems.includes('extra_fields');
  const flagsValid = !problems.includes('flag_not_allowed') && schemaValid;
  const text = schemaValid ? json.commentary : '';
  const grounding = schemaValid ? groundingCheck(text, fact) : { numbers: [], ungrounded: [] };
  const grounded = schemaValid && grounding.ungrounded.length === 0;
  const lengthOk = schemaValid && wordCount(text) <= 80;
  const score = (schemaValid ? 0.3 : 0) + (grounded ? 0.4 : 0) + (flagsValid ? 0.2 : 0) + (lengthOk ? 0.1 : 0);
  return { schemaValid, grounded, flagsValid, lengthOk, ungrounded: grounding.ungrounded, score: Math.round(score * 100) / 100 };
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
