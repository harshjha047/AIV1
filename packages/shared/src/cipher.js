import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export class CipherError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CipherError';
    this.code = code;
  }
}

export function decodeMasterKey(base64) {
  const key = Buffer.from(String(base64 ?? ''), 'base64');
  if (key.length !== 32) throw new CipherError('Master key must decode to 32 bytes', 'BAD_KEY');
  return key;
}

export function createCipher({ keys, activeKeyId }) {
  const ring = new Map(Object.entries(keys).map(([id, value]) => [id, decodeMasterKey(value)]));
  if (!ring.has(activeKeyId)) throw new CipherError(`Unknown active key ${activeKeyId}`, 'NO_KEY');

  function encrypt(plaintext, aad) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, ring.get(activeKeyId), iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    return {
      keyId: activeKeyId,
      enc: {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64')
      }
    };
  }

  function decrypt({ keyId, enc }, aad) {
    const key = ring.get(keyId);
    if (!key) throw new CipherError(`Unknown key ${keyId}`, 'NO_KEY');
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(enc.iv, 'base64'));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(enc.ciphertext, 'base64')),
        decipher.final()
      ]).toString('utf8');
    } catch {
      throw new CipherError('Decryption failed', 'DECRYPT_FAILED');
    }
  }

  return { encrypt, decrypt, activeKeyId };
}

export function cipherFromEnv(env = process.env, { keyVar = 'SOURCE_CRED_MASTER_KEY' } = {}) {
  const activeKeyId = env[`${keyVar}_ID`] ?? 'k1';
  const keys = { [activeKeyId]: env[keyVar] };
  if (env[`${keyVar}_OLD`]) Object.assign(keys, JSON.parse(env[`${keyVar}_OLD`]));
  return createCipher({ keys, activeKeyId });
}
