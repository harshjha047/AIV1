import { CredentialUnavailableError } from './errors.js';

export function createVault({ resolver }) {
  const entries = new Map();
  const pending = new Map();
  const epochs = new Map();

  const epochOf = (id) => epochs.get(id) ?? 0;

  async function get(source) {
    const existing = entries.get(source._id);
    if (existing) return existing.toString('utf8');
    let promise = pending.get(source._id);
    if (!promise) {
      const startEpoch = epochOf(source._id);
      promise = (async () => {
        const secret = await resolver.resolve(source);
        const buffer = Buffer.from(secret, 'utf8');
        if (epochOf(source._id) !== startEpoch) {
          buffer.fill(0);
          throw new CredentialUnavailableError(source._id, 'wiped during resolution');
        }
        entries.set(source._id, buffer);
        return buffer;
      })().finally(() => pending.delete(source._id));
      pending.set(source._id, promise);
    }
    const buffer = await promise;
    return buffer.toString('utf8');
  }

  async function resolveOnce(source) {
    return resolver.resolve(source);
  }

  function wipe(sourceId) {
    epochs.set(sourceId, epochOf(sourceId) + 1);
    const buffer = entries.get(sourceId);
    if (buffer) buffer.fill(0);
    entries.delete(sourceId);
  }

  function holds(sourceId) {
    return entries.has(sourceId);
  }

  return { get, resolveOnce, wipe, holds };
}
