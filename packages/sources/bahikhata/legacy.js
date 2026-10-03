import vm from 'node:vm';
import { IST } from '@fab5/shared/clock';
import { toPaise } from '@fab5/shared/money';
import { DateTime } from 'luxon';
import { SourceReaderError } from '../src/errors.js';

export const LEGACY_SOURCE = 'bahikhata_legacy_array';

const MONTH_FIELD_CANDIDATES = ['month', 'monthKey', 'period', 'date', 'label', 'name'];
const MONTH_FORMATS = [
  'yyyy-MM',
  'yyyy-M',
  'yyyy-MM-dd',
  'yyyy/MM',
  'yyyy/MM/dd',
  'MMM yyyy',
  'MMMM yyyy',
  'MMM-yyyy',
  'MMMM-yyyy',
  'MMM-yy',
  'MMM yy',
  'MMM, yyyy',
  'MMMM, yyyy'
];
const DEFAULT_IGNORED_KEYS = ['total', 'grandtotal', 'sum'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPENERS = { '[': ']', '{': '}', '(': ')' };
const CLOSERS = new Set([']', '}', ')']);

const fail = (message, code, details) => {
  throw new SourceReaderError(message, code, details);
};

function findClosing(text, start) {
  const stack = [];
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      if (end === -1) fail('Unterminated block comment', 'LEGACY_LITERAL_UNTERMINATED', {});
      index = end + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (OPENERS[char]) {
      stack.push(OPENERS[char]);
      continue;
    }
    if (CLOSERS.has(char)) {
      if (stack.pop() !== char) fail('Unbalanced brackets', 'LEGACY_LITERAL_UNBALANCED', {});
      if (stack.length === 0) return index;
    }
  }
  return fail('Unterminated literal', 'LEGACY_LITERAL_UNTERMINATED', {});
}

export function extractLiteral(sourceText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(`(?:^|[^\\w$])${escaped}\\s*(?::[^=;]+)?=\\s*`, 'm');
  const match = declaration.exec(sourceText);
  if (!match) fail(`${name} not found in the source file`, 'LEGACY_NAME_NOT_FOUND', { name });
  let start = match.index + match[0].length;
  const wrapper = /^Object\.freeze\(\s*/.exec(sourceText.slice(start));
  if (wrapper) start += wrapper[0].length;
  if (sourceText[start] !== '[' && sourceText[start] !== '{') {
    fail(`${name} is not an array or object literal`, 'LEGACY_LITERAL_NOT_STATIC', { name });
  }
  const end = findClosing(sourceText, start);
  const literal = sourceText.slice(start, end + 1);
  try {
    const value = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return fail(`${name} is not a static literal`, 'LEGACY_LITERAL_NOT_STATIC', {
      name,
      cause: error.message
    });
  }
}

export function parseMonthLabel(value) {
  let parsed = null;
  if (value instanceof Date) parsed = DateTime.fromJSDate(value, { zone: IST });
  else {
    const text = String(value ?? '').trim();
    for (const format of MONTH_FORMATS) {
      const attempt = DateTime.fromFormat(text, format, { zone: IST, locale: 'en' });
      if (attempt.isValid) {
        parsed = attempt;
        break;
      }
    }
    if (!parsed) {
      const iso = DateTime.fromISO(text, { zone: IST });
      if (iso.isValid) parsed = iso;
    }
  }
  if (!parsed || !parsed.isValid) return null;
  return {
    monthKey: parsed.toFormat('yyyy-MM'),
    monthStart: parsed.startOf('month').toUTC().toJSDate()
  };
}

function normalizeKeyMap(keyToEmail) {
  const entries = Array.isArray(keyToEmail)
    ? keyToEmail.map((item) => (Array.isArray(item) ? item : [item.key, item.email]))
    : Object.entries(keyToEmail ?? {});
  const table = new Map();
  for (const [key, address] of entries) {
    const email = String(address ?? '')
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email))
      fail(`Invalid email for legacy key ${key}`, 'LEGACY_EMAIL_INVALID', { key });
    table.set(String(key).trim().toLowerCase(), email);
  }
  return table;
}

const isAmount = (value) =>
  typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '' && toPaise(value) !== null);

function detectMonthField(row) {
  const found = MONTH_FIELD_CANDIDATES.find((candidate) => row && candidate in row);
  if (!found)
    fail('Cannot detect the month field; pass monthField', 'LEGACY_MONTH_FIELD_UNKNOWN', {});
  return found;
}

function paiseOf(value, unit, index, key) {
  const paise =
    unit === 'paise'
      ? Number.isFinite(Number(value))
        ? Math.round(Number(value))
        : null
      : toPaise(value);
  if (paise === null)
    fail(`Invalid amount at row ${index} for ${key}`, 'LEGACY_AMOUNT_INVALID', { index, key });
  return paise;
}

export function buildLegacyRows({
  rows,
  keyToEmail,
  monthField = null,
  keyField = null,
  amountField = null,
  unit = 'rupees',
  ignoreKeys = DEFAULT_IGNORED_KEYS
}) {
  if (!Array.isArray(rows)) fail('Legacy array must be an array', 'LEGACY_ARRAY_INVALID', {});
  if (unit !== 'rupees' && unit !== 'paise')
    fail('unit must be rupees or paise', 'LEGACY_UNIT_INVALID', { unit });
  const emailByKey = normalizeKeyMap(keyToEmail);
  const ignored = new Set(ignoreKeys.map((key) => key.toLowerCase()));
  const long = Boolean(keyField && amountField);
  const monthName = monthField ?? detectMonthField(rows[0]);

  const merged = new Map();
  const unmapped = {};
  let sourceTotalPaise = 0;
  let unmappedTotalPaise = 0;
  let entryCount = 0;

  rows.forEach((row, index) => {
    const month = parseMonthLabel(row?.[monthName]);
    if (!month) fail(`Unreadable month at row ${index}`, 'LEGACY_MONTH_INVALID', { index });
    const pairs = long
      ? [[row[keyField], row[amountField]]]
      : Object.entries(row).filter(([key, value]) => key !== monthName && isAmount(value));
    for (const [rawKey, amount] of pairs) {
      const key = String(rawKey ?? '').trim();
      if (key === '' || ignored.has(key.toLowerCase())) continue;
      const paise = paiseOf(amount, unit, index, key);
      entryCount += 1;
      sourceTotalPaise += paise;
      const email = emailByKey.get(key.toLowerCase());
      if (!email) {
        const bucket = unmapped[key] ?? { rows: 0, totalPaise: 0 };
        bucket.rows += 1;
        bucket.totalPaise += paise;
        unmapped[key] = bucket;
        unmappedTotalPaise += paise;
        continue;
      }
      const id = `${email}|${month.monthKey}`;
      const existing = merged.get(id);
      if (existing) {
        existing.collectedPaise += paise;
        if (!existing.legacyKeys.includes(key)) existing.legacyKeys.push(key);
      } else {
        merged.set(id, {
          email,
          legacyKeys: [key],
          monthKey: month.monthKey,
          monthStart: month.monthStart,
          collectedPaise: paise,
          source: LEGACY_SOURCE
        });
      }
    }
  });

  const exported = [...merged.values()].sort(
    (a, b) => a.monthKey.localeCompare(b.monthKey) || a.email.localeCompare(b.email)
  );
  const exportedTotalPaise = exported.reduce((sum, row) => sum + row.collectedPaise, 0);
  return {
    monthField: monthName,
    rows: exported,
    unmapped,
    totals: { sourceTotalPaise, exportedTotalPaise, unmappedTotalPaise },
    counts: {
      sourceRows: rows.length,
      entries: entryCount,
      exportedRows: exported.length,
      employees: new Set(exported.map((row) => row.email)).size,
      months: new Set(exported.map((row) => row.monthKey)).size
    }
  };
}

export function readLegacyExport({
  text,
  arrayName = 'RAW_HISTORICAL_GROWTH',
  mapName = 'LEGACY_KEY_TO_EMAIL',
  ...options
}) {
  const rows = extractLiteral(text, arrayName);
  const keyToEmail = extractLiteral(text, mapName);
  return buildLegacyRows({ rows, keyToEmail, ...options });
}
