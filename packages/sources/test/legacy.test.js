import { describe, expect, it } from 'vitest';
import {
  LEGACY_SOURCE,
  SourceReaderError,
  buildLegacyRows,
  extractLiteral,
  parseMonthLabel,
  readLegacyExport
} from '../index.js';

const KEYS = { asha: 'Asha.Rao@Example.com', ravi: 'ravi@example.com' };

const wideSource = `
import x from 'y';

export const LEGACY_KEY_TO_EMAIL = {
  asha: 'Asha.Rao@Example.com',
  ravi: 'ravi@example.com',
  // retired employee
  meena: 'meena@example.com'
};

const RAW_HISTORICAL_GROWTH = [
  { month: '2024-01', asha: 100000, ravi: '50,000.50', ghost: 700, total: 150700.5 },
  { month: '2024-02', asha: 120000, ravi: 0, meena: 5 },
  /* quarter end */
  { month: 'Mar 2024', asha: 130000.755, ravi: 60000 }
];
`;

describe('extractLiteral', () => {
  it('reads an array behind const and a map behind export const', () => {
    expect(extractLiteral(wideSource, 'RAW_HISTORICAL_GROWTH')).toHaveLength(3);
    expect(extractLiteral(wideSource, 'LEGACY_KEY_TO_EMAIL')).toMatchObject({
      asha: 'Asha.Rao@Example.com'
    });
  });

  it('tolerates a type annotation, as const and Object.freeze', () => {
    const typed = "const RAW: Array<{ month: string }> = [{ month: '2024-01' }] as const;";
    expect(extractLiteral(typed, 'RAW')).toEqual([{ month: '2024-01' }]);
    expect(extractLiteral('let RAW = Object.freeze([{ a: 1 }]);', 'RAW')).toEqual([{ a: 1 }]);
  });

  it('is not fooled by brackets inside strings or comments', () => {
    const text = 'const RAW = [{ note: \'a ] } ) b\', other: "[" }, /* ] */ { n: 1 } // }\n];';
    expect(extractLiteral(text, 'RAW')).toEqual([{ note: 'a ] } ) b', other: '[' }, { n: 1 }]);
  });

  it('does not match a longer identifier that ends with the name', () => {
    expect(() => extractLiteral('const MY_RAW = [1];', 'RAW')).toThrow(/not found/);
  });

  it('fails clearly when the name is missing', () => {
    expect(() => extractLiteral('const a = 1;', 'RAW')).toThrow(SourceReaderError);
    expect(() => extractLiteral('const a = 1;', 'RAW')).toThrow(/RAW not found/);
  });

  it('refuses literals that are not static', () => {
    expect(() => extractLiteral('const RAW = [{ a: compute() }];', 'RAW')).toThrow(
      /static literal/
    );
    expect(() => extractLiteral('const RAW = buildRows();', 'RAW')).toThrow(
      /array or object literal/
    );
    expect(() => extractLiteral('const RAW = [{ a: process.exit(1) }];', 'RAW')).toThrow(
      /static literal/
    );
  });

  it('refuses unterminated literals', () => {
    expect(() => extractLiteral('const RAW = [{ a: 1 }', 'RAW')).toThrow(/Unterminated/);
  });
});

describe('parseMonthLabel', () => {
  it.each([
    ['2024-01', '2024-01'],
    ['2024-1', '2024-01'],
    ['2024-03-15', '2024-03'],
    ['2024/04', '2024-04'],
    ['Mar 2024', '2024-03'],
    ['March 2024', '2024-03'],
    ['Apr-2024', '2024-04'],
    ['May-24', '2024-05'],
    ['Jun 24', '2024-06']
  ])('parses %s', (label, monthKey) => {
    expect(parseMonthLabel(label)?.monthKey).toBe(monthKey);
  });

  it('anchors the month start at IST midnight', () => {
    expect(parseMonthLabel('2024-01').monthStart.toISOString()).toBe('2023-12-31T18:30:00.000Z');
  });

  it('accepts a Date and rejects nonsense', () => {
    expect(parseMonthLabel(new Date('2024-05-20T00:00:00.000Z')).monthKey).toBe('2024-05');
    expect(parseMonthLabel('someday')).toBeNull();
    expect(parseMonthLabel(null)).toBeNull();
  });
});

describe('buildLegacyRows (one column per employee)', () => {
  const rows = [
    { month: '2024-01', asha: 100000, ravi: '50,000.50', total: 150000.5 },
    { month: '2024-02', asha: 120000, ravi: 0 },
    { month: 'Mar 2024', asha: 130000.755, ravi: 60000, ghost: 700 }
  ];
  const result = buildLegacyRows({ rows, keyToEmail: KEYS });

  it('produces one row per employee and month, sorted', () => {
    expect(result.rows.map((row) => `${row.monthKey} ${row.email}`)).toEqual([
      '2024-01 asha.rao@example.com',
      '2024-01 ravi@example.com',
      '2024-02 asha.rao@example.com',
      '2024-02 ravi@example.com',
      '2024-03 asha.rao@example.com',
      '2024-03 ravi@example.com'
    ]);
    expect(result.rows.every((row) => row.source === LEGACY_SOURCE)).toBe(true);
  });

  it('converts to integer paise with half-away-from-zero rounding', () => {
    const find = (email, monthKey) =>
      result.rows.find((row) => row.email === email && row.monthKey === monthKey);
    expect(find('ravi@example.com', '2024-01').collectedPaise).toBe(5000050);
    expect(find('asha.rao@example.com', '2024-03').collectedPaise).toBe(13000076);
    expect(find('ravi@example.com', '2024-02').collectedPaise).toBe(0);
  });

  it('keeps unmapped keys out of the rows but inside the source total', () => {
    expect(result.unmapped).toEqual({ ghost: { rows: 1, totalPaise: 70000 } });
    const { sourceTotalPaise, exportedTotalPaise, unmappedTotalPaise } = result.totals;
    expect(sourceTotalPaise).toBe(exportedTotalPaise + unmappedTotalPaise);
    expect(sourceTotalPaise).toBe(10000000 + 5000050 + 12000000 + 0 + 13000076 + 6000000 + 70000);
  });

  it('counts entries without the total column', () => {
    expect(result.counts).toMatchObject({
      sourceRows: 3,
      entries: 7,
      exportedRows: 6,
      employees: 2,
      months: 3
    });
  });

  it('detects the month field and reports it', () => {
    expect(result.monthField).toBe('month');
    expect(
      buildLegacyRows({ rows: [{ period: '2024-01', asha: 1 }], keyToEmail: KEYS }).monthField
    ).toBe('period');
  });
});

describe('buildLegacyRows (long format and options)', () => {
  it('reads key and amount fields', () => {
    const result = buildLegacyRows({
      rows: [
        { month: '2024-01', employee: 'asha', collected: 10 },
        { month: '2024-01', employee: 'ravi', collected: 20 },
        { month: '2024-02', employee: 'asha', collected: 30 }
      ],
      keyToEmail: KEYS,
      keyField: 'employee',
      amountField: 'collected'
    });
    expect(result.rows.map((row) => row.collectedPaise)).toEqual([1000, 2000, 3000]);
  });

  it('merges several legacy keys that map to one employee', () => {
    const result = buildLegacyRows({
      rows: [{ month: '2024-01', asha: 10, ashaOld: 5 }],
      keyToEmail: { asha: 'a@example.com', ashaOld: 'a@example.com' }
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ collectedPaise: 1500, legacyKeys: ['asha', 'ashaOld'] });
  });

  it('matches keys case-insensitively and accepts pair arrays', () => {
    const result = buildLegacyRows({
      rows: [{ month: '2024-01', ASHA: 10 }],
      keyToEmail: [['asha', 'a@example.com']]
    });
    expect(result.rows).toHaveLength(1);
  });

  it('can read amounts already in paise', () => {
    const result = buildLegacyRows({
      rows: [{ month: '2024-01', asha: 12345 }],
      keyToEmail: KEYS,
      unit: 'paise'
    });
    expect(result.rows[0].collectedPaise).toBe(12345);
  });

  it('honors an explicit month field and ignore list', () => {
    const result = buildLegacyRows({
      rows: [{ when: '2024-01', asha: 10, subtotal: 99 }],
      keyToEmail: KEYS,
      monthField: 'when',
      ignoreKeys: ['subtotal']
    });
    expect(result.rows).toHaveLength(1);
    expect(result.totals.sourceTotalPaise).toBe(1000);
  });

  it('fails on an unreadable month, a corrupt amount, a bad email or an unknown shape', () => {
    expect(() =>
      buildLegacyRows({ rows: [{ month: 'later', asha: 1 }], keyToEmail: KEYS })
    ).toThrow(/Unreadable month at row 0/);
    expect(() =>
      buildLegacyRows({
        rows: [{ month: '2024-01', e: 'x', c: 'abc' }],
        keyToEmail: KEYS,
        keyField: 'e',
        amountField: 'c'
      })
    ).toThrow(/Invalid amount/);
    expect(() =>
      buildLegacyRows({ rows: [{ month: '2024-01', asha: 1 }], keyToEmail: { asha: 'nope' } })
    ).toThrow(/Invalid email/);
    expect(() => buildLegacyRows({ rows: [{ foo: 1 }], keyToEmail: KEYS })).toThrow(/month field/);
    expect(() => buildLegacyRows({ rows: {}, keyToEmail: KEYS })).toThrow(/must be an array/);
    expect(() =>
      buildLegacyRows({ rows: [], keyToEmail: KEYS, monthField: 'month', unit: 'cents' })
    ).toThrow(/unit/);
  });

  it('returns an empty export for an empty array', () => {
    const result = buildLegacyRows({ rows: [], keyToEmail: KEYS, monthField: 'month' });
    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({
      sourceTotalPaise: 0,
      exportedTotalPaise: 0,
      unmappedTotalPaise: 0
    });
  });
});

describe('readLegacyExport', () => {
  it('goes from source text to monthly per-employee rows', () => {
    const result = readLegacyExport({ text: wideSource });
    expect(result.counts).toMatchObject({
      sourceRows: 3,
      exportedRows: 7,
      employees: 3,
      months: 3
    });
    expect(result.unmapped).toEqual({ ghost: { rows: 1, totalPaise: 70000 } });
    const perMonth = new Map();
    for (const row of result.rows)
      perMonth.set(row.monthKey, (perMonth.get(row.monthKey) ?? 0) + row.collectedPaise);
    expect(Object.fromEntries(perMonth)).toEqual({
      '2024-01': 10000000 + 5000050,
      '2024-02': 12000000 + 0 + 500,
      '2024-03': 13000076 + 6000000
    });
  });

  it('accepts custom names', () => {
    const text = "const A = [{ month: '2024-01', x: 1 }]; const B = { x: 'x@example.com' };";
    const result = readLegacyExport({ text, arrayName: 'A', mapName: 'B' });
    expect(result.rows[0]).toMatchObject({ email: 'x@example.com', collectedPaise: 100 });
  });
});
