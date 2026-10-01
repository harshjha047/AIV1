import request from 'supertest';
import { signRequest } from '@fab5/shared/appKeys';
import { createCipher } from '@fab5/shared/cipher';
import { createModeService, createModeStore } from '@fab5/shared/mode';
import { createRunNow } from '@fab5/shared/runNow';
import { createApp } from '../src/app.js';
import { createClientAdmin, createClientStore } from '../src/auth/clientStore.js';
import { createEmployeeStore } from '../src/auth/employeeStore.js';
import { createMemoryRateLimiter } from '../src/auth/rateLimiter.js';
import { createMemoryReplayCache } from '../src/auth/replayCache.js';

export function createClock(start = '2026-10-01T05:00:00.000Z') {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    monotonic: () => ms,
    sleep: async (delta) => {
      ms += delta;
    },
    advance(delta) {
      ms += delta;
    }
  };
}

export function memoryCollection(initial = []) {
  const docs = new Map(initial.map((doc) => [doc._id, structuredClone(doc)]));
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value);
  return {
    docs,
    async findOne(filter) {
      for (const doc of docs.values()) if (matches(doc, filter)) return structuredClone(doc);
      return null;
    },
    find(filter = {}) {
      return { toArray: async () => [...docs.values()].filter((doc) => matches(doc, filter)).map((doc) => structuredClone(doc)) };
    },
    async insertOne(doc) {
      docs.set(doc._id, structuredClone(doc));
    },
    async replaceOne(filter, doc) {
      const id = filter._id ?? doc._id;
      docs.set(id, structuredClone(doc));
    },
    async updateOne(filter, update, options = {}) {
      let target = null;
      for (const doc of docs.values()) if (matches(doc, filter)) target = doc;
      if (!target && options.upsert) {
        target = { _id: filter._id, ...(update.$setOnInsert ?? {}) };
        docs.set(target._id, target);
      }
      if (target) Object.assign(target, structuredClone(update.$set ?? {}));
    }
  };
}

export const KEY = Buffer.alloc(32, 7).toString('base64');

export const employee = (overrides = {}) => ({
  _id: 'emp_1',
  email: 'asha@fab5.in',
  name: 'Asha',
  aliases: [],
  active: true,
  aiRole: 'employee',
  managerId: null,
  sources: { crmUserId: 'u1' },
  sourceRoles: {},
  mappingStatus: 'complete',
  ...overrides
});

export const EMPLOYEES = [
  employee(),
  employee({ _id: 'emp_2', email: 'manu@fab5.in', name: 'Manu', aiRole: 'manager', sources: { crmUserId: 'u2' } }),
  employee({ _id: 'emp_3', email: 'ada@fab5.in', name: 'Ada', aiRole: 'admin', sources: { crmUserId: 'u3' } }),
  employee({ _id: 'emp_4', email: 'olu@fab5.in', name: 'Olu', aiRole: 'owner', sources: { bahikhataUserId: 'b4' } }),
  employee({ _id: 'emp_5', email: 'gone@fab5.in', name: 'Gone', active: false }),
  employee({ _id: 'emp_6', email: 'lost@fab5.in', name: 'Lost', sources: {} }),
  employee({ _id: 'emp_7', email: 'bad@fab5.in', name: 'Bad', aiRole: 'superuser' })
];

export async function createHarness({
  env = { MODE: 'practice' },
  requireSignature = true,
  ranges = [{ sourceId: 'crm', min: new Date('2026-06-14T10:00:00Z'), max: new Date('2026-08-14T08:00:00Z') }],
  clientOptions = {},
  replay,
  limiter
} = {}) {
  const clock = createClock();
  const cipher = createCipher({ keys: { k1: KEY }, activeKeyId: 'k1' });
  const clientsCollection = memoryCollection();
  const employeesCollection = memoryCollection(EMPLOYEES);
  const clients = createClientStore(clientsCollection);
  const employees = createEmployeeStore(employeesCollection);
  const admin = createClientAdmin({ store: clients, cipher, clock });
  const created = await admin.create({ id: 'crm', name: 'CRM', ...clientOptions });
  const audits = [];
  const events = [];
  const meta = memoryCollection();
  const mode = createModeService({
    store: createModeStore(meta),
    real: clock,
    env,
    activityRange: async () => ranges,
    audit: { record: async (entry) => audits.push(entry) },
    activity: { emit: async (event) => events.push(event) }
  });
  await mode.load();
  const jobs = [];
  const runNow = createRunNow({
    mode,
    enqueue: async (name, payload) => jobs.push({ name, payload }),
    audit: { record: async (entry) => audits.push(entry) },
    activity: { emit: async (event) => events.push(event) },
    idFactory: () => 'run-test'
  });
  const effectiveLimiter = limiter ?? createMemoryRateLimiter({ clock });
  const effectiveReplay = replay ?? createMemoryReplayCache({ clock });
  const logs = [];
  const logger = {
    info: (...args) => logs.push(['info', ...args]),
    error: (...args) => logs.push(['error', ...args]),
    warn: (...args) => logs.push(['warn', ...args])
  };
  const app = createApp({
    clients,
    employees,
    replay: effectiveReplay,
    limiter: effectiveLimiter,
    cipher,
    clock,
    mode,
    runNow,
    logger,
    requireSignature
  });

  function call(
    method,
    path,
    { email = 'asha@fab5.in', body, key = created.appKey, secret = created.signingSecret, at, headers = {}, sign = true, rawBody } = {}
  ) {
    if (at === undefined) clock.advance(1);
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const timestamp = String(at ?? clock.now().getTime());
    let req = request(app)[method.toLowerCase()](path).set('x-ai-app-key', key);
    if (email !== null) req = req.set('x-act-as-email', email);
    if (sign) {
      const signature = signRequest({
        secret,
        timestamp,
        method,
        path,
        body: payload === undefined ? Buffer.alloc(0) : Buffer.from(payload)
      });
      req = req.set('x-ai-timestamp', timestamp).set('x-ai-signature', signature);
    }
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    if (payload !== undefined) req = req.set('content-type', headers['content-type'] ?? 'application/json').send(payload);
    return req;
  }

  return {
    app,
    clock,
    cipher,
    clients,
    employees,
    admin,
    created,
    clientsCollection,
    employeesCollection,
    mode,
    audits,
    events,
    jobs,
    logs,
    meta,
    call,
    get: (path, options) => call('GET', path, options),
    put: (path, body, options) => call('PUT', path, { ...options, body }),
    post: (path, body, options) => call('POST', path, { ...options, body })
  };
}
