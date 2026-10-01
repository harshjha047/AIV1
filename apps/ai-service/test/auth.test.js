import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { signRequest } from '@fab5/shared/appKeys';
import { createCipher } from '@fab5/shared/cipher';
import { hashPassword } from '@fab5/shared/password';
import { createClientAdmin, secretAad } from '../src/auth/clientStore.js';
import { ipAllowed, normalizeIp } from '../src/auth/ipAllow.js';
import { createRedisRateLimiter } from '../src/auth/rateLimiter.js';
import { createRedisReplayCache } from '../src/auth/replayCache.js';
import { createLocalLogin, seedHubClient, seedLocalAdmin } from '../src/auth/seed.js';
import { createClock, createHarness } from './helpers.js';

const code = (response) => response.body.error?.code;

describe('app key', () => {
  it('serves health without credentials', async () => {
    const h = await createHarness();
    const response = await request(h.app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects a missing key', async () => {
    const h = await createHarness();
    const response = await request(h.app).get('/internal/v1/me').set('x-act-as-email', 'asha@fab5.in');
    expect([response.status, code(response)]).toEqual([401, 'app_key_required']);
  });

  it('rejects a wrong key and a near-miss key', async () => {
    const h = await createHarness();
    const wrong = await h.get('/internal/v1/me', { key: 'fab5ai_nope' });
    expect([wrong.status, code(wrong)]).toEqual([401, 'invalid_app_key']);
    const near = await h.get('/internal/v1/me', { key: `${h.created.appKey}x` });
    expect([near.status, code(near)]).toEqual([401, 'invalid_app_key']);
  });

  it('rejects a disabled app', async () => {
    const h = await createHarness();
    await h.admin.setEnabled('crm', false);
    const response = await h.get('/internal/v1/me');
    expect([response.status, code(response)]).toEqual([403, 'app_disabled']);
    await h.admin.setEnabled('crm', true);
    expect((await h.get('/internal/v1/me')).status).toBe(200);
  });

  it('enforces the address allow-list', async () => {
    const blocked = await createHarness({ clientOptions: { allowedIps: ['10.0.0.0/8'] } });
    const response = await blocked.get('/internal/v1/me');
    expect([response.status, code(response)]).toEqual([403, 'ip_not_allowed']);
    const exact = await createHarness({ clientOptions: { allowedIps: ['127.0.0.1'] } });
    expect((await exact.get('/internal/v1/me')).status).toBe(200);
    const cidr = await createHarness({ clientOptions: { allowedIps: ['127.0.0.0/8'] } });
    expect((await cidr.get('/internal/v1/me')).status).toBe(200);
  });

  it('invalidates the old key after rotation', async () => {
    const h = await createHarness();
    const rotated = await h.admin.rotate('crm');
    const old = await h.get('/internal/v1/me');
    expect(code(old)).toBe('invalid_app_key');
    const fresh = await h.get('/internal/v1/me', { key: rotated.appKey, secret: rotated.signingSecret });
    expect(fresh.status).toBe(200);
    const oldSecret = await h.get('/internal/v1/me', { key: rotated.appKey, secret: h.created.signingSecret });
    expect(code(oldSecret)).toBe('signature_invalid');
  });

  it('never stores the key or secret in plaintext', async () => {
    const h = await createHarness();
    const stored = JSON.stringify([...h.clientsCollection.docs.values()]);
    expect(stored).not.toContain(h.created.appKey);
    expect(stored).not.toContain(h.created.signingSecret);
    expect(h.created.client.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses duplicate client ids', async () => {
    const h = await createHarness();
    await expect(h.admin.create({ id: 'crm', name: 'again' })).rejects.toMatchObject({ code: 'client_exists' });
    await expect(h.admin.create({ id: 'Bad Id', name: 'x' })).rejects.toThrow(TypeError);
  });
});

describe('request signing', () => {
  it('requires a signature when configured', async () => {
    const h = await createHarness();
    const response = await h.get('/internal/v1/me', { sign: false });
    expect([response.status, code(response)]).toEqual([401, 'signature_required']);
  });

  it('allows unsigned calls when signing is not required', async () => {
    const h = await createHarness({ requireSignature: false });
    const response = await h.get('/internal/v1/me', { sign: false });
    expect(response.status).toBe(200);
  });

  it('still rejects an invalid signature when signing is optional', async () => {
    const h = await createHarness({ requireSignature: false });
    const response = await h.get('/internal/v1/me', { secret: 'wrong-secret' });
    expect(code(response)).toBe('signature_invalid');
  });

  it('rejects a wrong secret, path, method and body', async () => {
    const h = await createHarness();
    expect(code(await h.get('/internal/v1/me', { secret: 'wrong' }))).toBe('signature_invalid');

    const timestamp = String(h.clock.now().getTime());
    const sign = (overrides) =>
      signRequest({ secret: h.created.signingSecret, timestamp, method: 'GET', path: '/internal/v1/me', body: Buffer.alloc(0), ...overrides });

    const wrongPath = await request(h.app)
      .get('/internal/v1/me')
      .set({ 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': timestamp, 'x-ai-signature': sign({ path: '/internal/v1/other' }) });
    expect(code(wrongPath)).toBe('signature_invalid');

    const wrongMethod = await request(h.app)
      .get('/internal/v1/me')
      .set({ 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': timestamp, 'x-ai-signature': sign({ method: 'POST' }) });
    expect(code(wrongMethod)).toBe('signature_invalid');

    const tampered = await request(h.app)
      .put('/internal/v1/admin/mode')
      .set({
        'x-ai-app-key': h.created.appKey,
        'x-act-as-email': 'ada@fab5.in',
        'x-ai-timestamp': timestamp,
        'x-ai-signature': sign({ method: 'PUT', path: '/internal/v1/admin/mode', body: Buffer.from('{"referenceDate":"2026-07-01","reason":"ok"}') })
      })
      .set('content-type', 'application/json')
      .send('{"referenceDate":"2026-07-02","reason":"ok"}');
    expect(code(tampered)).toBe('signature_invalid');
  });

  it('binds the query string into the signature', async () => {
    const h = await createHarness();
    const timestamp = String(h.clock.now().getTime());
    const signature = signRequest({ secret: h.created.signingSecret, timestamp, method: 'GET', path: '/internal/v1/me?a=1', body: Buffer.alloc(0) });
    const headers = { 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': timestamp, 'x-ai-signature': signature };
    expect((await request(h.app).get('/internal/v1/me?a=1').set(headers)).status).toBe(200);
    const h2 = await createHarness();
    const mismatch = await request(h2.app).get('/internal/v1/me?a=2').set({ ...headers, 'x-ai-app-key': h2.created.appKey });
    expect(code(mismatch)).toBe('signature_invalid');
  });

  it('rejects stale, future and malformed timestamps', async () => {
    const h = await createHarness();
    const now = h.clock.now().getTime();
    expect(code(await h.get('/internal/v1/me', { at: now - 5 * 60 * 1000 - 1 }))).toBe('timestamp_expired');
    expect(code(await h.get('/internal/v1/me', { at: now + 5 * 60 * 1000 + 1 }))).toBe('timestamp_expired');
    expect((await h.get('/internal/v1/me', { at: now - 4 * 60 * 1000 })).status).toBe(200);
    const malformed = await request(h.app)
      .get('/internal/v1/me')
      .set({ 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': 'yesterday', 'x-ai-signature': 'abc' });
    expect(code(malformed)).toBe('timestamp_invalid');
    const half = await request(h.app)
      .get('/internal/v1/me')
      .set({ 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': String(now) });
    expect(code(half)).toBe('signature_invalid');
  });

  it('rejects a replayed request and accepts a new one', async () => {
    const h = await createHarness();
    const timestamp = String(h.clock.now().getTime());
    const signature = signRequest({ secret: h.created.signingSecret, timestamp, method: 'GET', path: '/internal/v1/me', body: Buffer.alloc(0) });
    const headers = { 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': timestamp, 'x-ai-signature': signature };
    expect((await request(h.app).get('/internal/v1/me').set(headers)).status).toBe(200);
    const replayed = await request(h.app).get('/internal/v1/me').set(headers);
    expect([replayed.status, code(replayed)]).toEqual([401, 'replay_detected']);
    h.clock.advance(1000);
    expect((await h.get('/internal/v1/me')).status).toBe(200);
  });

  it('does not let a failed signature poison the replay cache', async () => {
    const h = await createHarness();
    const timestamp = String(h.clock.now().getTime());
    const good = signRequest({ secret: h.created.signingSecret, timestamp, method: 'GET', path: '/internal/v1/me', body: Buffer.alloc(0) });
    const headers = { 'x-ai-app-key': h.created.appKey, 'x-act-as-email': 'asha@fab5.in', 'x-ai-timestamp': timestamp };
    await request(h.app).get('/internal/v1/me').set({ ...headers, 'x-ai-signature': `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}` });
    expect((await request(h.app).get('/internal/v1/me').set({ ...headers, 'x-ai-signature': good })).status).toBe(200);
  });

  it('forgets claims after ten minutes in the memory cache', async () => {
    const clock = createClock();
    const { createMemoryReplayCache } = await import('../src/auth/replayCache.js');
    const cache = createMemoryReplayCache({ clock });
    expect(await cache.claim('k', 600)).toBe(true);
    expect(await cache.claim('k', 600)).toBe(false);
    clock.advance(600001);
    expect(await cache.claim('k', 600)).toBe(true);
  });

  it('fails closed when the replay cache is down', async () => {
    const h = await createHarness({
      replay: {
        claim: async () => {
          throw new Error('redis down');
        }
      }
    });
    const response = await h.get('/internal/v1/me');
    expect([response.status, code(response)]).toEqual([503, 'replay_cache_unavailable']);
  });

  it('does not leak when the client secret cannot be decrypted', async () => {
    const h = await createHarness();
    const other = createCipher({ keys: { k1: Buffer.alloc(32, 9).toString('base64') }, activeKeyId: 'k1' });
    const admin = createClientAdmin({ store: h.clients, cipher: other, clock: h.clock });
    const created = await admin.create({ id: 'bahikhata', name: 'BahiKhata' });
    const response = await h.get('/internal/v1/me', { key: created.appKey, secret: created.signingSecret });
    expect([response.status, code(response)]).toEqual([500, 'auth_misconfigured']);
    expect(JSON.stringify(response.body)).not.toContain('Decryption');
    expect(secretAad('bahikhata')).toBe('ai_clients:bahikhata:secret');
  });
});

describe('acting user', () => {
  it('requires the acting user header', async () => {
    const h = await createHarness();
    const response = await h.get('/internal/v1/me', { email: null });
    expect([response.status, code(response)]).toEqual([401, 'actor_required']);
  });

  it('rejects unknown, inactive, unmapped and malformed users with the same code', async () => {
    const h = await createHarness();
    for (const email of ['nobody@fab5.in', 'gone@fab5.in', 'lost@fab5.in', 'bad@fab5.in', 'not-an-email', 'a@b']) {
      const response = await h.get('/internal/v1/me', { email });
      expect([response.status, code(response), email]).toEqual([403, 'unknown_user', email]);
    }
  });

  it('matches email case-insensitively and returns the stored identity', async () => {
    const h = await createHarness();
    const response = await h.get('/internal/v1/me', { email: '  ASHA@FAB5.IN ' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ employeeId: 'emp_1', email: 'asha@fab5.in', role: 'employee', clientId: 'crm' });
  });

  it('never trusts a role claimed by the app', async () => {
    const h = await createHarness();
    const attempts = [
      { headers: { 'x-act-as-role': 'owner' } },
      { headers: { 'x-ai-role': 'admin', 'x-role': 'admin' } },
      { headers: { authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJyb2xlIjoib3duZXIifQ.' } }
    ];
    for (const attempt of attempts) {
      const me = await h.get('/internal/v1/me', attempt);
      expect(me.body.role).toBe('employee');
      const admin = await h.get('/internal/v1/admin/mode', attempt);
      expect([admin.status, code(admin)]).toEqual([403, 'forbidden']);
    }
    const query = await h.get('/internal/v1/admin/mode?role=owner&aiRole=owner');
    expect(code(query)).toBe('forbidden');
    const body = await h.put('/internal/v1/admin/mode', { role: 'owner', referenceDate: '2026-07-01', reason: 'x' });
    expect(body.status).toBe(403);
    expect((await h.mode.describe()).referenceDate).toBe('2026-08-14');
  });

  it('applies the stored role at request time', async () => {
    const h = await createHarness();
    expect((await h.get('/internal/v1/admin/mode')).status).toBe(403);
    await h.employeesCollection.updateOne({ _id: 'emp_1' }, { $set: { aiRole: 'admin' } });
    expect((await h.get('/internal/v1/admin/mode')).status).toBe(200);
    await h.employeesCollection.updateOne({ _id: 'emp_1' }, { $set: { active: false } });
    expect(code(await h.get('/internal/v1/admin/mode'))).toBe('unknown_user');
  });

  it('allows admin and owner and denies employee and manager', async () => {
    const h = await createHarness();
    const results = {};
    for (const email of ['asha@fab5.in', 'manu@fab5.in', 'ada@fab5.in', 'olu@fab5.in']) {
      results[email] = (await h.get('/internal/v1/admin/mode', { email })).status;
    }
    expect(results).toEqual({ 'asha@fab5.in': 403, 'manu@fab5.in': 403, 'ada@fab5.in': 200, 'olu@fab5.in': 200 });
  });
});

describe('rate limits', () => {
  it('limits per user and keeps users independent', async () => {
    const h = await createHarness({ clientOptions: { rateLimit: { perUserPerMin: 3, perAppPerMin: 100 } } });
    for (let index = 0; index < 3; index += 1) {
      h.clock.advance(1);
      expect((await h.get('/internal/v1/me')).status).toBe(200);
    }
    h.clock.advance(1);
    const limited = await h.get('/internal/v1/me');
    expect([limited.status, code(limited)]).toEqual([429, 'rate_limited']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    h.clock.advance(1);
    expect((await h.get('/internal/v1/me', { email: 'manu@fab5.in' })).status).toBe(200);
  });

  it('limits per app across users and resets next minute', async () => {
    const h = await createHarness({ clientOptions: { rateLimit: { perUserPerMin: 100, perAppPerMin: 2 } } });
    h.clock.advance(1);
    expect((await h.get('/internal/v1/me', { email: 'asha@fab5.in' })).status).toBe(200);
    h.clock.advance(1);
    expect((await h.get('/internal/v1/me', { email: 'manu@fab5.in' })).status).toBe(200);
    h.clock.advance(1);
    expect((await h.get('/internal/v1/me', { email: 'ada@fab5.in' })).status).toBe(429);
    h.clock.advance(61000);
    expect((await h.get('/internal/v1/me', { email: 'ada@fab5.in' })).status).toBe(200);
  });

  it('limits switch actions to ten per minute per user', async () => {
    const h = await createHarness({ clientOptions: { rateLimit: { perUserPerMin: 1000, perAppPerMin: 1000 } } });
    const statuses = [];
    for (let index = 0; index < 11; index += 1) {
      h.clock.advance(1);
      statuses.push((await h.put('/internal/v1/admin/mode', { referenceDate: '2026-07-01', reason: 'demo' }, { email: 'ada@fab5.in' })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('works against redis-style counters', async () => {
    const counts = new Map();
    const redis = {
      incr: async (key) => counts.set(key, (counts.get(key) ?? 0) + 1).get(key),
      expire: async () => 1
    };
    const clock = createClock();
    const limiter = createRedisRateLimiter({ redis, clock });
    expect((await limiter.hit('k', 2)).allowed).toBe(true);
    expect((await limiter.hit('k', 2)).allowed).toBe(true);
    const third = await limiter.hit('k', 2);
    expect(third).toMatchObject({ allowed: false, remaining: 0 });
    expect(third.resetMs).toBeGreaterThan(0);
  });

  it('claims replay keys with SET NX EX', async () => {
    const calls = [];
    const store = new Set();
    const redis = {
      set: async (...args) => {
        calls.push(args);
        if (store.has(args[0])) return null;
        store.add(args[0]);
        return 'OK';
      }
    };
    const cache = createRedisReplayCache({ redis });
    expect(await cache.claim('a', 600)).toBe(true);
    expect(await cache.claim('a', 600)).toBe(false);
    expect(calls[0]).toEqual(['ai:replay:a', '1', 'EX', 600, 'NX']);
  });
});

describe('transport rules', () => {
  it('rejects browser origins', async () => {
    const h = await createHarness();
    const response = await h.get('/internal/v1/me', { headers: { origin: 'https://evil.example' } });
    expect([response.status, code(response)]).toEqual([403, 'browser_not_allowed']);
  });

  it('rejects non-JSON bodies, invalid JSON and oversized bodies', async () => {
    const h = await createHarness();
    const text = await h.call('PUT', '/internal/v1/admin/mode', { email: 'ada@fab5.in', rawBody: 'a=b', headers: { 'content-type': 'text/plain' } });
    expect(text.status).toBe(415);
    const invalid = await h.call('PUT', '/internal/v1/admin/mode', { email: 'ada@fab5.in', rawBody: '{bad' });
    expect([invalid.status, code(invalid)]).toEqual([400, 'invalid_json']);
    const big = await h.call('PUT', '/internal/v1/admin/mode', { email: 'ada@fab5.in', rawBody: JSON.stringify({ reason: 'x'.repeat(300000) }) });
    expect([big.status, code(big)]).toEqual([413, 'payload_too_large']);
  });

  it('returns JSON errors with request ids and honors a valid inbound id', async () => {
    const h = await createHarness();
    const unknown = await h.get('/internal/v1/nope');
    expect([unknown.status, code(unknown)]).toEqual([404, 'not_found']);
    expect(unknown.body.error.requestId).toBe(unknown.headers['x-request-id']);
    const honored = await h.get('/internal/v1/me', { headers: { 'x-request-id': 'req-12345678' } });
    expect(honored.headers['x-request-id']).toBe('req-12345678');
    expect(honored.body.requestId).toBe('req-12345678');
    const replaced = await h.get('/internal/v1/me', { headers: { 'x-request-id': 'bad id!' } });
    expect(replaced.headers['x-request-id']).not.toBe('bad id!');
    expect(replaced.headers['cache-control']).toBe('no-store');
    expect(replaced.headers['x-powered-by']).toBeUndefined();
  });

  it('requires credentials before revealing unknown routes', async () => {
    const h = await createHarness();
    const response = await request(h.app).get('/internal/v1/nope');
    expect(response.status).toBe(401);
    expect((await request(h.app).get('/elsewhere')).status).toBe(404);
  });

  it('does not log secrets', async () => {
    const h = await createHarness();
    await h.get('/internal/v1/me', { email: 'nobody@fab5.in' });
    const text = JSON.stringify(h.logs);
    expect(text).not.toContain(h.created.appKey);
    expect(text).not.toContain(h.created.signingSecret);
  });
});

describe('mode endpoints', () => {
  it('returns the banner and data range', async () => {
    const h = await createHarness();
    const response = await h.get('/internal/v1/admin/mode', { email: 'olu@fab5.in' });
    expect(response.body).toMatchObject({
      mode: 'practice',
      referenceDate: '2026-08-14',
      referenceAuto: true,
      banner: { practice: true, text: 'PRACTICE MODE: reference date 2026-08-14, data from 2026-06-14 to 2026-08-14', runNowEnabled: true }
    });
  });

  it('updates the reference date with an audit entry', async () => {
    const h = await createHarness();
    const response = await h.put('/internal/v1/admin/mode', { referenceDate: '2026-07-20', reason: 'finance demo' }, { email: 'ada@fab5.in' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ referenceDate: '2026-07-20', referenceAuto: false });
    expect(h.audits.at(-1)).toMatchObject({ actorEmployeeId: 'emp_3', action: 'mode.update', reason: 'finance demo' });
  });

  it('validates the body', async () => {
    const h = await createHarness({ clientOptions: { rateLimit: { perUserPerMin: 1000, perAppPerMin: 1000 } } });
    const options = { email: 'ada@fab5.in' };
    expect(code(await h.put('/internal/v1/admin/mode', { reason: 'x', extra: 1 }, options))).toBe('unknown_fields');
    expect(code(await h.put('/internal/v1/admin/mode', { referenceDate: '2026-07-20' }, options))).toBe('reason_required');
    expect(code(await h.put('/internal/v1/admin/mode', { referenceDate: '2026-13-40', reason: 'x' }, options))).toBe('invalid_reference_date');
    expect(code(await h.put('/internal/v1/admin/mode', { referenceDate: '2026-12-31', reason: 'x' }, options))).toBe('reference_in_future');
    expect(code(await h.put('/internal/v1/admin/mode', { referenceAuto: 'yes', reason: 'x' }, options))).toBe('invalid_body');
    expect(code(await h.put('/internal/v1/admin/mode', { mode: 'production', reason: 'x' }, options))).toBe('mode_env_mismatch');
    expect(code(await h.put('/internal/v1/admin/mode', [], options))).toBe('invalid_body');
  });

  it('is locked in production', async () => {
    const h = await createHarness({ env: { MODE: 'production' } });
    const response = await h.put('/internal/v1/admin/mode', { referenceDate: '2026-07-20', reason: 'x' }, { email: 'ada@fab5.in' });
    expect([response.status, code(response)]).toEqual([409, 'production_locked']);
    expect((await h.get('/internal/v1/admin/mode', { email: 'ada@fab5.in' })).body.banner.practice).toBe(false);
  });

  it('queues a run now once and then reports in progress', async () => {
    const h = await createHarness();
    const first = await h.post('/internal/v1/admin/run-now', { reason: 'first run' }, { email: 'olu@fab5.in' });
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ runId: 'run-test', referenceDate: '2026-08-14' });
    expect(h.jobs[0].payload).toMatchObject({ trigger: 'run_now', requestedBy: 'emp_4', referenceDate: '2026-08-14' });
    h.clock.advance(1);
    const second = await h.post('/internal/v1/admin/run-now', { reason: 'again' }, { email: 'olu@fab5.in' });
    expect([second.status, code(second)]).toEqual([409, 'run_in_progress']);
    const denied = await h.post('/internal/v1/admin/run-now', { reason: 'x' }, { email: 'asha@fab5.in' });
    expect(denied.status).toBe(403);
  });

  it('refuses run now in production', async () => {
    const h = await createHarness({ env: { MODE: 'production' } });
    const response = await h.post('/internal/v1/admin/run-now', { reason: 'x' }, { email: 'olu@fab5.in' });
    expect([response.status, code(response)]).toEqual([409, 'run_now_disabled']);
  });
});

describe('seeding', () => {
  it('creates the hub client once and returns secrets only on creation', async () => {
    const h = await createHarness();
    const first = await seedHubClient({ admin: h.admin, store: h.clients });
    expect(first.created).toBe(true);
    expect(first.appKey).toMatch(/^fab5ai_/);
    const stored = await h.clients.get('hub');
    expect(stored.allowedIps).toEqual(['127.0.0.1', '::1']);
    expect(await seedHubClient({ admin: h.admin, store: h.clients })).toEqual({ created: false });
  });

  it('seeds a local owner that can call the service', async () => {
    const h = await createHarness();
    const env = { MODE: 'practice', LOCAL_ADMIN_EMAIL: 'Local@Fab5.in', LOCAL_ADMIN_PASSWORD_HASH: await hashPassword('s3cret-pass') };
    await seedLocalAdmin({ employees: h.employees, env, clock: h.clock });
    await seedLocalAdmin({ employees: h.employees, env, clock: h.clock });
    const response = await h.get('/internal/v1/me', { email: 'local@fab5.in' });
    expect(response.body).toMatchObject({ employeeId: 'emp_local_admin', role: 'owner' });
    expect((await h.get('/internal/v1/admin/mode', { email: 'local@fab5.in' })).status).toBe(200);
  });

  it('refuses the local admin in production and with bad settings', async () => {
    const h = await createHarness();
    const hash = await hashPassword('s3cret-pass');
    const base = { LOCAL_ADMIN_EMAIL: 'local@fab5.in', LOCAL_ADMIN_PASSWORD_HASH: hash };
    await expect(seedLocalAdmin({ employees: h.employees, env: { ...base, MODE: 'production' }, clock: h.clock })).rejects.toMatchObject({
      code: 'LOCAL_ADMIN_PRODUCTION'
    });
    expect(() => createLocalLogin({ env: { ...base, MODE: 'production' } })).toThrow(/production/);
    expect(() => createLocalLogin({ env: { MODE: 'practice', LOCAL_ADMIN_EMAIL: 'bad', LOCAL_ADMIN_PASSWORD_HASH: hash } })).toThrow(/EMAIL/);
    expect(() => createLocalLogin({ env: { MODE: 'practice', LOCAL_ADMIN_EMAIL: 'a@b.in', LOCAL_ADMIN_PASSWORD_HASH: 'plain' } })).toThrow(/scrypt/);
    expect(h.employeesCollection.docs.has('emp_local_admin')).toBe(false);
  });

  it('verifies the local login', async () => {
    const env = { MODE: 'practice', LOCAL_ADMIN_EMAIL: 'local@fab5.in', LOCAL_ADMIN_PASSWORD_HASH: await hashPassword('s3cret-pass') };
    const login = createLocalLogin({ env });
    expect(await login({ email: 'LOCAL@fab5.in', password: 's3cret-pass' })).toBe(true);
    expect(await login({ email: 'local@fab5.in', password: 'nope' })).toBe(false);
    expect(await login({ email: 'other@fab5.in', password: 's3cret-pass' })).toBe(false);
    expect(await login({})).toBe(false);
  });
});

describe('address rules', () => {
  it('normalizes mapped addresses and matches CIDR ranges', () => {
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(ipAllowed([], '1.2.3.4')).toBe(true);
    expect(ipAllowed(undefined, '1.2.3.4')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '::ffff:10.9.9.9')).toBe(true);
    expect(ipAllowed(['10.0.0.0/8'], '11.0.0.1')).toBe(false);
    expect(ipAllowed(['192.168.1.0/24', '::1'], '192.168.2.1')).toBe(false);
    expect(ipAllowed(['::1'], '::1')).toBe(true);
    expect(ipAllowed(['0.0.0.0/0'], '8.8.8.8')).toBe(true);
    expect(ipAllowed(['10.0.0.0/33'], '10.0.0.1')).toBe(false);
    expect(ipAllowed(['bogus/8'], '10.0.0.1')).toBe(false);
  });
});
