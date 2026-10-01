import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GROUPS = ['apps', 'packages'];

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

export const listWorkspaces = (root = process.cwd()) => {
  const dirs = [];
  for (const group of GROUPS) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const dir = join(base, entry.name);
      if (entry.isDirectory() && existsSync(join(dir, 'package.json'))) {
        dirs.push({ name: readJson(join(dir, 'package.json')).name, dir: resolve(dir) });
      }
    }
  }
  return dirs;
};
