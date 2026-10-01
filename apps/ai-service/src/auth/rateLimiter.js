const WINDOW_MS = 60000;

function windowOf(clock) {
  const now = clock.now().getTime();
  const bucket = Math.floor(now / WINDOW_MS);
  return { bucket, resetMs: (bucket + 1) * WINDOW_MS - now };
}

export function createMemoryRateLimiter({ clock }) {
  const counters = new Map();
  return {
    async hit(key, limit) {
      const { bucket, resetMs } = windowOf(clock);
      for (const [entry, value] of counters) if (value.bucket < bucket) counters.delete(entry);
      const current = counters.get(key);
      const count = current && current.bucket === bucket ? current.count + 1 : 1;
      counters.set(key, { bucket, count });
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetMs };
    }
  };
}

export function createRedisRateLimiter({ redis, clock, prefix = 'ai:rl:' }) {
  return {
    async hit(key, limit) {
      const { bucket, resetMs } = windowOf(clock);
      const redisKey = `${prefix}${key}:${bucket}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, 120);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetMs };
    }
  };
}
