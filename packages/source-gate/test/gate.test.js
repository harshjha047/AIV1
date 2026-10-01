import { describe, expect, it } from 'vitest';
import { RateLimitedError, SourceDisabledError, SourceRegistryError } from '../src/errors.js';
import { createHarness, page, sourceDoc } from './helpers.js';

describe('gate.read on an active source', () => {
  it('returns the value, logs a read_page row, and reuses one client', async () => {
    const h = createHarness();
    const first = await h.gate.read('crm', page(3), { entity: 'connections', triggeredBy: 'manual' });
    await h.gate.read('crm', page(2), { entity: 'connections' });
    expect(first).toEqual([0, 1, 2]);
    expect(h.engine.connects).toBe(1);
    const rows = h.accessRows.filter((row) => row.action === 'read_page');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sourceId: 'crm', entity: 'connections', rows: 3, ok: true });
    expect(rows[0].stateAtRead).toBe('active');
  });

  it('passes limits and an abort signal to the callback', async () => {
    const h = createHarness();
    let seen;
    await h.gate.read('crm', async (_client, ctx) => {
      seen = ctx;
      return { value: null, rows: 0 };
    });
    expect(seen.limits).toEqual({ pageSize: 500, maxTimeMs: 30000, rowsPerMin: 20000 });
    expect(seen.signal.aborted).toBe(false);
  });

  it('logs failures without leaking credentials', async () => {
    const h = createHarness();
    await expect(
      h.gate.read('crm', async () => {
        throw new Error('connect failed mongodb://ai_ro:pw@h/db password=secret1');
      })
    ).rejects.toThrow('connect failed');
    const row = h.accessRows.find((r) => r.ok === false);
    expect(row.error).not.toContain('ai_ro:pw');
    expect(row.error).not.toContain('secret1');
  });
});

describe('gate.read on inactive sources', () => {
  it.each(['not_configured', 'paused', 'disabled'])('blocks %s and logs blocked', async (state) => {
    const h = createHarness({ sources: [sourceDoc({ state })] });
    const fn = async () => ({ value: 1, rows: 1 });
    await expect(h.gate.read('crm', fn, { entity: 'connections' })).rejects.toThrow(
      SourceDisabledError
    );
    expect(h.engine.connects).toBe(0);
    expect(h.accessRows).toHaveLength(1);
    expect(h.accessRows[0]).toMatchObject({ action: 'blocked', stateAtRead: state, ok: false });
    expect(h.activityRows.some((event) => event.kind === 'blocked')).toBe(true);
    expect(h.accessRows.filter((row) => row.action === 'read_page')).toHaveLength(0);
  });

  it('fails closed when the registry cannot be read', async () => {
    const h = createHarness();
    await h.gate.read('crm', page());
    h.store.failing = true;
    h.clock.advance(5001);
    let called = false;
    await expect(
      h.gate.read('crm', async () => {
        called = true;
        return { value: 1, rows: 1 };
      })
    ).rejects.toThrow(SourceRegistryError);
    expect(called).toBe(false);
  });

  it('fails closed for unknown sources', async () => {
    const h = createHarness();
    await expect(h.gate.read('missing', page())).rejects.toThrow('not registered');
  });
});

describe('state propagation', () => {
  it('is effective immediately with bus invalidation', async () => {
    const h = createHarness();
    await h.gate.read('crm', page());
    h.store.docs.get('crm').state = 'paused';
    await h.bus.publish('ai:source:changed', { sourceId: 'crm', state: 'paused' });
    await expect(h.gate.read('crm', page())).rejects.toThrow(SourceDisabledError);
  });

  it('is effective within the TTL without a bus', async () => {
    const h = createHarness({ ttlMs: 5000 });
    h.registry.stop();
    await h.gate.read('crm', page());
    h.store.docs.get('crm').state = 'disabled';
    h.clock.advance(4000);
    await expect(h.gate.read('crm', page())).resolves.toBeDefined();
    h.clock.advance(1001);
    await expect(h.gate.read('crm', page())).rejects.toThrow(SourceDisabledError);
  });

  it('a subscribed gate leaves active when another process announces a change', async () => {
    const h = createHarness();
    h.gate.subscribe(h.bus);
    await h.gate.read('crm', page());
    h.store.docs.get('crm').state = 'paused';
    await h.bus.publish('ai:source:changed', { sourceId: 'crm', state: 'paused' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.engine.clients[0].closed).toBe(true);
    expect(h.vault.holds('crm')).toBe(false);
    expect(h.queue.cancelled).toEqual(['crm']);
  });
});

describe('leaveActive', () => {
  it('closes the client, wipes credentials, cancels queued jobs, and reports the pool', async () => {
    const h = createHarness();
    await h.gate.read('crm', page());
    expect(h.vault.holds('crm')).toBe(true);
    const result = await h.gate.leaveActive('crm', 'paused');
    expect(result.cancelledJobs).toBe(3);
    expect(h.engine.clients[0].closed).toBe(true);
    expect(h.vault.holds('crm')).toBe(false);
    expect(h.queue.cancelled).toEqual(['crm']);
    expect(h.gate.poolState('crm')).toEqual({ state: 'closed', size: 0 });
    expect(h.store.docs.get('crm').pools['ai-service']).toMatchObject({ state: 'closed', size: 0 });
    expect(
      h.activityRows.some((event) => event.kind === 'toggle' && event.action === 'pool_closed')
    ).toBe(true);
  });

  it('aborts an in-flight read and writes no successful read row afterwards', async () => {
    const h = createHarness();
    await h.gate.read('crm', page());
    const before = h.accessRows.length;
    const pending = h.gate.read('crm', () => new Promise(() => {}), { entity: 'connections' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.store.docs.get('crm').state = 'paused';
    h.registry.invalidate('crm');
    await h.gate.leaveActive('crm', 'paused');
    await expect(pending).rejects.toThrow(SourceDisabledError);
    const added = h.accessRows.slice(before);
    expect(added.every((row) => row.action === 'blocked')).toBe(true);
    expect(added.some((row) => row.action === 'read_page')).toBe(false);
  });

  it('discards a connection that finishes after the source left active', async () => {
    const h = createHarness();
    let release;
    h.engine.connect = async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      h.engine.connects += 1;
      const client = { closed: false };
      h.engine.clients.push(client);
      return client;
    };
    const pending = h.gate.read('crm', page());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await h.gate.leaveActive('crm', 'paused');
    release();
    await expect(pending).rejects.toThrow(SourceDisabledError);
    expect(h.engine.clients.every((client) => client.closed)).toBe(true);
  });

  it('re-resolves credentials on the next activation', async () => {
    const h = createHarness();
    await h.gate.read('crm', page());
    await h.gate.leaveActive('crm', 'paused');
    await h.gate.read('crm', page());
    expect(h.resolver.resolves).toBe(2);
    expect(h.engine.connects).toBe(2);
  });
});

describe('rows-per-minute limiter', () => {
  it('throttles reads past the cap by waiting', async () => {
    const h = createHarness({
      sources: [sourceDoc({ limits: { pageSize: 100, maxTimeMs: 1000, rowsPerMin: 600 } })]
    });
    const start = h.clock.monotonic();
    for (let i = 0; i < 8; i += 1) await h.gate.read('crm', page(100));
    expect(h.clock.monotonic() - start).toBeGreaterThanOrEqual(10000);
  });

  it('rejects when the wait would be unreasonable', async () => {
    const h = createHarness({
      sources: [sourceDoc({ limits: { pageSize: 500, maxTimeMs: 1000, rowsPerMin: 10 } })]
    });
    await h.gate.read('crm', page(1), { estimatedRows: 10 });
    await expect(h.gate.read('crm', page(1), { estimatedRows: 10 })).resolves.toBeDefined();
    h.limiter.take = async () => {
      throw new RateLimitedError('crm', 90000);
    };
    await expect(h.gate.read('crm', page(1))).rejects.toThrow(RateLimitedError);
  });
});

describe('withTemporaryClient', () => {
  it('connects without caching credentials and always closes', async () => {
    const h = createHarness({ sources: [sourceDoc({ state: 'not_configured' })] });
    const value = await h.gate.withTemporaryClient('crm', async () => 'checked', {
      triggeredBy: 'dashboard'
    });
    expect(value).toBe('checked');
    expect(h.engine.clients[0].closed).toBe(true);
    expect(h.vault.holds('crm')).toBe(false);
    expect(h.accessRows[0]).toMatchObject({ action: 'verify', ok: true });
  });

  it('logs failures and still closes', async () => {
    const h = createHarness({ sources: [sourceDoc({ state: 'paused' })] });
    await expect(
      h.gate.withTemporaryClient('crm', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(h.engine.clients[0].closed).toBe(true);
    expect(h.accessRows[0]).toMatchObject({ action: 'verify', ok: false });
  });
});
