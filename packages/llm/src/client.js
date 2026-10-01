import { createRealClock } from '@fab5/shared/clock';
import { safeMessage } from '@fab5/shared/redact';
import { OllamaError, RemoteInferenceError, classifyHttp } from './errors.js';
import { readNdjson } from './ndjson.js';
import { deriveStats } from './stats.js';
import { ROUTES, activityFor, buildUsageEvent } from './usage.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export function assertLocalUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError('Invalid OLLAMA_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname)) {
    throw new RemoteInferenceError(url.hostname);
  }
  return url.origin;
}

const sleepWithSignal = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new OllamaError('cancelled', 'Cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new OllamaError('cancelled', 'Cancelled'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const pickDefined = (source) => Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));

export function createOllamaClient({
  baseUrl = DEFAULT_OLLAMA_URL,
  fetchImpl = globalThis.fetch,
  clock = createRealClock(),
  usage,
  activity,
  logger,
  textLogging = false,
  timeoutMs = 120000,
  retries = 1,
  retryDelayMs = 250,
  sleep = sleepWithSignal
} = {}) {
  const origin = assertLocalUrl(baseUrl);

  async function post(path, body, { signal, timeoutMs: limit, onChunk }) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limit);
    const forward = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', forward, { once: true });
    }
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw classifyHttp(response.status, await response.text().catch(() => ''));
      let final = null;
      for await (const line of readNdjson(response.body)) {
        if (line.error) throw new OllamaError('http_5xx', safeMessage(String(line.error), 160), { retryable: false });
        await onChunk(line);
        if (line.done === true) final = line;
      }
      if (!final) throw new OllamaError('bad_response', 'Stream ended before completion', { retryable: true });
      return final;
    } catch (error) {
      if (controller.signal.aborted) {
        throw timedOut ? new OllamaError('timeout', 'Ollama request timed out') : new OllamaError('cancelled', 'Cancelled');
      }
      if (error instanceof OllamaError) throw error;
      throw new OllamaError('unavailable', 'Ollama is unavailable', { retryable: true, cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    }
  }

  async function execute({ path, body, signal, timeoutMs: limit = timeoutMs, retries: retryLimit = retries, onChunk, onAttempt }) {
    let attempts = 0;
    const state = { emitted: false };
    for (;;) {
      attempts += 1;
      onAttempt?.();
      try {
        const final = await post(path, body, {
          signal,
          timeoutMs: limit,
          onChunk: async (line) => {
            const emittedNow = await onChunk(line);
            if (emittedNow) state.emitted = true;
          }
        });
        return { final, attempts };
      } catch (error) {
        const canRetry = error instanceof OllamaError && error.retryable && !state.emitted && attempts <= retryLimit;
        if (!canRetry) {
          error.attempts = attempts;
          throw error;
        }
        await sleep(retryDelayMs * attempts, signal);
      }
    }
  }

  async function record({ ctx, model, stats, attempts, outcome, errorClass, startedAt, ttftMs, text }) {
    const doc = buildUsageEvent({
      ts: clock.now(),
      ctx,
      model,
      stats,
      attempts,
      outcome,
      errorClass,
      elapsedMs: clock.monotonic() - startedAt,
      ttftMs,
      text,
      textLogging
    });
    let usageId = null;
    try {
      usageId = (await usage?.insert(doc)) ?? null;
    } catch (error) {
      logger?.error?.({ err: safeMessage(error.message, 160) }, 'llm usage write failed');
    }
    try {
      await activity?.emit(activityFor(doc, usageId));
    } catch (error) {
      logger?.warn?.({ err: safeMessage(error.message, 160) }, 'llm activity emit failed');
    }
    return usageId;
  }

  function validateContext(ctx) {
    if (!ctx || !ROUTES.includes(ctx.route)) throw new TypeError(`route must be one of ${ROUTES.join(', ')}`);
  }

  async function chat(request, ctx) {
    validateContext(ctx);
    if (!request?.model || !Array.isArray(request.messages) || request.messages.length === 0) {
      throw new TypeError('model and messages are required');
    }
    const startedAt = clock.monotonic();
    let ttftMs = null;
    let text = '';
    let attemptStart = startedAt;
    let attempts = 1;
    let stats = deriveStats();
    let outcome = 'ok';
    let errorClass;
    let failure = null;
    let parsed;
    const body = pickDefined({
      model: request.model,
      messages: request.messages,
      stream: true,
      format: request.format,
      options: request.options,
      think: request.think,
      keep_alive: request.keepAlive
    });
    try {
      const result = await execute({
        path: '/api/chat',
        body,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
        retries: request.retries,
        onAttempt: () => {
          text = '';
          ttftMs = null;
          attemptStart = clock.monotonic();
        },
        onChunk: async (line) => {
          const piece = line.message?.content ?? '';
          if (!piece) return false;
          if (ttftMs === null) ttftMs = clock.monotonic() - attemptStart;
          text += piece;
          if (request.onToken) await request.onToken(piece);
          return Boolean(request.onToken);
        }
      });
      attempts = result.attempts;
      stats = deriveStats(result.final);
      if (request.format && typeof request.format === 'object') {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw Object.assign(new OllamaError('invalid_json', 'Model output is not valid JSON'), { attempts });
        }
      }
    } catch (error) {
      failure = error instanceof OllamaError ? error : new OllamaError('unavailable', 'Unexpected LLM failure', { cause: error });
      attempts = failure.attempts ?? attempts;
      outcome = failure.outcome;
      errorClass = failure.errorClass;
    }
    const usageEventId = await record({
      ctx,
      model: request.model,
      stats,
      attempts,
      outcome,
      errorClass,
      startedAt,
      ttftMs,
      text: { prompt: request.messages.map((entry) => `${entry.role}: ${entry.content}`).join('\n'), answer: text }
    });
    if (failure) {
      failure.usageEventId = usageEventId;
      throw failure;
    }
    return { text, json: parsed, stats: { ...stats, ttftMs: ttftMs === null ? null : Math.round(ttftMs) }, attempts, outcome, usageEventId, model: request.model };
  }

  async function embed(request, ctx) {
    validateContext(ctx);
    const inputs = Array.isArray(request?.input) ? request.input : [request?.input];
    if (!request?.model || inputs.length === 0 || inputs.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
      throw new TypeError('model and non-empty string input are required');
    }
    const startedAt = clock.monotonic();
    let attempts = 1;
    let stats = deriveStats();
    let outcome = 'ok';
    let errorClass;
    let failure = null;
    let embeddings = null;
    const body = pickDefined({
      model: request.model,
      input: inputs,
      truncate: request.truncate,
      keep_alive: request.keepAlive
    });
    try {
      const result = await execute({
        path: '/api/embed',
        body,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
        retries: request.retries,
        onChunk: async () => false
      });
      attempts = result.attempts;
      stats = deriveStats(result.final);
      embeddings = result.final.embeddings;
      const valid =
        Array.isArray(embeddings) &&
        embeddings.length === inputs.length &&
        embeddings.every(
          (vector) =>
            Array.isArray(vector) &&
            vector.length > 0 &&
            (request.expectDim === undefined || vector.length === request.expectDim) &&
            vector.every(Number.isFinite)
        );
      if (!valid) throw Object.assign(new OllamaError('bad_response', 'Unexpected embedding response'), { attempts });
    } catch (error) {
      failure = error instanceof OllamaError ? error : new OllamaError('unavailable', 'Unexpected LLM failure', { cause: error });
      attempts = failure.attempts ?? attempts;
      outcome = failure.outcome;
      errorClass = failure.errorClass;
    }
    const usageEventId = await record({ ctx, model: request.model, stats, attempts, outcome, errorClass, startedAt, ttftMs: null });
    if (failure) {
      failure.usageEventId = usageEventId;
      throw failure;
    }
    return { embeddings, stats, attempts, outcome, usageEventId, model: request.model };
  }

  async function markOutcome(usageEventId, outcome, errorClass) {
    if (usageEventId === null || usageEventId === undefined) return;
    const patch = { outcome };
    if (errorClass) patch.errorClass = errorClass;
    await usage?.update?.(usageEventId, patch);
  }

  async function getJson(path, { timeoutMs: limit = 3000, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    const forward = () => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    try {
      const response = await fetchImpl(`${origin}${path}`, { signal: controller.signal });
      if (!response.ok) throw classifyHttp(response.status, await response.text().catch(() => ''));
      return await response.json();
    } catch (error) {
      if (error instanceof OllamaError) throw error;
      if (controller.signal.aborted) throw new OllamaError('timeout', 'Ollama probe timed out');
      throw new OllamaError('unavailable', 'Ollama is unavailable', { retryable: true, cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    }
  }

  async function unload(model, { timeoutMs: limit = 5000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      const response = await fetchImpl(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: controller.signal
      });
      await response.text().catch(() => '');
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return { chat, embed, markOutcome, getJson, unload, baseUrl: origin };
}
