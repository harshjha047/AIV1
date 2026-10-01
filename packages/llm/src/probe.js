import { createRealClock } from '@fab5/shared/clock';

const MB = 1024 * 1024;

const normalizeName = (name) => (String(name).includes(':') ? String(name) : `${name}:latest`);

export function createOllamaProbe({ client, clock = createRealClock() }) {
  async function ps(options) {
    const body = await client.getJson('/api/ps', options);
    return (body.models ?? []).map((entry) => ({
      name: entry.name ?? entry.model,
      sizeMb: Math.round((entry.size ?? 0) / MB),
      vramMb: Math.round((entry.size_vram ?? 0) / MB),
      expiresAt: entry.expires_at ?? null,
      contextLength: entry.context_length ?? null
    }));
  }

  async function tags(options) {
    const body = await client.getJson('/api/tags', options);
    return (body.models ?? []).map((entry) => ({
      name: entry.name ?? entry.model,
      sizeMb: Math.round((entry.size ?? 0) / MB),
      modifiedAt: entry.modified_at ?? null,
      parameterSize: entry.details?.parameter_size ?? null,
      quantization: entry.details?.quantization_level ?? null
    }));
  }

  async function health(options = {}) {
    const started = clock.monotonic();
    try {
      const models = await tags({ timeoutMs: 3000, ...options });
      const elapsed = (clock.monotonic()) - started;
      return { ok: true, ms: Math.round(elapsed), models: models.length };
    } catch (error) {
      const elapsed = (clock.monotonic()) - started;
      return { ok: false, ms: Math.round(elapsed), errorClass: error.errorClass ?? 'unavailable' };
    }
  }

  async function missingModels(required, options) {
    const installed = new Set((await tags(options)).map((entry) => normalizeName(entry.name)));
    return required.filter((name) => !installed.has(normalizeName(name)));
  }

  return { ps, tags, health, missingModels };
}
