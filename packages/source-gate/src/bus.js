import { SOURCE_CHANGED_CHANNEL } from './constants.js';

export function createMemoryBus() {
  const handlers = new Map();
  return {
    async publish(channel, message) {
      const payload = JSON.parse(JSON.stringify(message));
      for (const handler of handlers.get(channel) ?? []) {
        try {
          handler(payload);
        } catch {
          continue;
        }
      }
    },
    subscribe(channel, handler) {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => set.delete(handler);
    },
    async close() {
      handlers.clear();
    }
  };
}

export async function createRedisBus({ url, RedisImpl, logger }) {
  const Redis = RedisImpl ?? (await import('ioredis')).default;
  const publisher = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
  const subscriber = new Redis(url, { lazyConnect: false });
  const handlers = new Map();
  publisher.on('error', (error) => logger?.warn?.({ err: error.message }, 'redis bus error'));
  subscriber.on('error', (error) => logger?.warn?.({ err: error.message }, 'redis bus error'));
  subscriber.on('message', (channel, raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    for (const handler of handlers.get(channel) ?? []) {
      try {
        handler(payload);
      } catch {
        continue;
      }
    }
  });

  return {
    async publish(channel, message) {
      await publisher.publish(channel, JSON.stringify(message));
    },
    subscribe(channel, handler) {
      const set = handlers.get(channel) ?? new Set();
      if (set.size === 0) subscriber.subscribe(channel);
      set.add(handler);
      handlers.set(channel, set);
      return () => {
        set.delete(handler);
        if (set.size === 0) subscriber.unsubscribe(channel);
      };
    },
    async close() {
      publisher.disconnect();
      subscriber.disconnect();
    }
  };
}

export function publishSourceChanged(bus, { sourceId, state, at }) {
  return bus.publish(SOURCE_CHANGED_CHANNEL, { sourceId, state, at });
}
