import { afterEach, describe, expect, it } from 'vitest';
import { OllamaError, RemoteInferenceError } from '../src/errors.js';
import { createOllamaClient, assertLocalUrl } from '../src/client.js';
import { readNdjson } from '../src/ndjson.js';
import { createOllamaProbe } from '../src/probe.js';
import { deriveStats, percentile, median } from '../src/stats.js';
import { FINAL, FIXED_NOW, createFakeOllama, ctx, delay, fixedClock, makeClient, messages, recorders, token, writeLines } from './helpers.js';

const servers = [];
const start = async (handler) => {
  const server = await createFakeOllama(handler);
  servers.push(server);
  return server;
};

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

async function collect(iterable) {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('ndjson reader', () => {
  const enc = new TextEncoder();

  it('handles lines split across chunks and CRLF', async () => {
    const parts = [enc.encode('{"a":1}\r\n{"b"'), enc.encode(':2}\n\n{"c":3}')];
    expect(await collect(readNdjson(parts))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('handles multibyte characters split across chunks', async () => {
    const bytes = enc.encode('{"t":"नमस्ते"}\n');
    const parts = [bytes.slice(0, 9), bytes.slice(9)];
    expect(await collect(readNdjson(parts))).toEqual([{ t: 'नमस्ते' }]);
  });

  it('rejects malformed lines without echoing content', async () => {
    const error = await collect(readNdjson([enc.encode('{secret text\n')])).catch((e) => e);
    expect(error).toBeInstanceOf(OllamaError);
    expect(error.errorClass).toBe('bad_response');
    expect(error.message).not.toContain('secret');
  });
});

describe('stats', () => {
  it('converts nanoseconds and derives rates', () => {
    expect(deriveStats(FINAL)).toEqual({
      totalMs: 2500,
      loadMs: 500,
      promptEvalMs: 400,
      evalMs: 1000,
      promptTokens: 120,
      completionTokens: 40,
      decodeTokPerSec: 40,
      promptTokPerSec: 300
    });
  });

  it('returns nulls for missing or zero durations', () => {
    expect(deriveStats({ eval_count: 10, eval_duration: 0 }).decodeTokPerSec).toBeNull();
    expect(deriveStats({})).toMatchObject({ totalMs: null, promptTokens: null });
    expect(deriveStats({ total_duration: -1 }).totalMs).toBeNull();
  });

  it('computes percentiles', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5, null, NaN], 0.95)).toBe(5);
  });
});

describe('local-only inference', () => {
  it('accepts loopback and refuses anything else', () => {
    expect(assertLocalUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(assertLocalUrl('http://localhost:11434')).toBe('http://localhost:11434');
    expect(assertLocalUrl('http://[::1]:11434')).toBe('http://[::1]:11434');
    for (const url of ['https://api.openai.com', 'http://127.0.0.1.evil.com', 'http://10.0.0.5:11434', 'http://ollama.internal']) {
      expect(() => assertLocalUrl(url)).toThrow(RemoteInferenceError);
    }
    expect(() => assertLocalUrl('not a url')).toThrow(TypeError);
    expect(() => assertLocalUrl('ftp://127.0.0.1')).toThrow(RemoteInferenceError);
    expect(() => createOllamaClient({ baseUrl: 'http://example.com' })).toThrow(RemoteInferenceError);
  });
});

describe('chat', () => {
  it('streams tokens, derives stats and writes one usage row and one activity event', async () => {
    const server = await start((_req, res) => writeLines(res, [token('Revenue '), token('rose '), token('4%'), FINAL]));
    const recorder = recorders();
    const client = makeClient(server, recorder);
    const seen = [];
    const result = await client.chat(
      {
        model: 'qwen:test',
        messages,
        options: { temperature: 0.1, num_ctx: 4096, num_predict: 120, num_thread: 2 },
        think: false,
        keepAlive: -1,
        onToken: (piece) => seen.push(piece)
      },
      ctx()
    );
    expect(seen).toEqual(['Revenue ', 'rose ', '4%']);
    expect(result).toMatchObject({ text: 'Revenue rose 4%', attempts: 1, outcome: 'ok', usageEventId: 'u1', model: 'qwen:test' });
    expect(result.stats).toMatchObject({ decodeTokPerSec: 40, promptTokPerSec: 300, promptTokens: 120, completionTokens: 40 });
    expect(result.stats.ttftMs).toBeGreaterThanOrEqual(0);
    expect(server.requests[0].url).toBe('/api/chat');
    expect(server.requests[0].body).toMatchObject({
      model: 'qwen:test',
      stream: true,
      think: false,
      keep_alive: -1,
      options: { temperature: 0.1, num_ctx: 4096, num_predict: 120, num_thread: 2 }
    });
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({
      ts: FIXED_NOW,
      route: 'live_small',
      model: 'qwen:test',
      requestId: 'req-1',
      jobId: 'job-1',
      employeeId: 'emp_1',
      intent: 'my_kpi',
      queueWaitMs: 12,
      totalMs: 2500,
      loadMs: 500,
      promptEvalMs: 400,
      evalMs: 1000,
      promptTokens: 120,
      completionTokens: 40,
      decodeTokPerSec: 40,
      promptTokPerSec: 300,
      attempts: 1,
      outcome: 'ok'
    });
    expect(recorder.rows[0].errorClass).toBeUndefined();
    expect(recorder.rows[0].text).toBeUndefined();
    expect(recorder.events).toEqual([
      {
        kind: 'llm_call',
        level: 'info',
        action: 'live_small',
        ok: true,
        durationMs: 2500,
        refType: 'llm_usage',
        refId: 'u1',
        message: 'qwen:test ok 120+40 tok'
      }
    ]);
  });

  it('omits unset request fields', async () => {
    const server = await start((_req, res) => writeLines(res, [token('x'), FINAL]));
    await makeClient(server, recorders()).chat({ model: 'm', messages }, ctx());
    expect(Object.keys(server.requests[0].body).sort()).toEqual(['messages', 'model', 'stream']);
  });

  it('stores text only when text logging is on, with a seven day expiry', async () => {
    const server = await start((_req, res) => writeLines(res, [token('answer'), FINAL]));
    const off = recorders();
    await makeClient(server, off).chat({ model: 'm', messages }, ctx());
    expect(off.rows[0].text).toBeUndefined();
    expect(JSON.stringify(off.rows)).not.toContain('Summarise');
    const on = recorders();
    await makeClient(server, on, { textLogging: true }).chat({ model: 'm', messages }, ctx());
    expect(on.rows[0].text).toEqual({ prompt: 'user: Summarise: revenue up 4 percent', answer: 'answer' });
    expect(on.rows[0].textExpireAt.getTime() - FIXED_NOW.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(on.events)).not.toContain('Summarise');
  });

  it('parses structured output and records validator_fail for invalid JSON without retrying', async () => {
    const schema = { type: 'object', properties: { commentary: { type: 'string' } } };
    const good = await start((_req, res) => writeLines(res, [token('{"commentary":'), token('"ok"}'), FINAL]));
    const goodRecorder = recorders();
    const result = await makeClient(good, goodRecorder).chat({ model: 'm', messages, format: schema }, ctx());
    expect(result.json).toEqual({ commentary: 'ok' });
    expect(good.requests[0].body.format).toEqual(schema);

    const bad = await start((_req, res) => writeLines(res, [token('not json'), FINAL]));
    const badRecorder = recorders();
    const error = await makeClient(bad, badRecorder).chat({ model: 'm', messages, format: schema }, ctx()).catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'invalid_json', outcome: 'validator_fail', usageEventId: 'u1' });
    expect(bad.requests).toHaveLength(1);
    expect(badRecorder.rows[0]).toMatchObject({ outcome: 'validator_fail', errorClass: 'invalid_json', attempts: 1 });
    expect(badRecorder.events[0]).toMatchObject({ level: 'warn', ok: false });
  });

  it('retries once on a 503 and writes a single row', async () => {
    const server = await start((_req, res, _entry, count) =>
      count === 1 ? writeLines(res, [{ error: 'busy' }], { status: 503 }) : writeLines(res, [token('ok'), FINAL])
    );
    const recorder = recorders();
    const result = await makeClient(server, recorder).chat({ model: 'm', messages }, ctx());
    expect(result.attempts).toBe(2);
    expect(server.requests).toHaveLength(2);
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({ attempts: 2, outcome: 'ok' });
  });

  it('gives up after the retry budget', async () => {
    const server = await start((_req, res) => writeLines(res, [{ error: 'busy' }], { status: 503 }));
    const recorder = recorders();
    const error = await makeClient(server, recorder).chat({ model: 'm', messages }, ctx()).catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'http_5xx', status: 503, attempts: 2 });
    expect(server.requests).toHaveLength(2);
    expect(recorder.rows[0]).toMatchObject({ outcome: 'error', errorClass: 'http_5xx', attempts: 2 });
    expect(recorder.events[0]).toMatchObject({ level: 'error', ok: false });
  });

  it('honors a zero retry override', async () => {
    const server = await start((_req, res) => writeLines(res, [{ error: 'busy' }], { status: 503 }));
    await makeClient(server, recorders()).chat({ model: 'm', messages, retries: 0 }, ctx()).catch(() => {});
    expect(server.requests).toHaveLength(1);
  });

  it('does not retry client errors and detects a missing model', async () => {
    const missing = await start((_req, res) => writeLines(res, [{ error: "model 'nope' not found" }], { status: 404 }));
    const recorder = recorders();
    const error = await makeClient(missing, recorder).chat({ model: 'nope', messages }, ctx()).catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'model_missing', status: 404 });
    expect(missing.requests).toHaveLength(1);
    expect(recorder.rows[0].errorClass).toBe('model_missing');
    const bad = await start((_req, res) => writeLines(res, [{ error: 'bad' }], { status: 400 }));
    const second = await makeClient(bad, recorders()).chat({ model: 'm', messages }, ctx()).catch((e) => e);
    expect(second.errorClass).toBe('http_4xx');
    expect(bad.requests).toHaveLength(1);
  });

  it('retries a refused connection and records the failure', async () => {
    const server = await start((_req, res) => writeLines(res, [FINAL]));
    const url = server.url;
    await server.close();
    servers.pop();
    const recorder = recorders();
    const client = createOllamaClient({ baseUrl: url, clock: fixedClock, usage: recorder.usage, activity: recorder.activity, retryDelayMs: 5, timeoutMs: 1000 });
    const error = await client.chat({ model: 'm', messages }, ctx()).catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'unavailable', outcome: 'error', attempts: 2 });
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({ outcome: 'error', errorClass: 'unavailable', attempts: 2 });
    expect(recorder.events).toHaveLength(1);
  });

  it('retries a truncated stream when no tokens were delivered to the caller', async () => {
    const server = await start((_req, res, _entry, count) =>
      count === 1 ? writeLines(res, [token('par')]) : writeLines(res, [token('full'), FINAL])
    );
    const result = await makeClient(server, recorders()).chat({ model: 'm', messages }, ctx());
    expect(result.text).toBe('full');
    expect(result.attempts).toBe(2);
  });

  it('does not retry after tokens were already delivered to the caller', async () => {
    const server = await start((_req, res) => writeLines(res, [token('par')]));
    const recorder = recorders();
    const seen = [];
    const error = await makeClient(server, recorder)
      .chat({ model: 'm', messages, onToken: (piece) => seen.push(piece) }, ctx())
      .catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'bad_response', attempts: 1 });
    expect(server.requests).toHaveLength(1);
    expect(seen).toEqual(['par']);
    expect(recorder.rows[0]).toMatchObject({ outcome: 'error', attempts: 1 });
  });

  it('surfaces in-stream errors without retrying', async () => {
    const server = await start((_req, res) => writeLines(res, [token('a'), { error: 'out of memory' }]));
    const recorder = recorders();
    const error = await makeClient(server, recorder).chat({ model: 'm', messages }, ctx()).catch((e) => e);
    expect(error.errorClass).toBe('http_5xx');
    expect(server.requests).toHaveLength(1);
  });

  it('times out without retrying and records a timeout row', async () => {
    const server = await start(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify(token('slow'))}\n`);
      await delay(500);
      res.end();
    });
    const recorder = recorders();
    const error = await makeClient(server, recorder).chat({ model: 'm', messages, timeoutMs: 80 }, ctx()).catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'timeout', outcome: 'timeout' });
    expect(server.requests).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({ outcome: 'timeout', errorClass: 'timeout' });
    expect(recorder.events[0]).toMatchObject({ level: 'error', ok: false });
  });

  it('cancels mid-stream, aborts the upstream request and records a cancelled row', async () => {
    const server = await start(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify(token('a'))}\n`);
      await delay(1500);
      res.end();
    });
    const recorder = recorders();
    const controller = new AbortController();
    const pending = makeClient(server, recorder).chat(
      { model: 'm', messages, signal: controller.signal, onToken: () => controller.abort() },
      ctx()
    );
    const error = await pending.catch((e) => e);
    expect(error).toMatchObject({ errorClass: 'cancelled', outcome: 'cancelled' });
    await delay(50);
    expect(server.requests[0].closedEarly).toBe(true);
    expect(recorder.rows[0]).toMatchObject({ outcome: 'cancelled', errorClass: 'cancelled' });
    expect(recorder.events[0]).toMatchObject({ level: 'warn', ok: false });
  });

  it('does not contact Ollama when already cancelled but still records the call', async () => {
    const server = await start((_req, res) => writeLines(res, [FINAL]));
    const recorder = recorders();
    const controller = new AbortController();
    controller.abort();
    const error = await makeClient(server, recorder).chat({ model: 'm', messages, signal: controller.signal }, ctx()).catch((e) => e);
    expect(error.errorClass).toBe('cancelled');
    expect(server.requests).toHaveLength(0);
    expect(recorder.rows).toHaveLength(1);
  });

  it('cancels during the retry back-off', async () => {
    const server = await start((_req, res) => writeLines(res, [{ error: 'busy' }], { status: 503 }));
    const controller = new AbortController();
    const client = makeClient(server, recorders(), { retryDelayMs: 500 });
    const pending = client.chat({ model: 'm', messages, signal: controller.signal }, ctx()).catch((e) => e);
    await delay(60);
    controller.abort();
    const error = await pending;
    expect(error.errorClass).toBe('cancelled');
    expect(server.requests).toHaveLength(1);
  });

  it('handles several concurrent calls with separate rows', async () => {
    const server = await start(async (_req, res) => {
      await delay(10);
      writeLines(res, [token('x'), FINAL]);
    });
    const recorder = recorders();
    const client = makeClient(server, recorder);
    await Promise.all([1, 2, 3, 4].map((index) => client.chat({ model: 'm', messages }, ctx({ jobId: `job-${index}` }))));
    expect(recorder.rows.map((row) => row.jobId).sort()).toEqual(['job-1', 'job-2', 'job-3', 'job-4']);
    expect(recorder.events).toHaveLength(4);
  });

  it('keeps working when usage or activity writes fail', async () => {
    const server = await start((_req, res) => writeLines(res, [token('ok'), FINAL]));
    const logs = [];
    const client = createOllamaClient({
      baseUrl: server.url,
      clock: fixedClock,
      usage: { insert: async () => Promise.reject(new Error('db down')) },
      activity: { emit: async () => Promise.reject(new Error('feed down')) },
      logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) }
    });
    const result = await client.chat({ model: 'm', messages }, ctx());
    expect(result.text).toBe('ok');
    expect(result.usageEventId).toBeNull();
    expect(logs).toHaveLength(2);
  });

  it('validates arguments before any call', async () => {
    const server = await start((_req, res) => writeLines(res, [FINAL]));
    const recorder = recorders();
    const client = makeClient(server, recorder);
    await expect(client.chat({ model: 'm', messages }, ctx({ route: 'other' }))).rejects.toThrow(TypeError);
    await expect(client.chat({ model: 'm', messages }, undefined)).rejects.toThrow(TypeError);
    await expect(client.chat({ model: 'm', messages: [] }, ctx())).rejects.toThrow(TypeError);
    await expect(client.chat({ messages }, ctx())).rejects.toThrow(TypeError);
    expect(recorder.rows).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
  });

  it('can downgrade an outcome after external validation', async () => {
    const server = await start((_req, res) => writeLines(res, [token('ok'), FINAL]));
    const recorder = recorders();
    const client = makeClient(server, recorder);
    const result = await client.chat({ model: 'm', messages }, ctx());
    await client.markOutcome(result.usageEventId, 'validator_fail', 'numbers_mismatch');
    expect(recorder.rows[0]).toMatchObject({ outcome: 'validator_fail', errorClass: 'numbers_mismatch' });
    await expect(client.markOutcome(null, 'error')).resolves.toBeUndefined();
  });
});

describe('embed', () => {
  const vectors = [new Array(4).fill(0.25), new Array(4).fill(0.5)];

  it('returns vectors and records an embed row', async () => {
    const server = await start((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'nomic', embeddings: vectors, total_duration: 90000000, load_duration: 10000000, prompt_eval_count: 14, done: true }));
    });
    const recorder = recorders();
    const result = await makeClient(server, recorder).embed(
      { model: 'nomic', input: ['search_document: a', 'search_document: b'], expectDim: 4 },
      ctx({ route: 'embed' })
    );
    expect(result.embeddings).toEqual(vectors);
    expect(server.requests[0]).toMatchObject({ url: '/api/embed', body: { model: 'nomic', input: ['search_document: a', 'search_document: b'] } });
    expect(recorder.rows[0]).toMatchObject({ route: 'embed', outcome: 'ok', promptTokens: 14, totalMs: 90, loadMs: 10 });
    expect(recorder.rows[0].ttftMs).toBeNull();
    expect(recorder.events[0]).toMatchObject({ kind: 'llm_call', action: 'embed' });
  });

  it('rejects mismatched, empty or wrong-dimension responses', async () => {
    const respond = (payload) => (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const cases = [
      { embeddings: [vectors[0]], expectDim: undefined },
      { embeddings: [[], []], expectDim: undefined },
      { embeddings: vectors, expectDim: 768 },
      { embeddings: [[1, 'x', 3], [1, 2, 3]], expectDim: undefined },
      {}
    ];
    for (const entry of cases) {
      const server = await start(respond({ done: true, ...entry }));
      const recorder = recorders();
      const error = await makeClient(server, recorder)
        .embed({ model: 'nomic', input: ['a', 'b'], expectDim: entry.expectDim }, ctx({ route: 'embed' }))
        .catch((e) => e);
      expect(error).toMatchObject({ errorClass: 'bad_response' });
      expect(recorder.rows[0]).toMatchObject({ outcome: 'error', errorClass: 'bad_response' });
    }
  });

  it('validates input', async () => {
    const server = await start((_req, res) => writeLines(res, [FINAL]));
    const client = makeClient(server, recorders());
    await expect(client.embed({ model: 'n', input: '' }, ctx({ route: 'embed' }))).rejects.toThrow(TypeError);
    await expect(client.embed({ model: 'n', input: [] }, ctx({ route: 'embed' }))).rejects.toThrow(TypeError);
    await expect(client.embed({ model: 'n', input: [1] }, ctx({ route: 'embed' }))).rejects.toThrow(TypeError);
    await expect(client.embed({ input: 'a' }, ctx({ route: 'embed' }))).rejects.toThrow(TypeError);
  });
});

describe('probe', () => {
  const GB = 1024 * 1024 * 1024;

  it('normalizes loaded models and installed tags', async () => {
    const server = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/api/ps') {
        res.end(JSON.stringify({ models: [{ name: 'qwen:8b', size: 6 * GB, size_vram: 0, expires_at: '2318-01-01T00:00:00Z' }] }));
      } else {
        res.end(
          JSON.stringify({
            models: [
              { name: 'qwen:8b', size: 5 * GB, modified_at: 't', details: { parameter_size: '8B', quantization_level: 'Q4_K_M' } },
              { name: 'nomic-embed-text:latest', size: GB / 4, details: {} }
            ]
          })
        );
      }
    });
    const probe = createOllamaProbe({ client: makeClient(server, recorders()), clock: fixedClock });
    expect(await probe.ps()).toEqual([{ name: 'qwen:8b', sizeMb: 6144, vramMb: 0, expiresAt: '2318-01-01T00:00:00Z', contextLength: null }]);
    const tags = await probe.tags();
    expect(tags[0]).toMatchObject({ name: 'qwen:8b', parameterSize: '8B', quantization: 'Q4_K_M' });
    expect(await probe.missingModels(['qwen:8b', 'nomic-embed-text', 'llama:3b'])).toEqual(['llama:3b']);
    expect(await probe.health()).toMatchObject({ ok: true, models: 2 });
  });

  it('reports unavailable and slow Ollama', async () => {
    const server = await start(async (_req, res) => {
      await delay(300);
      res.writeHead(200);
      res.end('{}');
    });
    const client = makeClient(server, recorders());
    const probe = createOllamaProbe({ client, clock: fixedClock });
    expect(await probe.health({ timeoutMs: 50 })).toMatchObject({ ok: false, errorClass: 'timeout' });
    const dead = await start((_req, res) => res.end());
    const url = dead.url;
    await dead.close();
    servers.pop();
    const downProbe = createOllamaProbe({ client: createOllamaClient({ baseUrl: url, clock: fixedClock }), clock: fixedClock });
    expect(await downProbe.health()).toMatchObject({ ok: false, errorClass: 'unavailable' });
  });
});
