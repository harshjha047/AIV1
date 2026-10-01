const NS_PER_MS = 1e6;
const NS_PER_S = 1e9;

const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const toMs = (ns) => (number(ns) === null ? null : Math.round((ns / NS_PER_MS) * 100) / 100);
const rate = (count, ns) => {
  const tokens = number(count);
  const duration = number(ns);
  if (tokens === null || duration === null || duration === 0) return null;
  return Math.round((tokens / (duration / NS_PER_S)) * 100) / 100;
};

export function deriveStats(final = {}) {
  return {
    totalMs: toMs(final.total_duration),
    loadMs: toMs(final.load_duration),
    promptEvalMs: toMs(final.prompt_eval_duration),
    evalMs: toMs(final.eval_duration),
    promptTokens: number(final.prompt_eval_count),
    completionTokens: number(final.eval_count),
    decodeTokPerSec: rate(final.eval_count, final.eval_duration),
    promptTokPerSec: rate(final.prompt_eval_count, final.prompt_eval_duration)
  };
}

export function percentile(values, p) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export const median = (values) => percentile(values, 0.5);
