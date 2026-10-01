import { generateAppKey, generateSigningSecret, hashAppKey } from '@fab5/shared/appKeys';
import { AuthError } from '../errors.js';

export const DEFAULT_RATE_LIMIT = Object.freeze({ perUserPerMin: 60, perAppPerMin: 600 });

export function createClientStore(collection) {
  return {
    async findByKeyHash(keyHash) {
      return collection.findOne({ keyHash });
    },
    async get(id) {
      return collection.findOne({ _id: id });
    },
    async list() {
      return collection.find({}).toArray();
    },
    async insert(doc) {
      await collection.insertOne(doc);
      return doc;
    },
    async update(id, patch) {
      await collection.updateOne({ _id: id }, { $set: patch });
    },
    async touch(id, at) {
      await collection.updateOne({ _id: id }, { $set: { lastUsedAt: at } });
    }
  };
}

export const secretAad = (id) => `ai_clients:${id}:secret`;

export function createClientAdmin({ store, cipher, clock }) {
  async function create({ id, name, allowedIps = [], rateLimit = {} }) {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) throw new TypeError('Invalid client id');
    if (await store.get(id)) throw new AuthError(409, 'client_exists', `Client ${id} exists`);
    const appKey = generateAppKey();
    const signingSecret = generateSigningSecret();
    const now = clock.now();
    const client = {
      _id: id,
      name,
      keyHash: hashAppKey(appKey),
      secretEnc: cipher.encrypt(signingSecret, secretAad(id)),
      enabled: true,
      allowedIps,
      rateLimit: { ...DEFAULT_RATE_LIMIT, ...rateLimit },
      createdAt: now,
      rotatedAt: null,
      lastUsedAt: null
    };
    await store.insert(client);
    return { client, appKey, signingSecret };
  }

  async function rotate(id) {
    const existing = await store.get(id);
    if (!existing) throw new AuthError(404, 'client_not_found', `Client ${id} not found`);
    const appKey = generateAppKey();
    const signingSecret = generateSigningSecret();
    await store.update(id, {
      keyHash: hashAppKey(appKey),
      secretEnc: cipher.encrypt(signingSecret, secretAad(id)),
      rotatedAt: clock.now()
    });
    return { appKey, signingSecret };
  }

  async function setEnabled(id, enabled) {
    const existing = await store.get(id);
    if (!existing) throw new AuthError(404, 'client_not_found', `Client ${id} not found`);
    await store.update(id, { enabled: Boolean(enabled) });
  }

  return { create, rotate, setEnabled };
}
