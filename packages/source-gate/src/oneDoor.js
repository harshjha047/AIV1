import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const BANNED_MODULES = /^(mongodb|mongoose|pg|pg-[\w-]+)(\/.*)?$/;
export const ALLOWED_PACKAGE_DIRS = ['packages/source-gate', 'packages/snapshot-db'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.local']);
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies'
];

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:[\w*{}\s,]+?\s+)?from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export function extractImports(source) {
  const text = stripComments(source);
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function isAllowed(rootDir, file) {
  const rel = relative(rootDir, file).split(sep).join('/');
  return ALLOWED_PACKAGE_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

export function findDriverImports(rootDir) {
  const violations = [];
  walk(rootDir, (file) => {
    const ext = file.slice(file.lastIndexOf('.'));
    if (!SOURCE_EXTENSIONS.has(ext) || isAllowed(rootDir, file)) return;
    for (const specifier of extractImports(readFileSync(file, 'utf8'))) {
      if (BANNED_MODULES.test(specifier)) {
        violations.push({ file: relative(rootDir, file).split(sep).join('/'), specifier });
      }
    }
  });
  return violations;
}

export function findDriverDependencies(rootDir) {
  const violations = [];
  walk(rootDir, (file) => {
    if (!file.endsWith(`${sep}package.json`) && file !== join(rootDir, 'package.json')) return;
    if (isAllowed(rootDir, file)) return;
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (BANNED_MODULES.test(name)) {
          violations.push({ file: relative(rootDir, file).split(sep).join('/'), dependency: name });
        }
      }
    }
  });
  return violations;
}
