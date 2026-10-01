import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDepcheck, evaluateBudget, gzipTotalKb, summarizeAudit } from './lib.js';

const report = {
  vulnerabilities: {
    vitest: {
      severity: 'moderate',
      isDirect: true,
      fixAvailable: true,
      via: [{ source: 1, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }],
    },
    lodash: {
      severity: 'high',
      isDirect: false,
      fixAvailable: false,
      via: [{ source: 2, url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff' }],
    },
    node_modules_thing: {
      severity: 'critical',
      isDirect: false,
      fixAvailable: true,
      via: ['lodash'],
    },
  },
};

describe('summarizeAudit', () => {
  it('counts severities and fails at high by default', () => {
    const summary = summarizeAudit(report, { today: '2026-10-01' });
    expect(summary.counts).toEqual({ info: 0, low: 0, moderate: 1, high: 1, critical: 1 });
    expect(summary.total).toBe(3);
    expect(summary.failing.map((v) => v.name).sort()).toEqual(['lodash', 'node_modules_thing']);
    expect(summary.ok).toBe(false);
  });

  it('passes when nothing reaches the threshold', () => {
    const summary = summarizeAudit(
      { vulnerabilities: { a: { severity: 'low', via: [] } } },
      { today: '2026-10-01' },
    );
    expect(summary.ok).toBe(true);
    expect(summary.failing).toEqual([]);
  });

  it('respects a stricter or looser threshold', () => {
    expect(
      summarizeAudit(report, { today: '2026-10-01', failAt: 'critical' }).failing,
    ).toHaveLength(1);
    expect(
      summarizeAudit(report, { today: '2026-10-01', failAt: 'moderate' }).failing,
    ).toHaveLength(3);
  });

  it('honors an active allowlist entry by advisory id or package name', () => {
    const allowlist = [
      { id: 'GHSA-dddd-eeee-ffff', reason: 'no exploit path', expires: '2026-12-31' },
      { id: 'node_modules_thing', reason: 'transitive of lodash', expires: '2026-12-31' },
    ];
    const summary = summarizeAudit(report, { allowlist, today: '2026-10-01' });
    expect(summary.failing).toEqual([]);
    expect(summary.allowed.map((v) => v.name).sort()).toEqual(['lodash', 'node_modules_thing']);
    expect(summary.ok).toBe(true);
  });

  it('ignores and flags expired allowlist entries', () => {
    const allowlist = [{ id: 'GHSA-dddd-eeee-ffff', reason: 'old', expires: '2026-01-01' }];
    const summary = summarizeAudit(report, { allowlist, today: '2026-10-01' });
    expect(summary.failing.map((v) => v.name)).toContain('lodash');
    expect(summary.expiredAllowlist).toHaveLength(1);
    expect(summary.ok).toBe(false);
  });

  it('does not match advisory ids by substring', () => {
    const allowlist = [{ id: 'dddd-eeee-ffff', reason: 'partial', expires: '2026-12-31' }];
    const summary = summarizeAudit(report, { allowlist, today: '2026-10-01' });
    expect(summary.allowed).toEqual([]);
  });

  it('handles an empty report', () => {
    expect(summarizeAudit({}, { today: '2026-10-01' }).ok).toBe(true);
  });
});

describe('classifyDepcheck', () => {
  it('fails on missing dependencies not provided by the root', () => {
    const result = {
      missing: { zod: ['a.js'], vitest: ['b.test.js'] },
      dependencies: ['left-pad'],
      devDependencies: [],
    };
    const out = classifyDepcheck(result, ['vitest']);
    expect(out.missing).toEqual([{ name: 'zod', files: ['a.js'] }]);
    expect(out.unused).toEqual(['left-pad']);
    expect(out.ok).toBe(false);
  });

  it('passes when only unused dependencies exist', () => {
    const out = classifyDepcheck({ missing: {}, dependencies: ['x'], devDependencies: ['y'] });
    expect(out.ok).toBe(true);
    expect(out.unused).toEqual(['x', 'y']);
  });

  it('reports invalid files', () => {
    expect(classifyDepcheck({ invalidFiles: { 'a.js': 'err' } }).invalidFiles).toEqual(['a.js']);
  });
});

describe('bundle budget', () => {
  const makeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'fab5-bundle-'));
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'a.js'), 'x'.repeat(50000));
    writeFileSync(join(dir, 'nested', 'b.js'), 'y'.repeat(50000));
    writeFileSync(join(dir, 'style.css'), 'z'.repeat(50000));
    return dir;
  };

  it('sums gzip size of matching files recursively', () => {
    const dir = makeDir();
    const kb = gzipTotalKb(dir, '.js');
    expect(kb).toBeGreaterThan(0);
    expect(kb).toBeLessThan(2);
    expect(gzipTotalKb(dir, '.css')).toBeLessThan(kb);
  });

  it('evaluates against the limit', () => {
    expect(evaluateBudget({ name: 'x', maxGzipKb: 10 }, 9.99).ok).toBe(true);
    expect(evaluateBudget({ name: 'x', maxGzipKb: 10 }, 10).ok).toBe(true);
    expect(evaluateBudget({ name: 'x', maxGzipKb: 10 }, 10.01).ok).toBe(false);
  });
});
