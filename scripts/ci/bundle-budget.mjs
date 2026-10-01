import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readJson } from './workspaces.js';
import { evaluateBudget, gzipTotalKb } from './lib.js';

const budgets = readJson('scripts/ci/budgets.json');
const results = [];

for (const budget of budgets) {
  if (!existsSync(budget.dir)) {
    results.push({ name: budget.name, skipped: true, ok: true });
    continue;
  }
  results.push(evaluateBudget(budget, gzipTotalKb(budget.dir)));
}

mkdirSync('ops/reports', { recursive: true });
writeFileSync(
  'ops/reports/bundle-budget.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
);

for (const r of results) {
  console.log(
    r.skipped
      ? `SKIP  ${r.name}  (build output not found)`
      : `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.actualGzipKb}KB / ${r.maxGzipKb}KB gzip`,
  );
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
