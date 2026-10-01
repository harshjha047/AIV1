import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCipher } from '@fab5/shared/cipher';
import {
  createCredentialResolver,
  createCredentialStore,
  parseCredentialRef
} from '../src/credentials/store.js';
import { CredentialUnavailableError } from '../src/errors.js';
import { nextRunAt, parseDailyCron, startVerifyScheduler } from '../src/verify/schedule.js';
import { createFakeClock } from './helpers.js';

function fakeCollection() {
  const docs = new Map();
  return {
    docs,
    findOne: async ({ _id }) => docs.get(_id) ?? null,
    replaceOne: async ({ _id }, doc) => docs.set(_id, structuredClone(doc)),
    deleteOne: async ({ _id }) => docs.delete(_id),
    find: () => ({ toArray: async () => [...docs.values()].map((doc) => structuredClone(doc)) })
  };
}

const key = () => randomBytes(32).toString('base64');

describe('credentialRef', () => {
  it('parses env and store references', () => {
    expect(parseCredentialRef('env:SRC_CRM_URI')).toEqual({ type: 'env', name: 'SRC_CRM_URI' });
    expect(parseCredentialRef('store:crm')).toEqual({ type: 'store', id: 'crm' });
  });

  it.each(['mongodb://u:p@h/db', 'file:/etc/passwd', '', null])('rejects %s', (ref) => {
    expect(() => parseCredentialRef(ref)).toThrow(TypeError);
  });
});

describe('encrypted credential store', () => {
  const clock = createFakeClock();

  it('stores ciphertext only and decrypts on demand', async () => {
    const collection = fakeCollection();
    const store = createCredentialStore({
      collection,
      cipher: createCipher({ keys: { k1: key() }, activeKeyId: 'k1' }),
      clock
    });
    await store.put('crm', 'mongodb://ai_ro:pw@h/crm', { createdBy: 'cli' });
    const raw = JSON.stringify(collection.docs.get('crm'));
    expect(raw).not.toContain('pw@h');
    expect(raw).not.toContain('mongodb://');
    expect(collection.docs.get('crm')).toMatchObject({ keyId: 'k1', createdBy: 'cli', rotatedAt: null });
    expect(await store.get('crm')).toBe('mongodb://ai_ro:pw@h/crm');
    expect(await store.has('crm')).toBe(true);
  });

  it('binds ciphertext to the source id', async () => {
    const collection = fakeCollection();
    const store = createCredentialStore({
      collection,
      cipher: createCipher({ keys: { k1: key() }, activeKeyId: 'k1' }),
      clock
    });
    await store.put('crm', 'secret');
    collection.docs.set('bahikhata', { ...collection.docs.get('crm'), _id: 'bahikhata' });
    await expect(store.get('bahikhata')).rejects.toThrow('Decryption failed');
  });

  it('marks rotation and re-encrypts under a new master key', async () => {
    const collection = fakeCollection();
    const oldKey = key();
    const old = createCredentialStore({
      collection,
      cipher: createCipher({ keys: { k1: oldKey }, activeKeyId: 'k1' }),
      clock
    });
    await old.put('crm', 'v1');
    await old.put('crm', 'v2');
    expect(collection.docs.get('crm').rotatedAt).toBeInstanceOf(Date);
    const next = createCredentialStore({
      collection,
      cipher: createCipher({ keys: { k1: oldKey, k2: key() }, activeKeyId: 'k2' }),
      clock
    });
    expect(await next.reencryptAll()).toBe(1);
    expect(collection.docs.get('crm').keyId).toBe('k2');
    expect(await next.get('crm')).toBe('v2');
    expect(await next.reencryptAll()).toBe(0);
  });

  it('throws when nothing is stored', async () => {
    const store = createCredentialStore({
      collection: fakeCollection(),
      cipher: createCipher({ keys: { k1: key() }, activeKeyId: 'k1' }),
      clock
    });
    await expect(store.get('crm')).rejects.toThrow(CredentialUnavailableError);
  });
});

describe('credential resolver', () => {
  it('reads env refs and reports missing variables without values', async () => {
    const resolver = createCredentialResolver({ env: { SRC_CRM_URI: 'mongodb://x' } });
    expect(await resolver.resolve({ _id: 'crm', credentialRef: 'env:SRC_CRM_URI' })).toBe('mongodb://x');
    await expect(resolver.resolve({ _id: 'crm', credentialRef: 'env:MISSING' })).rejects.toThrow(
      'MISSING'
    );
  });

  it('reads store refs', async () => {
    const resolver = createCredentialResolver({ env: {}, store: { get: async () => 'from-store' } });
    expect(await resolver.resolve({ _id: 'crm', credentialRef: 'store:crm' })).toBe('from-store');
    const none = createCredentialResolver({ env: {} });
    await expect(none.resolve({ _id: 'crm', credentialRef: 'store:crm' })).rejects.toThrow(
      CredentialUnavailableError
    );
  });
});

describe('verification schedule', () => {
  it('parses daily cron only', () => {
    expect(parseDailyCron('30 3 * * *')).toEqual({ minute: 30, hour: 3 });
    expect(() => parseDailyCron('*/5 * * * *')).toThrow(TypeError);
    expect(() => parseDailyCron('61 3 * * *')).toThrow(TypeError);
  });

  it('computes the next 03:30 IST run', () => {
    expect(nextRunAt('30 3 * * *', 'Asia/Kolkata', new Date('2026-09-01T00:00:00Z')).toISOString()).toBe(
      '2026-09-01T22:00:00.000Z'
    );
    expect(nextRunAt('30 3 * * *', 'Asia/Kolkata', new Date('2026-08-31T22:00:00Z')).toISOString()).toBe(
      '2026-09-01T22:00:00.000Z'
    );
  });

  it('runs verification for configured sources and reschedules', async () => {
    const clock = createFakeClock('2026-08-31T21:00:00Z');
    const timers = [];
    const verified = [];
    const stop = startVerifyScheduler({
      clock,
      listSources: async () => [
        { _id: 'crm', state: 'active' },
        { _id: 'invoicing', state: 'not_configured' },
        { _id: 'bahikhata', state: 'paused' }
      ],
      verify: async (id) => {
        verified.push(id);
        if (id === 'crm') throw new Error('boom');
      },
      setTimer: (fn, delay) => {
        const timer = { fn, delay, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimer: () => {}
    });
    expect(timers[0].delay).toBe(60 * 60 * 1000);
    await timers[0].fn();
    expect(verified).toEqual(['crm', 'bahikhata']);
    expect(timers).toHaveLength(2);
    stop();
  });
});
