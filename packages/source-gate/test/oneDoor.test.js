import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractImports,
  findDriverDependencies,
  findDriverImports
} from '../src/oneDoor.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temp = [];

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), 'one-door-'));
  temp.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  while (temp.length) rmSync(temp.pop(), { recursive: true, force: true });
});

describe('workspace import graph', () => {
  it('has no driver imports outside source-gate and snapshot-db', () => {
    expect(findDriverImports(repoRoot)).toEqual([]);
  });

  it('has no driver dependencies outside source-gate and snapshot-db', () => {
    expect(findDriverDependencies(repoRoot)).toEqual([]);
  });
});

describe('seeded violations fail', () => {
  it.each([
    ['static import', "import { MongoClient } from 'mongodb';"],
    ['default import', "import pg from 'pg';"],
    ['side effect import', "import 'mongoose';"],
    ['dynamic import', "const m = await import('mongodb');"],
    ['require', "const pg = require('pg');"],
    ['export from', "export { Pool } from 'pg';"],
    ['subpath', "import x from 'mongodb/lib/utils';"],
    ['pg-pool', "import Pool from 'pg-pool';"],
    ['pg-promise', "const p = require('pg-promise');"]
  ])('%s', (_name, source) => {
    const root = workspace({ 'apps/ai-worker/src/bad.js': source });
    expect(findDriverImports(root)).toEqual([
      { file: 'apps/ai-worker/src/bad.js', specifier: expect.any(String) }
    ]);
  });

  it('catches jsx files and scripts', () => {
    const root = workspace({
      'apps/ai-hub/app/page.jsx': "import { MongoClient } from 'mongodb';",
      'scripts/tool.mjs': "import pg from 'pg';"
    });
    expect(findDriverImports(root)).toHaveLength(2);
  });

  it('allows the two permitted packages', () => {
    const root = workspace({
      'packages/source-gate/src/a.js': "import { MongoClient } from 'mongodb';",
      'packages/snapshot-db/src/b.js': "import { MongoClient } from 'mongodb';",
      'packages/shared/src/c.js': "import { createHash } from 'node:crypto';"
    });
    expect(findDriverImports(root)).toEqual([]);
  });

  it('ignores commented imports and similarly named modules', () => {
    const root = workspace({
      'apps/ai-service/src/ok.js': "// import 'mongodb';\nimport x from 'mongodb-memory-server';\nimport p from 'pgvector-helper';"
    });
    expect(findDriverImports(root)).toEqual([]);
  });

  it('flags driver dependencies declared by other packages', () => {
    const root = workspace({
      'apps/ai-worker/package.json': JSON.stringify({ dependencies: { pg: '^8' } }),
      'packages/shared/package.json': JSON.stringify({ devDependencies: { mongoose: '^8' } }),
      'packages/source-gate/package.json': JSON.stringify({ dependencies: { mongodb: '^6' } })
    });
    expect(findDriverDependencies(root)).toEqual([
      { file: 'apps/ai-worker/package.json', dependency: 'pg' },
      { file: 'packages/shared/package.json', dependency: 'mongoose' }
    ]);
  });

  it('extracts every import style', () => {
    expect(
      extractImports(
        "import a from 'x'; import 'y'; export * from 'z'; const q = await import('w'); require('v');"
      ).sort()
    ).toEqual(['v', 'w', 'x', 'y', 'z']);
  });
});
