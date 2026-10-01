import { RateLimitedError } from './errors.js';

export function createRowLimiter({
  monotonic = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxWaitMs = 60000
} = {}) {
  const buckets = new Map();

  function bucketFor(sourceId, rowsPerMin) {
    let bucket = buckets.get(sourceId);
    if (!bucket) {
      bucket = { tokens: rowsPerMin, last: monotonic(), capacity: rowsPerMin };
      buckets.set(sourceId, bucket);
    }
    bucket.capacity = rowsPerMin;
    const now = monotonic();
    bucket.tokens = Math.min(
      bucket.capacity,
      bucket.tokens + ((now - bucket.last) * bucket.capacity) / 60000
    );
    bucket.last = now;
    return bucket;
  }

  async function take(sourceId, rows, rowsPerMin) {
    const bucket = bucketFor(sourceId, rowsPerMin);
    const cost = Math.min(Math.max(rows, 0), bucket.capacity);
    bucket.tokens -= cost;
    if (bucket.tokens >= 0) return 0;
    const waitMs = Math.ceil((-bucket.tokens * 60000) / bucket.capacity);
    if (waitMs > maxWaitMs) {
      bucket.tokens += cost;
      throw new RateLimitedError(sourceId, waitMs);
    }
    await sleep(waitMs);
    return waitMs;
  }

  function settle(sourceId, estimated, actual, rowsPerMin) {
    const bucket = bucketFor(sourceId, rowsPerMin);
    const charged = Math.min(Math.max(estimated, 0), bucket.capacity);
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + charged - Math.max(actual, 0));
  }

  return { take, settle };
}
