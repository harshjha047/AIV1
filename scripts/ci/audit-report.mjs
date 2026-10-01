import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readJson } from './workspaces.js';
import { summarizeAudit } from './lib.js';

const ALLOWLIST_PATH = 'scripts/ci/audit-allowlist.json';
const REPORT_PATH = 'ops/reports/audit.json';

const failAt = process.argv.includes('--fail-at')
  ? process.argv[process.argv.indexOf('--fail-at') + 1]
  : 'high';

const run = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error('npm audit returned no parseable output');
  console.error(run.stderr);
  process.exit(2);
}

if (report.error) {
  console.error(`npm audit failed: ${report.error.code ?? ''} ${report.error.summary ?? ''}`);
  process.exit(2);
}

const allowlist = existsSync(ALLOWLIST_PATH) ? readJson(ALLOWLIST_PATH) : [];
const today = new Date().toISOString().slice(0, 10);
const summary = summarizeAudit(report, { allowlist, today, failAt });

mkdirSync('ops/reports', { recursive: true });
writeFileSync(
  REPORT_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), failAt, ...summary }, null, 2),
);

console.log(JSON.stringify({ counts: summary.counts, failAt, ok: summary.ok }, null, 2));
for (const v of summary.failing)
  console.error(`FAIL ${v.severity} ${v.name} direct=${v.direct} fix=${v.fixAvailable}`);
for (const e of summary.expiredAllowlist) console.error(`EXPIRED allowlist ${e.id} (${e.expires})`);
process.exit(summary.ok ? 0 : 1);
