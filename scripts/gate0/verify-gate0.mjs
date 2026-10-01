import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateDecisions, summarize } from './checks.js';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const message = (error) => String(error.stderr || error.message).trim();

const config = readJson('scripts/gate0/gate0.config.json');
const decisions = readJson('docs/decisions/gate0-decisions.json');
const facts = {
  repos: {},
  resendExportExists: existsSync('ops/resend-export.json'),
  baseline: null,
};

for (const repo of config.repos) {
  const fact = {};
  try {
    const value = run('gh', [
      'api',
      `repos/${config.owner}/${repo.name}`,
      '--jq',
      '.private',
    ]).trim();
    fact.private = value === 'true';
    fact.privateDetail = `private=${value}`;
  } catch (error) {
    fact.private = null;
    fact.privateDetail = message(error);
  }

  const dir = resolve(repo.path);
  if (!existsSync(dir)) {
    fact.findings = null;
    fact.findingsDetail = 'path missing';
  } else {
    const report = `ops/verify-gitleaks-${repo.name}.json`;
    try {
      run('gitleaks', [
        'detect',
        '--source',
        dir,
        '--log-opts=--all',
        '--redact',
        '--report-format',
        'json',
        '--report-path',
        report,
        '--exit-code',
        '0',
      ]);
      fact.findings = readJson(report).length;
      fact.findingsDetail = `findings=${fact.findings}`;
    } catch (error) {
      fact.findings = null;
      fact.findingsDetail = message(error);
    }
  }
  facts.repos[repo.name] = fact;
}

if (existsSync('ops/baseline.json')) facts.baseline = readJson('ops/baseline.json');

const results = evaluateDecisions(decisions, config, facts);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail}`);
const summary = summarize(results);
console.log(`\n${summary.passed}/${summary.total} passed`);
process.exit(summary.ok ? 0 : 1);
