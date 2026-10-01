import { matchDeniedKey, VALUE_RULES } from './denyList.js';

export class PiiViolationError extends Error {
  constructor(hits, scanned) {
    super(`PII scan failed: ${hits.length} hit(s) in ${scanned} document(s)`);
    this.name = 'PiiViolationError';
    this.code = 'PII_VIOLATION';
    this.hits = hits;
    this.scanned = scanned;
  }
}

const DEFAULTS = Object.freeze({
  maxDepth: 24,
  maxStringLength: 20000,
  maxHits: 200,
  skipValueKeys: []
});

function isScannableObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof Date) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') return false;
  if (value._bsontype === 'Binary') return false;
  return true;
}

export function scanText(text, { maxStringLength = DEFAULTS.maxStringLength } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const sample = text.length > maxStringLength ? text.slice(0, maxStringLength) : text;
  const rules = [];
  for (const rule of VALUE_RULES) {
    if (rule.test(sample)) rules.push(rule.id);
  }
  return rules;
}

export function scanDocument(document, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const skipValueKeys = new Set(settings.skipValueKeys.map((key) => String(key)));
  const hits = [];
  const seen = new WeakSet();

  function record(path, kind, rule) {
    if (hits.length < settings.maxHits) hits.push({ path, kind, rule });
  }

  function visit(value, path, depth, keyName) {
    if (hits.length >= settings.maxHits) return;
    if (typeof value === 'string') {
      if (skipValueKeys.has(keyName)) return;
      for (const rule of scanText(value, settings)) record(path, 'value', rule);
      return;
    }
    if (!isScannableObject(value) || depth > settings.maxDepth) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1, keyName));
      return;
    }
    for (const key of Object.keys(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const keyRule = matchDeniedKey(key);
      if (keyRule) record(childPath, 'key', keyRule);
      visit(value[key], childPath, depth + 1, key);
    }
  }

  visit(document, '', 0, '');
  return hits;
}

export function scanDocuments(documents, options = {}) {
  const hits = [];
  let scanned = 0;
  for (const document of documents) {
    scanned += 1;
    const found = scanDocument(document, options);
    const id = document && typeof document === 'object' ? String(document._id ?? '') : '';
    for (const hit of found) {
      if (hits.length < (options.maxHits ?? DEFAULTS.maxHits)) hits.push({ ...hit, docId: id });
    }
  }
  return { ok: hits.length === 0, scanned, hits };
}

export async function scanStream(documents, options = {}) {
  const hits = [];
  let scanned = 0;
  for await (const document of documents) {
    scanned += 1;
    const id = document && typeof document === 'object' ? String(document._id ?? '') : '';
    for (const hit of scanDocument(document, options)) {
      if (hits.length < (options.maxHits ?? DEFAULTS.maxHits)) hits.push({ ...hit, docId: id });
    }
  }
  return { ok: hits.length === 0, scanned, hits };
}

export function assertClean(result) {
  if (!result.ok) throw new PiiViolationError(result.hits, result.scanned);
  return result;
}

export function summarizeHits(hits) {
  const byRule = {};
  for (const hit of hits) {
    const label = `${hit.kind}:${hit.rule}`;
    byRule[label] = (byRule[label] ?? 0) + 1;
  }
  return byRule;
}
