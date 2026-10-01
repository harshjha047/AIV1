import { isPasswordHash, verifyPassword } from '@fab5/shared/password';
import { modeFromEnv } from '@fab5/shared/mode';

export const LOCAL_ADMIN_ID = 'emp_local_admin';
export const HUB_CLIENT_ID = 'hub';

export class SeedError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SeedError';
    this.code = code;
  }
}

export async function seedHubClient({ admin, store }) {
  if (await store.get(HUB_CLIENT_ID)) return { created: false };
  const result = await admin.create({ id: HUB_CLIENT_ID, name: 'Hub', allowedIps: ['127.0.0.1', '::1'] });
  return { created: true, appKey: result.appKey, signingSecret: result.signingSecret };
}

function localAdminConfig(env) {
  if (modeFromEnv(env) === 'production') {
    throw new SeedError('Local admin is not available when MODE=production', 'LOCAL_ADMIN_PRODUCTION');
  }
  const email = String(env.LOCAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SeedError('LOCAL_ADMIN_EMAIL is required', 'LOCAL_ADMIN_EMAIL');
  const hash = env.LOCAL_ADMIN_PASSWORD_HASH;
  if (!isPasswordHash(hash)) throw new SeedError('LOCAL_ADMIN_PASSWORD_HASH must be an scrypt hash', 'LOCAL_ADMIN_HASH');
  return { email, hash };
}

export async function seedLocalAdmin({ employees, env = process.env, clock }) {
  const { email } = localAdminConfig(env);
  const now = clock.now();
  return employees.upsertSeed({
    _id: LOCAL_ADMIN_ID,
    email,
    name: 'Local Admin',
    aliases: [],
    active: true,
    aiRole: 'owner',
    managerId: null,
    sources: {},
    sourceRoles: {},
    mappingStatus: 'complete',
    localSeed: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'system'
  });
}

export function createLocalLogin({ env = process.env } = {}) {
  const { email, hash } = localAdminConfig(env);
  return async function login({ email: presentedEmail, password }) {
    const emailMatches = String(presentedEmail ?? '').trim().toLowerCase() === email;
    const passwordMatches = await verifyPassword(String(password ?? ''), hash);
    return emailMatches && passwordMatches;
  };
}
