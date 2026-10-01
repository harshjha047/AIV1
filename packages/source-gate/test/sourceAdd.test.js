import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createCipher } from '@fab5/shared/cipher';
import { createCredentialStore } from '../src/credentials/store.js';
import { SourceAddError, parseSourceAddArgs, readSecret, runSourceAdd, validateConnectionUri } from '../src/credentials/cli.js';
import { createFakeClock, createMemoryDataSourceStore } from './helpers.js';

const cipher = createCipher({ keys: { k1: Buffer.alloc(32, 3).toString('base64') }, activeKeyId: 'k1' });

function memoryCollection() {
  const docs = new Map();
  return {
    docs,
    findOne: async (filter) => (docs.has(filter._id) ? structuredClone(docs.get(filter._id)) : null),
    replaceOne: async (filter, doc) => void docs.set(filter._id, structuredClone(doc)),
    deleteOne: async (filter) => void docs.delete(filter._id),
    find: () => ({ toArray: async () => [...docs.values()] })
  };
}

function setup() {
  const clock = createFakeClock();
  const collection = memoryCollection();
  const store = createMemoryDataSourceStore([]);
  const credentials = createCredentialStore({ collection, cipher, clock });
  const written = [];
  const output = { write: (text) => written.push(text) };
  return { clock, collection, store, credentials, written, output };
}

const URI = 'mongodb://ai_ro:s3cr3t@127.0.0.1:27017/crm?authSource=crm';

describe('argument parsing', () => {
  it('accepts a known source with flags', () => {
    expect(parseSourceAddArgs(['crm', '--stdin', '--mode', 'practice'])).toEqual({ sourceId: 'crm', remove: false, stdin: true, mode: 'practice' });
    expect(parseSourceAddArgs(['samadhan_synthetic', '--remove']).remove).toBe(true);
  });

  it('rejects bad arguments', () => {
    for (const argv of [[], ['nope'], ['crm', 'bahikhata'], ['crm', '--wat'], ['crm', '--mode', 'demo']]) {
      expect(() => parseSourceAddArgs(argv)).toThrow(SourceAddError);
    }
  });
});

describe('connection string validation', () => {
  it('matches the engine and requires credentials', () => {
    expect(validateConnectionUri('mongodb', URI)).toBe(URI);
    expect(validateConnectionUri('postgres', 'postgresql://ai_ro:pw@127.0.0.1:5432/samadhan')).toContain('ai_ro');
    expect(() => validateConnectionUri('postgres', URI)).toThrow(/engine/);
    expect(() => validateConnectionUri('mongodb', 'mongodb://127.0.0.1:27017/crm')).toThrow(/user and password/);
    expect(() => validateConnectionUri('mongodb', '   ')).toThrow(/empty/);
    expect(() => validateConnectionUri('mongodb', 'mongodb://a b')).toThrow(SourceAddError);
  });
});

describe('source add', () => {
  it('encrypts the secret, creates the source and never prints it', async () => {
    const { clock, collection, store, credentials, written, output } = setup();
    const result = await runSourceAdd({ argv: ['crm'], env: { MODE: 'practice' }, clock, store, credentials, secretReader: async () => URI, output });
    expect(result).toEqual({ sourceId: 'crm', ref: 'store:crm', created: true });
    const doc = await store.get('crm');
    expect(doc).toMatchObject({ credentialRef: 'store:crm', state: 'not_configured', mode: 'practice', engine: 'mongodb' });
    const sealed = JSON.stringify(collection.docs.get('crm'));
    expect(sealed).not.toContain('s3cr3t');
    expect(sealed).not.toContain('ai_ro');
    expect(await credentials.get('crm')).toBe(URI);
    expect(written.join('')).not.toContain('s3cr3t');
    expect(written.join('')).toContain('store:crm');
  });

  it('rotates the credential of an existing source and keeps its state', async () => {
    const { clock, collection, store, credentials, output } = setup();
    await runSourceAdd({ argv: ['crm'], env: { MODE: 'practice' }, clock, store, credentials, secretReader: async () => URI, output });
    await store.update('crm', { state: 'active' });
    clock.advance(1000);
    const result = await runSourceAdd({
      argv: ['crm'],
      env: { MODE: 'practice' },
      clock,
      store,
      credentials,
      secretReader: async () => 'mongodb://ai_ro:other@127.0.0.1:27017/crm',
      output
    });
    expect(result.created).toBe(false);
    expect((await store.get('crm')).state).toBe('active');
    expect(collection.docs.get('crm').rotatedAt).not.toBeNull();
    expect(await credentials.get('crm')).toContain('other');
  });

  it('does not store anything when validation fails', async () => {
    const { clock, collection, store, credentials, output } = setup();
    await expect(
      runSourceAdd({ argv: ['crm'], env: { MODE: 'practice' }, clock, store, credentials, secretReader: async () => 'garbage', output })
    ).rejects.toThrow(SourceAddError);
    expect(collection.docs.size).toBe(0);
    expect(await store.get('crm')).toBeNull();
  });

  it('removes a stored credential and falls back to the env reference', async () => {
    const { clock, collection, store, credentials, output } = setup();
    await runSourceAdd({ argv: ['crm'], env: { MODE: 'practice' }, clock, store, credentials, secretReader: async () => URI, output });
    await runSourceAdd({ argv: ['crm', '--remove'], env: { MODE: 'practice' }, clock, store, credentials, secretReader: async () => '', output });
    expect(collection.docs.size).toBe(0);
    expect((await store.get('crm')).credentialRef).toBe('env:SRC_CRM_URI');
  });

  it('uses the postgres engine for samadhan', async () => {
    const { clock, store, credentials, output } = setup();
    await runSourceAdd({
      argv: ['samadhan'],
      env: { MODE: 'practice' },
      clock,
      store,
      credentials,
      secretReader: async () => 'postgresql://ai_ro:pw@127.0.0.1:5432/samadhan',
      output
    });
    expect((await store.get('samadhan')).engine).toBe('postgres');
  });
});

describe('hidden prompt', () => {
  function tty() {
    const input = new EventEmitter();
    input.isTTY = true;
    input.raw = [];
    input.setRawMode = (value) => input.raw.push(value);
    input.resume = () => {};
    input.pause = () => {};
    input.setEncoding = () => {};
    return input;
  }

  it('reads without echo and handles backspace', async () => {
    const input = tty();
    const written = [];
    const pending = readSecret({ input, output: { write: (text) => written.push(text) }, prompt: 'Secret: ' });
    input.emit('data', 'abcx\u007f');
    input.emit('data', 'd\r');
    expect(await pending).toBe('abcd');
    expect(written).toEqual(['Secret: ', '\n']);
    expect(input.raw).toEqual([true, false]);
  });

  it('cancels on Ctrl-C', async () => {
    const input = tty();
    const pending = readSecret({ input, output: { write: () => {} } });
    input.emit('data', 'ab\u0003');
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('reads piped input when not a terminal', async () => {
    const input = new EventEmitter();
    input.isTTY = false;
    const pending = readSecret({ input });
    input.emit('data', 'mongodb://u:p@h/db\n');
    input.emit('end');
    expect(await pending).toBe('mongodb://u:p@h/db');
  });
});
