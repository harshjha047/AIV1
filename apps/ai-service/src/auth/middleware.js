import { hashAppKey, sha256Hex, verifyAppKey, verifySignature } from '@fab5/shared/appKeys';
import { AuthError } from '../errors.js';
import { isRole } from '../roles.js';
import { DEFAULT_RATE_LIMIT, secretAad } from './clientStore.js';
import { ipAllowed } from './ipAllow.js';

export const MAX_SKEW_MS = 5 * 60 * 1000;
export const REPLAY_TTL_SECONDS = 600;
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,128}\.[^\s@]{1,64}$/;

export function createAuth({
  clients,
  employees,
  replay,
  limiter,
  cipher,
  clock,
  requireSignature = true,
  logger
}) {
  async function identifyApp(req, _res, next) {
    const key = req.get('x-ai-app-key');
    if (!key) throw new AuthError(401, 'app_key_required', 'App key required');
    const client = await clients.findByKeyHash(hashAppKey(key));
    if (!client || !verifyAppKey(key, client.keyHash)) throw new AuthError(401, 'invalid_app_key', 'Invalid app key');
    if (!client.enabled) throw new AuthError(403, 'app_disabled', 'App disabled');
    if (!ipAllowed(client.allowedIps, req.ip)) throw new AuthError(403, 'ip_not_allowed', 'Address not allowed');
    req.client = client;
    next();
  }

  function guardBody(req, _res, next) {
    const length = Number(req.get('content-length') ?? 0);
    const hasBody = length > 0 || req.get('transfer-encoding') !== undefined;
    if (hasBody && !req.is('application/json')) throw new AuthError(415, 'unsupported_media_type', 'JSON required');
    next();
  }

  function captureRaw(req, _res, buffer) {
    req.rawBody = buffer;
  }

  async function verifySigned(req, _res, next) {
    req.rawBody ??= Buffer.alloc(0);
    const signature = req.get('x-ai-signature');
    const timestamp = req.get('x-ai-timestamp');
    if (!signature && !timestamp) {
      if (requireSignature) throw new AuthError(401, 'signature_required', 'Signature required');
      req.signed = false;
      return next();
    }
    if (!signature || !timestamp) throw new AuthError(401, 'signature_invalid', 'Invalid signature');
    if (!/^\d{10,16}$/.test(timestamp)) throw new AuthError(401, 'timestamp_invalid', 'Invalid timestamp');
    if (Math.abs(clock.now().getTime() - Number(timestamp)) > MAX_SKEW_MS) {
      throw new AuthError(401, 'timestamp_expired', 'Timestamp outside the allowed window');
    }
    if (!req.client.secretEnc) throw new AuthError(401, 'signature_invalid', 'Invalid signature');
    let secret;
    try {
      secret = cipher.decrypt(req.client.secretEnc, secretAad(req.client._id));
    } catch (error) {
      logger?.error?.({ clientId: req.client._id, code: error.code }, 'client secret unreadable');
      throw new AuthError(500, 'auth_misconfigured', 'Authentication unavailable');
    }
    const valid = verifySignature({
      secret,
      signature,
      timestamp,
      method: req.method,
      path: req.originalUrl,
      body: req.rawBody
    });
    if (!valid) throw new AuthError(401, 'signature_invalid', 'Invalid signature');
    let fresh;
    try {
      fresh = await replay.claim(`${req.client._id}:${sha256Hex(signature)}`, REPLAY_TTL_SECONDS);
    } catch (error) {
      logger?.error?.({ err: error.message }, 'replay cache unavailable');
      throw new AuthError(503, 'replay_cache_unavailable', 'Authentication unavailable');
    }
    if (!fresh) throw new AuthError(401, 'replay_detected', 'Request already used');
    req.signed = true;
    next();
  }

  async function resolveActor(req, _res, next) {
    const raw = req.get('x-act-as-email');
    if (!raw) throw new AuthError(401, 'actor_required', 'Acting user required');
    const email = raw.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new AuthError(403, 'unknown_user', 'Unknown user');
    const employee = await employees.findByEmail(email);
    const mapped =
      employee &&
      (employee.localSeed === true ||
        (employee.sources && Object.values(employee.sources).some((value) => Boolean(value))));
    if (!employee || employee.active !== true || !mapped || !isRole(employee.aiRole)) {
      logger?.info?.({ clientId: req.client._id, reason: !employee ? 'missing' : 'ineligible' }, 'actor rejected');
      throw new AuthError(403, 'unknown_user', 'Unknown user');
    }
    req.actor = {
      employeeId: employee._id,
      email: employee.email,
      name: employee.name,
      role: employee.aiRole,
      managerId: employee.managerId ?? null,
      clientId: req.client._id
    };
    next();
  }

  async function throttle(req, res, next) {
    const limits = { ...DEFAULT_RATE_LIMIT, ...(req.client.rateLimit ?? {}) };
    const app = await limiter.hit(`app:${req.client._id}`, limits.perAppPerMin);
    const user = await limiter.hit(`user:${req.client._id}:${req.actor.employeeId}`, limits.perUserPerMin);
    if (!app.allowed || !user.allowed) {
      const retry = Math.max(1, Math.ceil(Math.max(app.resetMs, user.resetMs) / 1000));
      throw new AuthError(429, 'rate_limited', 'Rate limit exceeded', { 'Retry-After': String(retry) });
    }
    res.set('X-RateLimit-Remaining', String(Math.min(app.remaining, user.remaining)));
    Promise.resolve(clients.touch?.(req.client._id, clock.now())).catch(() => {});
    next();
  }

  return { identifyApp, guardBody, captureRaw, verifySigned, resolveActor, throttle };
}

export function createRouteLimiter({ limiter, name, limit }) {
  return async (req, res, next) => {
    const result = await limiter.hit(`route:${name}:${req.actor.employeeId}`, limit);
    if (!result.allowed) {
      throw new AuthError(429, 'rate_limited', 'Rate limit exceeded', {
        'Retry-After': String(Math.max(1, Math.ceil(result.resetMs / 1000)))
      });
    }
    next();
  };
}
