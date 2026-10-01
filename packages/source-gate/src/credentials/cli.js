import { modeFromEnv } from '@fab5/shared/mode';
import { buildSourceDocument, knownSourceIds } from '../definitions.js';

const SCHEMES = Object.freeze({
  mongodb: /^mongodb(\+srv)?:\/\/[^\s]+$/,
  postgres: /^postgres(ql)?:\/\/[^\s]+$/
});

export class SourceAddError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SourceAddError';
    this.code = code;
  }
}

export function parseSourceAddArgs(argv) {
  const options = { sourceId: null, remove: false, stdin: false, mode: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--remove') options.remove = true;
    else if (arg === '--stdin') options.stdin = true;
    else if (arg === '--mode') {
      index += 1;
      options.mode = argv[index];
      if (!['practice', 'production'].includes(options.mode)) throw new SourceAddError('--mode must be practice or production', 'BAD_ARGS');
    } else if (arg.startsWith('--')) throw new SourceAddError(`Unknown argument ${arg}`, 'BAD_ARGS');
    else if (options.sourceId === null) options.sourceId = arg;
    else throw new SourceAddError('Only one source id is accepted', 'BAD_ARGS');
  }
  if (!options.sourceId) throw new SourceAddError('usage: source:add <sourceId> [--stdin] [--remove] [--mode practice|production]', 'BAD_ARGS');
  if (!knownSourceIds().includes(options.sourceId)) throw new SourceAddError(`Unknown source id ${options.sourceId}`, 'UNKNOWN_SOURCE');
  return options;
}

export function validateConnectionUri(engine, uri) {
  const value = String(uri ?? '').trim();
  if (!value) throw new SourceAddError('Connection string is empty', 'EMPTY_SECRET');
  if (!SCHEMES[engine]?.test(value)) throw new SourceAddError(`Connection string does not match engine ${engine}`, 'BAD_URI');
  if (!/^[a-z+]+:\/\/[^/@\s]+:[^/@\s]+@/i.test(value)) {
    throw new SourceAddError('Connection string must include the read-only user and password', 'NO_CREDENTIALS');
  }
  return value;
}

export function readSecret({ input = process.stdin, output = process.stderr, prompt = 'Connection string: ' } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      const chunks = [];
      input.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      input.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
      input.on('error', reject);
      return;
    }
    output.write(prompt);
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new SourceAddError('Cancelled', 'CANCELLED'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
      return undefined;
    }
    input.on('data', onData);
  });
}

export async function runSourceAdd({ argv, env = process.env, clock, store, credentials, secretReader, output = process.stdout }) {
  const options = parseSourceAddArgs(argv);
  const { sourceId } = options;
  const mode = options.mode ?? modeFromEnv(env);
  const existing = await store.get(sourceId);
  if (options.remove) {
    await credentials.remove(sourceId);
    if (existing) await store.update(sourceId, { credentialRef: `env:SRC_${sourceId.toUpperCase()}_URI`, updatedAt: clock.now() });
    output.write(`removed stored credential for ${sourceId}\n`);
    return { sourceId, removed: true };
  }
  const document = existing ?? buildSourceDocument(sourceId, { mode, clock, env });
  const secret = validateConnectionUri(document.engine, await secretReader());
  await credentials.put(sourceId, secret, { createdBy: 'cli' });
  const ref = `store:${sourceId}`;
  if (existing) await store.update(sourceId, { credentialRef: ref, updatedAt: clock.now() });
  else await store.insert({ ...document, credentialRef: ref });
  output.write(`stored encrypted credential for ${sourceId} (${ref}); source state: ${existing?.state ?? 'not_configured'}\n`);
  output.write('next: verify read-only access from the hub (Test), then activate\n');
  return { sourceId, ref, created: !existing };
}
