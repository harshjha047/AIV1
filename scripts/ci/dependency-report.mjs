import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import depcheck from 'depcheck';
import { readJson, listWorkspaces } from './workspaces.js';
import { classifyDepcheck } from './lib.js';

const root = resolve('.');
const rootPackage = readJson(resolve('package.json'));
const rootDevDependencies = Object.keys(rootPackage.devDependencies ?? {});

const options = {
  ignorePatterns: ['node_modules', 'coverage', 'dist', '.next', 'ops'],
  ignoreMatches: ['@fab5/*'],
};

const targets = [
  { name: rootPackage.name, dir: root, shared: [] },
  ...listWorkspaces(root).map((w) => ({ ...w, shared: rootDevDependencies })),
];

const report = [];
for (const target of targets) {
  const result = await depcheck(target.dir, {
    ...options,
    ignoreMatches:
      target.dir === root
        ? [...options.ignoreMatches, ...rootDevDependencies]
        : options.ignoreMatches,
  });
  report.push({ workspace: target.name, ...classifyDepcheck(result, target.shared) });
}

mkdirSync('ops/reports', { recursive: true });
writeFileSync(
  'ops/reports/dependencies.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), workspaces: report }, null, 2),
);

for (const entry of report) {
  console.log(
    `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.workspace}  missing=${entry.missing.length} unused=${entry.unused.length}`,
  );
  for (const m of entry.missing) console.error(`  missing ${m.name} used in ${m.files.join(', ')}`);
}
process.exit(report.every((entry) => entry.ok) ? 0 : 1);
