import { createRealClock } from '@fab5/shared/clock';
import { median, percentile } from '../stats.js';
import { EMBED_PAIRS, SAMPLE_FACT_SETS } from './facts.js';
import { COMMENTARY_SCHEMA, commentaryMessages, decodeMessages, prefillMessages } from './prompts.js';
import { cosine, scoreCommentary } from './score.js';

const ROUTE = { small: 'live_small', large: 'live_large', embed: 'embed' };
const ROLE_OPTIONS = {
  small: { num_ctx: 4096, num_predict: 120, num_thread: 2 },
  large: { num_ctx: 8192, num_predict: 300, num_thread: 2 }
};

export const normalizeCandidate = (entry) => (typeof entry === 'string' ? { tag: entry } : entry);

const mean = (values) => (values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000);
const rounded = (value) => (value === null ? null : Math.round(value * 100) / 100);

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, errorClass: error.errorClass ?? error.name ?? 'error' };
  }
}

export async function benchmarkChatModel({ client, probe, os, candidate, role, runs, prefillTokens, decodeTokens, factSets, nonce }) {
  const { tag } = candidate;
  const base = { think: candidate.think, keepAlive: '10m', retries: 0, timeoutMs: 600000 };
  const memBefore = os.freeMb();
  const warm = await attempt(() =>
    client.chat({ ...base, model: tag, messages: [{ role: 'user', content: 'Reply with ok.' }], options: { num_predict: 4, num_ctx: 2048 } }, { route: ROUTE[role] })
  );
  if (!warm.ok) return { tag, role, status: 'failed', errorClass: warm.errorClass };
  const loaded = (await attempt(() => probe.ps())).value ?? [];
  const resident = loaded.find((entry) => entry.name === tag || entry.name === `${tag}:latest`) ?? null;
  const memAfter = os.freeMb();

  const prefill = [];
  for (let index = 0; index < runs; index += 1) {
    const result = await attempt(() =>
      client.chat({ ...base, model: tag, messages: prefillMessages(prefillTokens, `${nonce}-${tag}-p${index}`), options: { num_predict: 1, num_ctx: 8192, num_thread: ROLE_OPTIONS[role].num_thread } }, { route: ROUTE[role] })
    );
    if (result.ok) prefill.push(result.value.stats.promptTokPerSec);
  }

  const decode = [];
  for (let index = 0; index < runs; index += 1) {
    const result = await attempt(() =>
      client.chat({ ...base, model: tag, messages: decodeMessages(`${nonce}-${tag}-d${index}`), options: { num_predict: decodeTokens, num_ctx: 4096, temperature: 0.1, num_thread: ROLE_OPTIONS[role].num_thread } }, { route: ROUTE[role] })
    );
    if (result.ok) decode.push(result.value.stats.decodeTokPerSec);
  }

  const quality = [];
  const ttft = [];
  const total = [];
  let failures = 0;
  for (const fact of factSets) {
    for (let index = 0; index < runs; index += 1) {
      const result = await attempt(() =>
        client.chat(
          { ...base, model: tag, messages: commentaryMessages(fact), format: COMMENTARY_SCHEMA, options: { temperature: 0.1, ...ROLE_OPTIONS[role] } },
          { route: ROUTE[role] }
        )
      );
      if (!result.ok) {
        failures += 1;
        quality.push({ schemaValid: false, grounded: false, flagsValid: false, lengthOk: false, score: 0, errorClass: result.errorClass });
        continue;
      }
      ttft.push(result.value.stats.ttftMs);
      total.push(result.value.stats.totalMs);
      quality.push(scoreCommentary(result.value.json, fact));
    }
  }
  const calls = quality.length;
  const rate = (key) => (calls === 0 ? null : Math.round((quality.filter((entry) => entry[key]).length / calls) * 1000) / 1000);
  return {
    tag,
    role,
    status: 'ok',
    memory: {
      modelMb: resident?.sizeMb ?? null,
      vramMb: resident?.vramMb ?? null,
      hostFreeDropMb: Math.max(0, Math.round(memBefore - memAfter))
    },
    loadMs: rounded(warm.value.stats.loadMs),
    prefillTokPerSec: rounded(median(prefill)),
    decodeTokPerSec: rounded(median(decode)),
    ttftMs: { p50: rounded(percentile(ttft, 0.5)), p95: rounded(percentile(ttft, 0.95)) },
    totalMs: { p50: rounded(percentile(total, 0.5)), p95: rounded(percentile(total, 0.95)) },
    quality: {
      score: mean(quality.map((entry) => entry.score)),
      schemaValidRate: rate('schemaValid'),
      groundingRate: rate('grounded'),
      flagsValidRate: rate('flagsValid'),
      failureRate: calls === 0 ? null : Math.round((failures / calls) * 1000) / 1000,
      calls
    },
    samples: { prefill: prefill.length, decode: decode.length }
  };
}

export async function benchmarkEmbedModel({ client, probe, os, candidate, runs, expectDim }) {
  const { tag } = candidate;
  const memBefore = os.freeMb();
  const texts = EMBED_PAIRS.flatMap((pair) => [`search_query: ${pair.query}`, ...pair.documents.map((doc) => `search_document: ${doc}`)]);
  const warm = await attempt(() => client.embed({ model: tag, input: texts, keepAlive: '10m', retries: 0, timeoutMs: 600000 }, { route: 'embed' }));
  if (!warm.ok) return { tag, role: 'embed', status: 'failed', errorClass: warm.errorClass };
  const loaded = (await attempt(() => probe.ps())).value ?? [];
  const resident = loaded.find((entry) => entry.name === tag || entry.name === `${tag}:latest`) ?? null;
  const memAfter = os.freeMb();
  const totals = [];
  for (let index = 0; index < runs; index += 1) {
    const result = await attempt(() => client.embed({ model: tag, input: texts, retries: 0, timeoutMs: 600000 }, { route: 'embed' }));
    if (result.ok) totals.push(result.value.stats.totalMs);
  }
  const vectors = warm.value.embeddings;
  let hits = 0;
  let offset = 0;
  for (const pair of EMBED_PAIRS) {
    const query = vectors[offset];
    const scores = pair.documents.map((_, index) => cosine(query, vectors[offset + 1 + index]));
    if (scores.indexOf(Math.max(...scores)) === pair.answer) hits += 1;
    offset += 1 + pair.documents.length;
  }
  const dim = vectors[0].length;
  return {
    tag,
    role: 'embed',
    status: 'ok',
    dim,
    dimOk: expectDim === undefined ? true : dim === expectDim,
    memory: { modelMb: resident?.sizeMb ?? null, vramMb: resident?.vramMb ?? null, hostFreeDropMb: Math.max(0, Math.round(memBefore - memAfter)) },
    loadMs: rounded(warm.value.stats.loadMs),
    batchTotalMs: { p50: rounded(percentile(totals, 0.5)), p95: rounded(percentile(totals, 0.95)) },
    textsPerBatch: texts.length,
    retrievalAt1: Math.round((hits / EMBED_PAIRS.length) * 1000) / 1000
  };
}

export async function runBenchmark({
  client,
  probe,
  os,
  candidates,
  roles = ['small', 'large', 'embed'],
  runs = 3,
  prefillTokens = 1500,
  decodeTokens = 200,
  factSets = SAMPLE_FACT_SETS,
  expectEmbedDim = 768,
  nonce = 'bench',
  now = createRealClock().now,
  log = () => {}
}) {
  const results = [];
  for (const role of roles) {
    const list = (candidates[role] ?? []).map(normalizeCandidate);
    const missing = new Set(await probe.missingModels(list.map((entry) => entry.tag)));
    for (const candidate of list) {
      if (missing.has(candidate.tag)) {
        log(`skip ${candidate.tag}: not installed`);
        results.push({ tag: candidate.tag, role, status: 'skipped', reason: 'not_installed' });
        continue;
      }
      log(`bench ${role} ${candidate.tag}`);
      const outcome =
        role === 'embed'
          ? await benchmarkEmbedModel({ client, probe, os, candidate, runs, expectDim: expectEmbedDim })
          : await benchmarkChatModel({ client, probe, os, candidate, role, runs, prefillTokens, decodeTokens, factSets, nonce });
      results.push(outcome);
      await client.unload(candidate.tag);
    }
  }
  return {
    generatedAt: now().toISOString(),
    host: os.describe(),
    settings: { runs, prefillTokens, decodeTokens, factSets: factSets.length },
    note: 'Laptop baselines are not production targets.',
    results
  };
}
