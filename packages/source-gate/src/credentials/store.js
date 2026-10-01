import { CredentialUnavailableError } from '../errors.js';

const aadFor = (sourceId) => `fab5:source:${sourceId}`;

export function parseCredentialRef(ref) {
  const match = /^(env|store):([A-Za-z0-9_.-]+)$/.exec(String(ref ?? ''));
  if (!match) throw new TypeError('credentialRef must be env:<NAME> or store:<id>');
  return match[1] === 'env' ? { type: 'env', name: match[2] } : { type: 'store', id: match[2] };
}

export function createCredentialStore({ collection, cipher, clock }) {
  async function put(sourceId, secret, { createdBy } = {}) {
    if (typeof secret !== 'string' || secret.length === 0) throw new TypeError('Empty secret');
    const existing = await collection.findOne({ _id: sourceId });
    const sealed = cipher.encrypt(secret, aadFor(sourceId));
    const now = clock.now();
    await collection.replaceOne(
      { _id: sourceId },
      {
        _id: sourceId,
        ...sealed,
        createdAt: existing?.createdAt ?? now,
        rotatedAt: existing ? now : null,
        createdBy: existing?.createdBy ?? createdBy ?? null
      },
      { upsert: true }
    );
  }

  async function get(sourceId) {
    const doc = await collection.findOne({ _id: sourceId });
    if (!doc) throw new CredentialUnavailableError(sourceId, 'not stored');
    return cipher.decrypt(doc, aadFor(sourceId));
  }

  async function has(sourceId) {
    return (await collection.findOne({ _id: sourceId }, { projection: { _id: 1 } })) !== null;
  }

  async function remove(sourceId) {
    await collection.deleteOne({ _id: sourceId });
  }

  async function reencryptAll() {
    const docs = await collection.find({}).toArray();
    let rotated = 0;
    for (const doc of docs) {
      if (doc.keyId === cipher.activeKeyId) continue;
      const secret = cipher.decrypt(doc, aadFor(doc._id));
      await put(doc._id, secret, { createdBy: doc.createdBy });
      rotated += 1;
    }
    return rotated;
  }

  return { put, get, has, remove, reencryptAll };
}

export function createCredentialResolver({ env = process.env, store }) {
  async function resolve(source) {
    const ref = parseCredentialRef(source.credentialRef);
    if (ref.type === 'env') {
      const value = env[ref.name];
      if (!value) throw new CredentialUnavailableError(source._id, `environment variable ${ref.name} is not set`);
      return value;
    }
    if (!store) throw new CredentialUnavailableError(source._id, 'no credential store configured');
    return store.get(ref.id);
  }
  return { resolve };
}
