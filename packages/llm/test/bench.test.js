import { afterEach, describe, expect, it } from 'vitest';
import { createOllamaClient } from '../src/client.js';
import { createOllamaProbe } from '../src/probe.js';
import { EMBED_PAIRS, SAMPLE_FACT_SETS, formatInr } from '../src/bench/facts.js';
import { commentaryMessages, prefillMessages } from '../src/bench/prompts.js';
import { runBenchmark } from '../src/bench/run.js';
import { allowedNumbers, cosine, extractNumbers, groundingCheck, scoreCommentary, validateCommentary } from '../src/bench/score.js';
import { DEFAULT_GATES, renderEnv, renderMarkdown, selectPins } from '../src/bench/select.js';
import { createHostInfo } from '../src/bench/host.js';
import { fixedClock } from './helpers.js';
import http from 'node:http';

const GB = 1024 * 1024 * 1024;

describe('facts and formatting', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatInr(1234500)).toBe('₹12,34,500');
    expect(formatInr(980000)).toBe('₹9,80,000');
    expect(formatInr(999)).toBe('₹999');
    expect(formatInr(12345.5)).toBe('₹12,345.50');
    expect(formatInr(-4521000)).toBe('-₹45,21,000');
  });

  it('builds prompts from facts and unique prefill prompts', () => {
    const fact = SAMPLE_FACT_SETS[0];
    const messages = commentaryMessages(fact);
    expect(messages[1].content).toContain('Monthly recurring revenue added: ₹12,34,500');
    expect(messages[1].content).toContain('Allowed flags: NO_TARGET');
    expect(commentaryMessages(SAMPLE_FACT_SETS[1])[1].content).toContain('Allowed flags: none');
    const a = prefillMessages(1500, 'a');
    const b = prefillMessages(1500, 'b');
    expect(a[0].content).not.toBe(b[0].content);
    expect(a[1].content.length).toBeGreaterThan(5000);
  });
});

describe('scoring', () => {
  const fact = SAMPLE_FACT_SETS[0];

  it('extracts numbers with grouping and decimals', () => {
    expect(extractNumbers('₹12,34,500 up 4.5% on 37 deals in 2026-08')).toEqual([1234500, 4.5, 37, 2026, 8]);
    expect(extractNumbers('no digits')).toEqual([]);
  });

  it('accepts values from the facts, rounded values and lakh forms', () => {
    expect(groundingCheck('Added ₹12,34,500, about 12.3 lakh, at 82.5% of target', fact).ungrounded).toEqual([]);
    expect(groundingCheck('Sold 1,840 Mbps across 37 connections in 2026-08', fact).ungrounded).toEqual([]);
    expect(groundingCheck('Attainment of 82.5 percent', fact).ungrounded).toEqual([]);
  });

  it('flags invented numbers', () => {
    expect(groundingCheck('Revenue reached ₹15,00,000 from 52 connections', fact).ungrounded).toEqual([1500000, 52]);
    expect(allowedNumbers(fact).exact.has(2026)).toBe(true);
  });

  it('validates the commentary shape and flags', () => {
    expect(validateCommentary({ commentary: 'x', flags: ['NO_TARGET'] }, fact)).toEqual([]);
    expect(validateCommentary({ commentary: 'x', flags: ['SOURCE_STALE'] }, fact)).toEqual(['flag_not_allowed']);
    expect(validateCommentary({ commentary: '', flags: [] }, fact)).toEqual(['commentary']);
    expect(validateCommentary({ commentary: 'x', flags: 'a' }, fact)).toEqual(['flags']);
    expect(validateCommentary({ commentary: 'x', flags: [], extra: 1 }, fact)).toEqual(['extra_fields']);
    expect(validateCommentary(null, fact)).toEqual(['not_object']);
    expect(validateCommentary([], fact)).toEqual(['not_object']);
  });

  it('scores a perfect, ungrounded and malformed output', () => {
    expect(scoreCommentary({ commentary: 'Added ₹12,34,500 this month.', flags: [] }, fact)).toMatchObject({ schemaValid: true, grounded: true, flagsValid: true, lengthOk: true, score: 1 });
    expect(scoreCommentary({ commentary: 'Added ₹99,99,999.', flags: [] }, fact)).toMatchObject({ grounded: false, score: 0.6 });
    expect(scoreCommentary({ commentary: 'ok', flags: ['BAD'] }, fact)).toMatchObject({ flagsValid: false, score: 0.8 });
    expect(scoreCommentary('nope', fact)).toMatchObject({ schemaValid: false, score: 0 });
    expect(scoreCommentary({ commentary: 'word '.repeat(90), flags: [] }, fact)).toMatchObject({ lengthOk: false, score: 0.9 });
  });

  it('computes cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

const servers = [];
afterEach(async () => {
  while (servers.length > 0) await new Promise((resolve) => servers.pop().close(resolve));
});

function fakeVectors(texts) {
  return texts.map((text) => {
    const vector = new Array(8).fill(0);
    for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let hash = 0;
      for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 8;
      vector[hash] += 1;
    }
    return vector;
  });
}

async function startFake({ installed, behaviors, loaded = [] }) {
  const unloaded = [];
  const chatCalls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: installed.map((name) => ({ name, size: GB, details: {} })) }));
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: loaded.map((name) => ({ name, size: 5 * GB, size_vram: 0 })) }));
    if (req.url === '/api/generate') {
      unloaded.push(body.model);
      return res.end(JSON.stringify({ done: true }));
    }
    if (req.url === '/api/embed') {
      const behavior = behaviors[body.model];
      if (behavior === 'fail') {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: 'boom' }));
      }
      const dim = behavior === 'wrongdim' ? 4 : 8;
      let vectors = fakeVectors(body.input.map((text) => text.replace(/^search_(query|document): /, '')));
      if (dim === 4) vectors = vectors.map((vector) => vector.slice(0, 4));
      return res.end(JSON.stringify({ done: true, embeddings: vectors, total_duration: 50000000, load_duration: 5000000, prompt_eval_count: 10 }));
    }
    if (req.url === '/api/chat') {
      chatCalls.push(body);
      const behavior = behaviors[body.model];
      if (behavior === 'fail') {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: 'boom' }));
      }
      res.setHeader('content-type', 'application/x-ndjson');
      const userText = body.messages.at(-1).content;
      let content = 'ok';
      if (body.format) {
        const line = /- (.+?): (.+)/.exec(userText);
        const flags = /Allowed flags: (.+)/.exec(userText)?.[1];
        if (behavior === 'good') content = JSON.stringify({ commentary: `${line[1]} is ${line[2]}.`, flags: flags === 'none' ? [] : [flags.split(', ')[0]] });
        else if (behavior === 'bad') content = JSON.stringify({ commentary: `${line[1]} is 99999999.`, flags: [] });
        else content = 'not json at all';
      }
      const speed = behavior === 'slow' ? 10 : 50;
      res.write(`${JSON.stringify({ message: { role: 'assistant', content }, done: false })}\n`);
      res.end(`${JSON.stringify({ done: true, message: { role: 'assistant', content: '' }, total_duration: 1000000000, load_duration: 200000000, prompt_eval_count: 100, prompt_eval_duration: 500000000, eval_count: speed, eval_duration: 1000000000 })}\n`);
      return undefined;
    }
    res.statusCode = 404;
    return res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const client = createOllamaClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, clock: fixedClock, retries: 0 });
  return { client, probe: createOllamaProbe({ client, clock: fixedClock }), unloaded, chatCalls };
}

const fakeOs = () => {
  let free = 16000;
  return {
    freeMb: () => {
      free -= 100;
      return free;
    },
    describe: () => ({ platform: 'test', cpuModel: 'cpu', cores: 8, totalMb: 16384 })
  };
};

describe('benchmark run', () => {
  const candidates = {
    small: [{ tag: 'good-small', think: false }, 'bad-small', 'broken-small', 'missing-small'],
    large: ['good-large', 'slow-large'],
    embed: ['embed-ok', 'embed-wrongdim', 'embed-fail']
  };
  const behaviors = {
    'good-small': 'good',
    'bad-small': 'bad',
    'broken-small': 'broken',
    'good-large': 'good',
    'slow-large': 'good',
    'embed-ok': 'ok',
    'embed-wrongdim': 'wrongdim',
    'embed-fail': 'fail'
  };
  const installed = Object.keys(behaviors);

  it('measures every installed candidate, skips missing ones and unloads each model', async () => {
    const { client, probe, unloaded, chatCalls } = await startFake({ installed, behaviors, loaded: ['good-small', 'good-large', 'slow-large', 'bad-small', 'broken-small', 'embed-ok'] });
    const logs = [];
    const report = await runBenchmark({ client, probe, os: fakeOs(), candidates, runs: 2, prefillTokens: 200, decodeTokens: 20, expectEmbedDim: 8, now: () => new Date('2026-10-01T00:00:00Z'), log: (line) => logs.push(line) });
    const by = Object.fromEntries(report.results.map((entry) => [entry.tag, entry]));
    expect(report.generatedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(by['missing-small']).toEqual({ tag: 'missing-small', role: 'small', status: 'skipped', reason: 'not_installed' });
    expect(by['good-small']).toMatchObject({ status: 'ok', prefillTokPerSec: 200, decodeTokPerSec: 50, memory: { modelMb: 5120 } });
    expect(by['good-small'].quality).toMatchObject({ score: 1, groundingRate: 1, schemaValidRate: 1, failureRate: 0, calls: 12 });
    expect(by['bad-small'].quality).toMatchObject({ groundingRate: 0, schemaValidRate: 1 });
    expect(by['bad-small'].quality.score).toBeCloseTo(0.6, 5);
    expect(by['broken-small'].quality).toMatchObject({ schemaValidRate: 0, failureRate: 1, score: 0 });
    expect(by['embed-ok']).toMatchObject({ status: 'ok', dim: 8, dimOk: true });
    expect(by['embed-ok'].retrievalAt1).toBeGreaterThan(0);
    expect(by['embed-wrongdim']).toMatchObject({ status: 'ok', dimOk: false });
    expect(by['embed-fail']).toMatchObject({ status: 'failed', errorClass: 'http_5xx' });
    expect(unloaded.sort()).toEqual([...installed].sort());
    expect(logs).toContain('skip missing-small: not installed');
    const think = chatCalls.filter((call) => call.model === 'good-small').every((call) => call.think === false);
    expect(think).toBe(true);
    const structured = chatCalls.find((call) => call.format);
    expect(structured.options).toMatchObject({ temperature: 0.1, num_ctx: 4096, num_predict: 120, num_thread: 2 });
    expect(chatCalls.find((call) => call.model === 'good-large' && call.format).options).toMatchObject({ num_ctx: 8192, num_predict: 300 });
  });

  it('selects pins by gates and speed or quality', async () => {
    const speedBehaviors = { ...behaviors, 'slow-large': 'good' };
    const { client, probe } = await startFake({ installed, behaviors: speedBehaviors });
    const report = await runBenchmark({ client, probe, os: fakeOs(), candidates, runs: 1, prefillTokens: 100, decodeTokens: 10, expectEmbedDim: 8 });
    const selection = selectPins(report);
    expect(selection.pins).toEqual({ MODEL_SMALL: 'good-small', MODEL_LARGE: expect.stringMatching(/good-large|slow-large/), MODEL_EMBED: 'embed-ok' });
    expect(selection.reasons.MODEL_SMALL).toBe('fastest decode among 1 passing');
    const env = renderEnv(selection.pins);
    expect(env).toContain('MODEL_SMALL=good-small');
    expect(env).toContain('MODEL_EMBED=embed-ok');
    const markdown = renderMarkdown(report, selection);
    expect(markdown).toContain('| small | good-small | ok |');
    expect(markdown).toContain('skipped (not_installed)');
    expect(markdown).toContain('- MODEL_SMALL: good-small');
    expect(markdown).toContain('Laptop baselines are not production targets.');
  });

  it('returns no pin when nothing passes and omits it from the env file', () => {
    const report = {
      results: [
        { role: 'small', tag: 'a', status: 'ok', decodeTokPerSec: 40, quality: { score: 0.5, groundingRate: 0.4, schemaValidRate: 1, failureRate: 0 } },
        { role: 'large', tag: 'b', status: 'failed' },
        { role: 'embed', tag: 'c', status: 'ok', dimOk: false, retrievalAt1: 1, batchTotalMs: { p50: 1 } }
      ]
    };
    const selection = selectPins(report, DEFAULT_GATES);
    expect(selection.pins).toEqual({ MODEL_SMALL: null, MODEL_LARGE: null, MODEL_EMBED: null });
    expect(selection.reasons.MODEL_SMALL).toBe('no passing candidate');
    expect(renderEnv(selection.pins)).toBe('\n');
  });

  it('prefers the fastest passing small model and the best passing large model', () => {
    const quality = (score) => ({ score, groundingRate: 1, schemaValidRate: 1, failureRate: 0 });
    const report = {
      results: [
        { role: 'small', tag: 'slow', status: 'ok', decodeTokPerSec: 10, quality: quality(1) },
        { role: 'small', tag: 'fast', status: 'ok', decodeTokPerSec: 30, quality: quality(0.9) },
        { role: 'small', tag: 'fastest-bad', status: 'ok', decodeTokPerSec: 99, quality: quality(0.4) },
        { role: 'large', tag: 'l1', status: 'ok', decodeTokPerSec: 5, quality: quality(0.9) },
        { role: 'large', tag: 'l2', status: 'ok', decodeTokPerSec: 3, quality: quality(0.95) },
        { role: 'embed', tag: 'e1', status: 'ok', dimOk: true, retrievalAt1: 1, batchTotalMs: { p50: 20 } },
        { role: 'embed', tag: 'e2', status: 'ok', dimOk: true, retrievalAt1: 1, batchTotalMs: { p50: 10 } }
      ]
    };
    expect(selectPins(report).pins).toEqual({ MODEL_SMALL: 'fast', MODEL_LARGE: 'l2', MODEL_EMBED: 'e2' });
  });

  it('describes the host', () => {
    const host = createHostInfo({
      freemem: () => 2 * 1024 * 1024 * 1024,
      totalmem: () => 8 * 1024 * 1024 * 1024,
      platform: () => 'linux',
      release: () => '6.1',
      cpus: () => [{ model: 'X' }, { model: 'X' }]
    });
    expect(host.freeMb()).toBe(2048);
    expect(host.describe()).toEqual({ platform: 'linux 6.1', cpuModel: 'X', cores: 2, totalMb: 8192 });
    expect(EMBED_PAIRS).toHaveLength(3);
  });
});
