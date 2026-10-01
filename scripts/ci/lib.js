import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

const advisoryKeys = (name, vulnerability) => {
  const keys = [name];
  for (const via of vulnerability.via ?? []) {
    if (via && typeof via === 'object') {
      if (via.url) keys.push(via.url);
      if (via.source) keys.push(String(via.source));
    }
  }
  return keys;
};

const matchesEntry = (keys, entry) =>
  keys.some((key) => key === entry.id || key.endsWith(`/${entry.id}`));

export const summarizeAudit = (report, { allowlist = [], today, failAt = 'high' } = {}) => {
  const threshold = SEVERITY_ORDER.indexOf(failAt);
  const active = allowlist.filter((entry) => entry.expires >= today);
  const expiredAllowlist = allowlist.filter((entry) => entry.expires < today);

  const vulnerabilities = Object.entries(report.vulnerabilities ?? {}).map(
    ([name, vulnerability]) => {
      const keys = advisoryKeys(name, vulnerability);
      return {
        name,
        severity: vulnerability.severity,
        direct: Boolean(vulnerability.isDirect),
        fixAvailable: Boolean(vulnerability.fixAvailable),
        allowed: active.some((entry) => matchesEntry(keys, entry)),
      };
    },
  );

  const counts = Object.fromEntries(SEVERITY_ORDER.map((level) => [level, 0]));
  for (const { severity } of vulnerabilities) counts[severity] += 1;

  const failing = vulnerabilities.filter(
    (v) => SEVERITY_ORDER.indexOf(v.severity) >= threshold && !v.allowed,
  );

  return {
    counts,
    total: vulnerabilities.length,
    failing,
    allowed: vulnerabilities.filter((v) => v.allowed),
    expiredAllowlist,
    ok: failing.length === 0 && expiredAllowlist.length === 0,
  };
};

export const classifyDepcheck = (result, sharedDevDependencies = []) => {
  const shared = new Set(sharedDevDependencies);
  const missing = Object.entries(result.missing ?? {})
    .filter(([name]) => !shared.has(name))
    .map(([name, files]) => ({ name, files }));
  return {
    missing,
    unused: [...(result.dependencies ?? []), ...(result.devDependencies ?? [])],
    invalidFiles: Object.keys(result.invalidFiles ?? {}),
    ok: missing.length === 0,
  };
};

const walk = (dir, extension, files = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, extension, files);
    else if (path.endsWith(extension)) files.push(path);
  }
  return files;
};

export const gzipTotalKb = (dir, extension = '.js') => {
  const bytes = walk(dir, extension).reduce(
    (sum, file) => sum + gzipSync(readFileSync(file)).length,
    0,
  );
  return Math.round((bytes / 1024) * 100) / 100;
};

export const evaluateBudget = (budget, actualKb) => ({
  name: budget.name,
  maxGzipKb: budget.maxGzipKb,
  actualGzipKb: actualKb,
  ok: actualKb <= budget.maxGzipKb,
});
