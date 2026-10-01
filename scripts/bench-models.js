import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOllamaClient, createOllamaProbe, createHostInfo, normalizeCandidate, renderEnv, renderMarkdown, runBenchmark, selectPins } from '@fab5/llm';

function parse(argv) {
  const options = { candidates: 'ops/ollama/candidates.json', out: 'ops/benchmarks', env: 'ops/ollama/models.env', runs: 3, roles: ['small', 'large', 'embed'], pull: false, pin: false, allowPartial: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new TypeError(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === '--candidates') options.candidates = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--env') options.env = next();
    else if (arg === '--runs') options.runs = Number(next());
    else if (arg === '--only') options.roles = next().split(',');
    else if (arg === '--pull') options.pull = true;
    else if (arg === '--pin') options.pin = true;
    else if (arg === '--allow-partial') options.allowPartial = true;
    else throw new TypeError(`Unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new TypeError('--runs must be a positive integer');
  return options;
}

const options = parse(process.argv.slice(2));
const candidates = JSON.parse(readFileSync(options.candidates, 'utf8'));
const client = createOllamaClient({ baseUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434' });
const probe = createOllamaProbe({ client });

const health = await probe.health();
if (!health.ok) {
  console.error(`Ollama is not reachable at ${client.baseUrl} (${health.errorClass})`);
  process.exit(1);
}

if (options.pull) {
  for (const role of options.roles) {
    const wanted = (candidates[role] ?? []).map(normalizeCandidate).map((entry) => entry.tag);
    for (const tag of await probe.missingModels(wanted)) {
      const result = spawnSync('ollama', ['pull', tag], { stdio: 'inherit' });
      if (result.status !== 0) console.error(`pull failed for ${tag}`);
    }
  }
}

const report = await runBenchmark({
  client,
  probe,
  os: createHostInfo(),
  candidates,
  roles: options.roles,
  runs: options.runs,
  now: () => new Date(),
  log: (line) => console.error(line)
});
const selection = selectPins(report);
const stamp = report.generatedAt.replace(/[:.]/g, '-');
mkdirSync(options.out, { recursive: true });
writeFileSync(join(options.out, `${stamp}.json`), `${JSON.stringify({ report, selection }, null, 2)}\n`);
writeFileSync(join(options.out, `${stamp}.md`), renderMarkdown(report, selection));
console.log(renderEnv(selection.pins).trimEnd());

const missing = Object.entries(selection.pins).filter(([, value]) => !value).map(([key]) => key);
if (missing.length > 0 && !options.allowPartial) {
  console.error(`No passing candidate for: ${missing.join(', ')}`);
  process.exit(2);
}
if (options.pin) writeFileSync(options.env, renderEnv(selection.pins));
