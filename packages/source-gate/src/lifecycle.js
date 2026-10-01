import { SOURCE_CHANGED_CHANNEL, ON_DISABLE_POLICIES } from './constants.js';
import { ActivationRefusedError, InvalidTransitionError } from './errors.js';

function summary(source) {
  return { state: source.state, onDisable: source.onDisable };
}

function requireReason(sourceId, reason) {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new ActivationRefusedError(sourceId, 'reason_required');
  }
}

export function createSourceLifecycle({
  store,
  registry,
  gate,
  verifier,
  audit,
  bus,
  alerts,
  purger,
  clock,
  activity,
  logger
}) {
  async function current(sourceId) {
    const source = await store.get(sourceId);
    if (!source) throw new ActivationRefusedError(sourceId, 'unknown_source');
    return source;
  }

  function basePatch(actorId, reason, state) {
    const now = clock.now();
    return {
      state,
      stateChangedAt: now,
      stateChangedBy: actorId,
      stateReason: reason.trim().slice(0, 500),
      updatedAt: now
    };
  }

  async function finish({ source, updated, action, actorId, reason, requestId }) {
    registry.invalidate(source._id);
    await audit.record({
      actorEmployeeId: actorId,
      action,
      target: { collection: 'data_sources', id: source._id },
      reason,
      before: summary(source),
      after: summary(updated),
      requestId
    });
    await bus
      ?.publish(SOURCE_CHANGED_CHANNEL, {
        sourceId: source._id,
        state: updated.state,
        at: clock.now().toISOString()
      })
      .catch((error) => logger?.warn?.({ err: error.message }, 'source change publish failed'));
    await activity?.emit({
      kind: 'toggle',
      sourceId: source._id,
      action: action.replace('source.', ''),
      message: `${source.state} -> ${updated.state}`
    });
    return updated;
  }

  async function assertExclusion(source) {
    const all = await store.list();
    const conflict = all.find(
      (other) =>
        other._id !== source._id &&
        other.logicalSource === source.logicalSource &&
        other.kind !== source.kind &&
        other.state === 'active'
    );
    if (conflict) {
      throw new ActivationRefusedError(source._id, 'real_synthetic_exclusion', {
        conflictingSource: conflict._id
      });
    }
  }

  async function toActive(sourceId, { actorId, reason, requestId }, fromStates, action) {
    requireReason(sourceId, reason);
    const source = await current(sourceId);
    if (!fromStates.includes(source.state)) {
      throw new InvalidTransitionError(sourceId, source.state, action);
    }
    if (!source.credentialRef) throw new ActivationRefusedError(sourceId, 'no_credentials');
    if (!source.exposedObjects?.length) throw new ActivationRefusedError(sourceId, 'no_objects');
    await assertExclusion(source);
    const check = await verifier.run(sourceId, { triggeredBy: 'dashboard' });
    if (check.status === 'fail') {
      throw new ActivationRefusedError(sourceId, 'verification_failed', { details: check.details });
    }
    if (source.mode === 'production' && (check.status !== 'ok' || check.authEnforced !== true)) {
      throw new ActivationRefusedError(sourceId, 'production_requires_enforced_auth');
    }
    const updated = await store.transition(sourceId, fromStates, {
      ...basePatch(actorId, reason, 'active'),
      readOnlyCheck: check
    });
    if (!updated) throw new InvalidTransitionError(sourceId, 'changed', action);
    return finish({ source, updated, action: `source.${action}`, actorId, reason, requestId });
  }

  function activate(sourceId, options) {
    return toActive(sourceId, options, ['not_configured', 'paused'], 'activate');
  }

  async function enable(sourceId, options) {
    if (options.confirm !== true) throw new ActivationRefusedError(sourceId, 'confirmation_required');
    return toActive(sourceId, options, ['disabled'], 'enable');
  }

  async function leaveActiveTo(sourceId, state, options, extraPatch = {}) {
    const { actorId, reason } = options;
    requireReason(sourceId, reason);
    const source = await current(sourceId);
    const allowed = state === 'paused' ? ['active'] : ['active', 'paused'];
    if (!allowed.includes(source.state)) {
      throw new InvalidTransitionError(sourceId, source.state, state === 'paused' ? 'pause' : 'disable');
    }
    const updated = await store.transition(sourceId, allowed, {
      ...basePatch(actorId, reason, state),
      ...extraPatch
    });
    if (!updated) throw new InvalidTransitionError(sourceId, 'changed', state);
    registry.invalidate(sourceId);
    await gate.leaveActive(sourceId, state);
    return { source, updated };
  }

  async function pause(sourceId, options) {
    const { source, updated } = await leaveActiveTo(sourceId, 'paused', options);
    return finish({ source, updated, action: 'source.pause', ...options });
  }

  async function disable(sourceId, options) {
    const onDisable = options.onDisable ?? (await current(sourceId)).onDisable;
    if (!ON_DISABLE_POLICIES.includes(onDisable)) {
      throw new ActivationRefusedError(sourceId, 'invalid_on_disable');
    }
    if (onDisable === 'purge') {
      if (!purger) throw new ActivationRefusedError(sourceId, 'purge_unavailable');
      if (options.confirmText !== sourceId) {
        throw new ActivationRefusedError(sourceId, 'confirmation_required');
      }
    }
    const { source, updated } = await leaveActiveTo(sourceId, 'disabled', options, { onDisable });
    let result = updated;
    if (onDisable === 'purge') {
      await purger.purge(sourceId, { actorId: options.actorId });
      result = (await store.update(sourceId, { purgedAt: clock.now() })) ?? updated;
    }
    return finish({ source, updated: result, action: 'source.disable', ...options });
  }

  async function verifyScheduled(sourceId) {
    const source = await current(sourceId);
    if (source.state === 'not_configured') return null;
    const check = await verifier.run(sourceId, { triggeredBy: 'schedule' });
    const failing =
      check.status === 'fail' ||
      (source.mode === 'production' && source.state === 'active' && check.authEnforced !== true);
    if (failing && source.state === 'active') {
      await pause(sourceId, {
        actorId: 'system',
        reason: 'readonly_check_failed'
      });
      await alerts?.raise({
        ruleId: 'readonly_check_failed',
        severity: 'critical',
        message: `Read-only verification failed for ${sourceId}; source paused`,
        context: { sourceId }
      });
    }
    return check;
  }

  async function test(sourceId) {
    return gate.withTemporaryClient(
      sourceId,
      async (client, { engine }) => {
        await engine.ping(client);
        return { ok: true };
      },
      { triggeredBy: 'dashboard' }
    );
  }

  return { activate, enable, pause, disable, verifyScheduled, test };
}
