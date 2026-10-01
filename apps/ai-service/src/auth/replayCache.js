export function createMemoryReplayCache({ clock }) {
  const seen = new Map();
  return {
    async claim(key, ttlSeconds) {
      const now = clock.now().getTime();
      for (const [entry, expires] of seen) if (expires <= now) seen.delete(entry);
      if (seen.has(key)) return false;
      seen.set(key, now + ttlSeconds * 1000);
      return true;
    },
    size: () => seen.size
  };
}

export function createRedisReplayCache({ redis, prefix = 'ai:replay:' }) {
  return {
    async claim(key, ttlSeconds) {
      const result = await redis.set(`${prefix}${key}`, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    }
  };
}
