import { describe, expect, it } from 'vitest';
import { createAudit } from '@fab5/shared/activity';
import { ActivationRefusedError, InvalidTransitionError } from '../src/errors.js';
import { createSourceLifecycle } from '../src/lifecycle.js';
import { createHarness, page, sourceDoc } from './helpers.js';

function setup({ sources, check = { ok: true, status: 'ok', authEnforced: true, details: {} } } = {}) {
  const h = createHarness({ sources });
  const auditRows = [];
  const published = [];
  const alertRows = [];
  const verifier = { runs: 0, check, run: async () => (verifier.runs += 1, verifier.check) };
  const lifecycle = createSourceLifecycle({
    store: h.store,
    registry: h.registry,
    gate: h.gate,
    verifier,
    audit: createAudit({ store: { insert: async (doc) => auditRows.push(doc) }, clock: h.clock }),
    bus: {
      publish: async (channel, message) => {
        published.push({ channel, message });
        await h.bus.publish(channel, message);
      }
    },
    alerts: { raise: async (alert) => alertRows.push(alert) },
    purger: { purged: [], purge: async (id) => verifier.purged?.push(id) },
    clock: h.clock,
    activity: { emit: async (event) => h.activityRows.push(event) }
  });
  return { ...h, auditRows, published, alertRows, verifier, lifecycle };
}

const actor = { actorId: 'emp_1', reason: 'testing', requestId: 'req-1' };

describe('activation rules', () => {
  it('activates after verification, audits, and publishes a change', async () => {
    const t = setup({ sources: [sourceDoc({ state: 'not_configured' })] });
    const updated = await t.lifecycle.activate('crm', actor);
    expect(updated.state).toBe('active');
    expect(updated.readOnlyCheck.status).toBe('ok');
    expect(t.auditRows[0]).toMatchObject({
      action: 'source.activate',
      reason: 'testing',
      before: { state: 'not_configured' },
      after: { state: 'active' },
      requestId: 'req-1'
    });
    expect(t.published[0]).toMatchObject({
      channel: 'ai:source:changed',
      message: { sourceId: 'crm', state: 'active' }
    });
  });

  it('requires a reason', async () => {
    const t = setup({ sources: [sourceDoc({ state: 'paused' })] });
    await expect(t.lifecycle.activate('crm', { actorId: 'emp_1', reason: '  ' })).rejects.toThrow(
      ActivationRefusedError
    );
  });

  it('refuses when verification fails', async () => {
    const t = setup({
      sources: [sourceDoc({ state: 'paused' })],
      check: { ok: false, status: 'fail', authEnforced: true, details: { writeActions: ['insert'] } }
    });
    await expect(t.lifecycle.activate('crm', actor)).rejects.toMatchObject({
      reason: 'verification_failed'
    });
    expect(t.store.docs.get('crm').state).toBe('paused');
  });

  it('production refuses authEnforced=false', async () => {
    const t = setup({
      sources: [sourceDoc({ state: 'paused', mode: 'production' })],
      check: { ok: true, status: 'warn', authEnforced: false, details: {} }
    });
    await expect(t.lifecycle.activate('crm', actor)).rejects.toMatchObject({
      reason: 'production_requires_enforced_auth'
    });
    expect(t.store.docs.get('crm').state).toBe('paused');
  });

  it('practice allows a warn result with auth not enforced', async () => {
    const t = setup({
      sources: [sourceDoc({ state: 'paused', mode: 'practice' })],
      check: { ok: true, status: 'warn', authEnforced: false, details: {} }
    });
    const updated = await t.lifecycle.activate('crm', actor);
    expect(updated.state).toBe('active');
    expect(updated.readOnlyCheck.authEnforced).toBe(false);
  });

  it('refuses a synthetic source while the real one is active, and the reverse', async () => {
    const real = sourceDoc({ _id: 'invoicing', logicalSource: 'invoicing', state: 'active' });
    const synthetic = sourceDoc({
      _id: 'invoicing_synthetic',
      logicalSource: 'invoicing',
      kind: 'synthetic',
      state: 'paused'
    });
    const t = setup({ sources: [real, synthetic] });
    await expect(t.lifecycle.activate('invoicing_synthetic', actor)).rejects.toMatchObject({
      reason: 'real_synthetic_exclusion'
    });
    const u = setup({
      sources: [
        { ...real, state: 'paused' },
        { ...synthetic, state: 'active' }
      ]
    });
    await expect(u.lifecycle.activate('invoicing', actor)).rejects.toMatchObject({
      reason: 'real_synthetic_exclusion'
    });
  });

  it('rejects invalid transitions', async () => {
    const t = setup({ sources: [sourceDoc({ state: 'active' })] });
    await expect(t.lifecycle.activate('crm', actor)).rejects.toThrow(InvalidTransitionError);
    const u = setup({ sources: [sourceDoc({ state: 'not_configured' })] });
    await expect(u.lifecycle.pause('crm', actor)).rejects.toThrow(InvalidTransitionError);
  });
});

describe('leaving active', () => {
  it('pause blocks reads, closes the pool and cancels queued jobs', async () => {
    const t = setup();
    await t.gate.read('crm', page());
    const updated = await t.lifecycle.pause('crm', actor);
    expect(updated.state).toBe('paused');
    expect(t.engine.clients[0].closed).toBe(true);
    expect(t.queue.cancelled).toEqual(['crm']);
    await expect(t.gate.read('crm', page())).rejects.toThrow('not active');
    const blocked = t.accessRows.filter((row) => row.action === 'blocked');
    expect(blocked).toHaveLength(1);
  });

  it('disable with keep records the policy', async () => {
    const t = setup();
    const updated = await t.lifecycle.disable('crm', { ...actor, onDisable: 'keep' });
    expect(updated).toMatchObject({ state: 'disabled', onDisable: 'keep' });
    expect(t.auditRows[0].action).toBe('source.disable');
  });

  it('disable with purge needs confirmation text and a purger', async () => {
    const t = setup();
    await expect(t.lifecycle.disable('crm', { ...actor, onDisable: 'purge' })).rejects.toMatchObject({
      reason: 'confirmation_required'
    });
    const purged = [];
    t.verifier.purged = purged;
    const updated = await t.lifecycle.disable('crm', {
      ...actor,
      onDisable: 'purge',
      confirmText: 'crm'
    });
    expect(purged).toEqual(['crm']);
    expect(updated.purgedAt).toBeInstanceOf(Date);
  });

  it('enable requires confirmation and re-verifies', async () => {
    const t = setup({ sources: [sourceDoc({ state: 'disabled' })] });
    await expect(t.lifecycle.enable('crm', actor)).rejects.toMatchObject({
      reason: 'confirmation_required'
    });
    const updated = await t.lifecycle.enable('crm', { ...actor, confirm: true });
    expect(updated.state).toBe('active');
    expect(t.verifier.runs).toBe(1);
  });
});

describe('scheduled verification', () => {
  it('pauses an active source and raises a critical alert on failure', async () => {
    const t = setup({
      check: { ok: false, status: 'fail', authEnforced: true, details: { extraResources: ['users'] } }
    });
    await t.lifecycle.verifyScheduled('crm');
    expect(t.store.docs.get('crm').state).toBe('paused');
    expect(t.store.docs.get('crm').stateReason).toBe('readonly_check_failed');
    expect(t.alertRows[0]).toMatchObject({ ruleId: 'readonly_check_failed', severity: 'critical' });
  });

  it('pauses a production source whose auth is no longer enforced', async () => {
    const t = setup({
      sources: [sourceDoc({ mode: 'production' })],
      check: { ok: true, status: 'warn', authEnforced: false, details: {} }
    });
    await t.lifecycle.verifyScheduled('crm');
    expect(t.store.docs.get('crm').state).toBe('paused');
  });

  it('leaves healthy and unconfigured sources alone', async () => {
    const t = setup();
    await t.lifecycle.verifyScheduled('crm');
    expect(t.store.docs.get('crm').state).toBe('active');
    const u = setup({ sources: [sourceDoc({ state: 'not_configured' })] });
    expect(await u.lifecycle.verifyScheduled('crm')).toBeNull();
    expect(u.verifier.runs).toBe(0);
  });
});
