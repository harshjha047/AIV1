import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createRealClock } from '@fab5/shared/clock';
import { LEGACY_SOURCE, readLegacyExport } from '@fab5/sources';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    out: { type: 'string', default: 'ops/live/legacy_collections.export.json' },
    'array-name': { type: 'string', default: 'RAW_HISTORICAL_GROWTH' },
    'map-name': { type: 'string', default: 'LEGACY_KEY_TO_EMAIL' },
    'month-field': { type: 'string' },
    'key-field': { type: 'string' },
    'amount-field': { type: 'string' },
    unit: { type: 'string', default: 'rupees' }
  }
});

if (!values.file) {
  console.error(
    'usage: npm run legacy:export -- --file <bahikhata source file> [--out path] [--month-field f] [--key-field f --amount-field f] [--unit rupees|paise]'
  );
  process.exit(1);
}

try {
  const result = readLegacyExport({
    text: readFileSync(values.file, 'utf8'),
    arrayName: values['array-name'],
    mapName: values['map-name'],
    monthField: values['month-field'] ?? null,
    keyField: values['key-field'] ?? null,
    amountField: values['amount-field'] ?? null,
    unit: values.unit
  });
  const payload = {
    source: LEGACY_SOURCE,
    generatedAt: createRealClock().now().toISOString(),
    sourceFile: basename(values.file),
    monthField: result.monthField,
    counts: result.counts,
    totals: result.totals,
    unmapped: result.unmapped,
    rows: result.rows
  };
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        out: values.out,
        counts: result.counts,
        totals: result.totals,
        unmapped: Object.keys(result.unmapped)
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exitCode = 1;
}
