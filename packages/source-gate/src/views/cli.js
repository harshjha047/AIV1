import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectArtifactDrift, detectDrift } from './drift.js';
import { generateSource } from './generate.js';

export function parseArgs(argv) {
  const options = {
    check: false,
    allowUnverified: false,
    sources: null,
    out: 'ops/db-admin',
    samples: 'ops/samples',
    live: 'ops/live',
    databases: {}
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new TypeError(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === '--check') options.check = true;
    else if (arg === '--allow-unverified') options.allowUnverified = true;
    else if (arg === '--source') options.sources = next().split(',').filter(Boolean);
    else if (arg === '--out') options.out = next();
    else if (arg === '--samples') options.samples = next();
    else if (arg === '--live') options.live = next();
    else if (arg === '--db') {
      for (const entry of next().split(',').filter(Boolean)) {
        const [key, value] = entry.includes('=') ? entry.split('=') : [null, entry];
        options.databases[key ?? '*'] = value;
      }
    } else throw new TypeError(`Unknown argument ${arg}`);
  }
  return options;
}

export function loadSamples(directory, sourceId) {
  const folder = join(directory, sourceId);
  if (!existsSync(folder)) return null;
  const samples = {};
  for (const file of readdirSync(folder)) {
    if (!file.endsWith('.json') || file === 'inventory.json') continue;
    samples[file.slice(0, -5)] = JSON.parse(readFileSync(join(folder, file), 'utf8'));
  }
  return samples;
}

export function loadLive(directory, sourceId) {
  const file = join(directory, `${sourceId}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readExisting(directory, sourceId) {
  const folder = join(directory, sourceId);
  const result = {};
  if (!existsSync(folder)) return result;
  for (const file of readdirSync(folder)) result[file] = readFileSync(join(folder, file), 'utf8');
  return result;
}

function databaseFor(options, spec) {
  return options.databases[spec.sourceId] ?? options.databases['*'] ?? spec.database;
}

export function runViewsCli(argv, { specs, io = console, fs = { mkdirSync, writeFileSync } } = {}) {
  const options = parseArgs(argv);
  const selected = (options.sources ?? Object.keys(specs)).map((id) => {
    if (!specs[id]) throw new TypeError(`Unknown source ${id}`);
    return specs[id];
  });
  const report = { ok: true, code: 0, sources: {} };
  for (const spec of selected) {
    const entry = { warnings: [], drift: [], files: [] };
    report.sources[spec.sourceId] = entry;
    let generated;
    try {
      generated = generateSource(spec, {
        database: databaseFor(options, spec),
        samples: loadSamples(options.samples, spec.sourceId) ?? undefined,
        allowUnverified: options.allowUnverified
      });
    } catch (error) {
      entry.error = { name: error.name, code: error.code, message: error.message, details: error.problems ?? error.violations ?? error.leaks ?? error.details };
      report.ok = false;
      report.code = 1;
      io.error(`${spec.sourceId}: ${error.name}: ${error.message}`);
      continue;
    }
    entry.warnings = generated.warnings;
    if (options.check) {
      const live = loadLive(options.live, spec.sourceId);
      if (live === undefined) entry.drift.push({ view: '*', kind: 'live_missing' });
      else entry.drift.push(...detectDrift(spec, live));
      entry.drift.push(...detectArtifactDrift(generated.files, readExisting(options.out, spec.sourceId)));
      if (entry.drift.length > 0) {
        report.ok = false;
        report.code = Math.max(report.code, 2);
        io.error(`${spec.sourceId}: drift ${JSON.stringify(entry.drift)}`);
      } else io.log(`${spec.sourceId}: no drift (specVersion ${spec.specVersion})`);
      continue;
    }
    const folder = join(options.out, spec.sourceId);
    fs.mkdirSync(folder, { recursive: true });
    for (const [name, content] of Object.entries(generated.files)) {
      fs.writeFileSync(join(folder, name), content);
      entry.files.push(name);
    }
    io.log(`${spec.sourceId}: wrote ${entry.files.length} files to ${folder}${generated.manifest.verified ? '' : ' (unverified)'}`);
  }
  return report;
}
