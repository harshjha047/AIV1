import http from 'node:http';
import { createRealClock } from '@fab5/shared/clock';
import { createOllamaClient } from '../src/client.js';

export const FINAL = Object.freeze({
  model: 'm',
  done: true,
  message: { role: 'assistant', content: '' },
  total_duration: 2500000000,
  load_duration: 500000000,
  prompt_eval_count: 120,
  prompt_eval_duration: 400000000,
  eval_count: 40,
  eval_duration: 1000000000
});

export const token = (content) => ({ message: { role: 'assistant', content }, done: false });

export async function createFakeOllama(handler) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const entry = { method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null, closedEarly: false };
    requests.push(entry);
    res.on('close', () => {
      if (!res.writableEnded) entry.closedEarly = true;
    });
    await handler(req, res, entry, requests.length);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

export function writeLines(res, objects, { status = 200 } = {}) {
  res.writeHead(status, { 'content-type': 'application/x-ndjson' });
  for (const object of objects) res.write(`${JSON.stringify(object)}\n`);
  res.end();
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function recorders() {
  const rows = [];
  const events = [];
  return {
    rows,
    events,
    usage: {
      async insert(doc) {
        rows.push(doc);
        return `u${rows.length}`;
      },
      async update(id, patch) {
        const row = rows[Number(id.slice(1)) - 1];
        Object.assign(row, patch);
      }
    },
    activity: {
      async emit(event) {
        events.push(event);
      }
    }
  };
}

export const FIXED_NOW = new Date('2026-10-01T05:00:00.000Z');
export const fixedClock = createRealClock({ now: () => new Date(FIXED_NOW.getTime()) });

export function makeClient(server, recorder, options = {}) {
  return createOllamaClient({
    baseUrl: server.url,
    clock: fixedClock,
    usage: recorder.usage,
    activity: recorder.activity,
    retryDelayMs: 5,
    timeoutMs: 2000,
    ...options
  });
}

export const ctx = (overrides = {}) => ({
  route: 'live_small',
  requestId: 'req-1',
  jobId: 'job-1',
  employeeId: 'emp_1',
  intent: 'my_kpi',
  queueWaitMs: 12.4,
  ...overrides
});

export const messages = [{ role: 'user', content: 'Summarise: revenue up 4 percent' }];
