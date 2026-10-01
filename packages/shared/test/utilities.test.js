import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCipher, CipherError } from '../src/cipher.js';
import { redactSecrets, safeMessage } from '../src/redact.js';
import {
  generateAppKey,
  hashAppKey,
  signRequest,
  verifyAppKey,
  verifySignature
} from '../src/appKeys.js';
import { hashPassword, isPasswordHash, verifyPassword } from '../src/password.js';
import { createActivityEmitter, createAlerts, createAudit } from '../src/activity.js';

const key = () => randomBytes(32).toString('base64');

describe('redactSecrets', () => {
  it('removes connection strings, bearer tokens and password assignments', () => {
    const text =
      'connect mongodb://ai_ro:Sup3r@host:27017/crm failed; Bearer abc.def.ghi; password=hunter2; pg postgres://u:p@h/db';
    const out = redactSecrets(text);
    expect(out).not.toContain('Sup3r');
    expect(out).not.toContain('abc.def.ghi');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('u:p@h');
  });

  it('truncates after redaction', () => {
    expect(safeMessage(new Error(`mongodb://a:b@c ${'x'.repeat(500)}`), 50)).toHaveLength(50);
  });
});

describe('cipher', () => {
  it('round trips with aad binding', () => {
    const cipher = createCipher({ keys: { k1: key() }, activeKeyId: 'k1' });
    const sealed = cipher.encrypt('mongodb://secret', 'source:crm');
    expect(sealed.enc.ciphertext).not.toContain('secret');
    expect(cipher.decrypt(sealed, 'source:crm')).toBe('mongodb://secret');
    expect(() => cipher.decrypt(sealed, 'source:other')).toThrow(CipherError);
  });

  it('supports key rotation via keyring and rejects short keys', () => {
    const oldKey = key();
    const oldCipher = createCipher({ keys: { k1: oldKey }, activeKeyId: 'k1' });
    const sealed = oldCipher.encrypt('value', 'a');
    const next = createCipher({ keys: { k1: oldKey, k2: key() }, activeKeyId: 'k2' });
    expect(next.decrypt(sealed, 'a')).toBe('value');
    expect(next.encrypt('value', 'a').keyId).toBe('k2');
    expect(() => createCipher({ keys: { k1: 'AAAA' }, activeKeyId: 'k1' })).toThrow(CipherError);
  });

  it('detects tampering', () => {
    const cipher = createCipher({ keys: { k1: key() }, activeKeyId: 'k1' });
    const sealed = cipher.encrypt('value', 'a');
    sealed.enc.tag = Buffer.alloc(16).toString('base64');
    expect(() => cipher.decrypt(sealed, 'a')).toThrow(CipherError);
  });
});

describe('app keys and signing', () => {
  it('hashes and verifies keys', () => {
    const appKey = generateAppKey();
    expect(verifyAppKey(appKey, hashAppKey(appKey))).toBe(true);
    expect(verifyAppKey('nope', hashAppKey(appKey))).toBe(false);
  });

  it('signs and verifies requests', () => {
    const args = { secret: 's3', timestamp: '1700000000', method: 'post', path: '/a?b=1', body: Buffer.from('{}') };
    const signature = signRequest(args);
    expect(verifySignature({ ...args, signature })).toBe(true);
    expect(verifySignature({ ...args, signature, body: Buffer.from('{"x":1}') })).toBe(false);
    expect(verifySignature({ ...args, signature, path: '/a?b=2' })).toBe(false);
    expect(verifySignature({ ...args, signature: 'short' })).toBe(false);
  });
});

describe('password hashing', () => {
  it('verifies scrypt hashes', async () => {
    const hash = await hashPassword('correct horse');
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'plain')).toBe(false);
  });
});

function memoryStore() {
  const rows = [];
  return {
    rows,
    async insert(doc) {
      rows.push({ _id: rows.length + 1, ...doc });
      return rows.length;
    },
    async increment(id, amount) {
      rows.find((row) => row._id === id).count += amount;
    },
    async findOpen(ruleId, dedupeKey) {
      return rows.find((row) => row.ruleId === ruleId && row.context?.dedupeKey === dedupeKey);
    }
  };
}

describe('activity emitter', () => {
  const clock = { now: () => new Date('2026-09-01T10:00:10Z') };

  it('stores sanitized events', async () => {
    const store = memoryStore();
    const { emit } = createActivityEmitter({ store, clock });
    await emit({ kind: 'verify', sourceId: 'crm', message: 'mongodb://u:p@h failed', durationMs: 12.6 });
    expect(store.rows[0]).toMatchObject({ kind: 'verify', level: 'info', ok: true, durationMs: 13 });
    expect(store.rows[0].message).not.toContain('u:p@h');
    await expect(emit({ kind: 'bogus' })).rejects.toThrow(TypeError);
  });

  it('collapses blocked events per source per minute', async () => {
    const store = memoryStore();
    const { emit } = createActivityEmitter({ store, clock });
    await Promise.all([1, 2, 3].map(() => emit({ kind: 'blocked', sourceId: 'crm' })));
    await emit({ kind: 'blocked', sourceId: 'bahikhata' });
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0].count).toBe(3);
  });

  it('never rejects on store failure', async () => {
    const { emit } = createActivityEmitter({
      store: {
        insert: async () => {
          throw new Error('down');
        }
      },
      clock
    });
    await expect(emit({ kind: 'toggle' })).resolves.toBeNull();
  });
});

describe('audit and alerts', () => {
  const clock = { now: () => new Date('2026-09-01T00:00:00Z') };

  it('requires a reason for source actions', async () => {
    const store = memoryStore();
    const audit = createAudit({ store, clock });
    await expect(audit.record({ action: 'source.pause', actorEmployeeId: 'emp_1' })).rejects.toThrow(
      'reason'
    );
    await audit.record({ action: 'source.pause', actorEmployeeId: 'emp_1', reason: ' maintenance ' });
    expect(store.rows[0].reason).toBe('maintenance');
  });

  it('dedupes open alerts', async () => {
    const store = memoryStore();
    const alerts = createAlerts({ store, clock, activity: { emit: async () => {} } });
    await alerts.raise({ ruleId: 'readonly_check_failed', message: 'x', context: { sourceId: 'crm' } });
    await alerts.raise({ ruleId: 'readonly_check_failed', message: 'x', context: { sourceId: 'crm' } });
    expect(store.rows).toHaveLength(1);
  });
});
