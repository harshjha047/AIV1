import { VIEW_ALLOW_LISTS, listViews } from '@fab5/shared/pii';
import { limitsFromEnv } from './constants.js';

const DEFINITIONS = {
  crm: { displayName: 'CRM', engine: 'mongodb', kind: 'real', logicalSource: 'crm' },
  bahikhata: {
    displayName: 'BahiKhata',
    engine: 'mongodb',
    kind: 'real',
    logicalSource: 'bahikhata'
  },
  invoicing: {
    displayName: 'Invoicing',
    engine: 'mongodb',
    kind: 'real',
    logicalSource: 'invoicing'
  },
  samadhan: {
    displayName: 'Samadhan',
    engine: 'postgres',
    kind: 'real',
    logicalSource: 'samadhan'
  },
  samadhan_synthetic: {
    displayName: 'Samadhan (synthetic)',
    engine: 'postgres',
    kind: 'synthetic',
    logicalSource: 'samadhan',
    viewsFrom: 'samadhan'
  },
  invoicing_synthetic: {
    displayName: 'Invoicing (synthetic)',
    engine: 'mongodb',
    kind: 'synthetic',
    logicalSource: 'invoicing',
    viewsFrom: 'invoicing'
  }
};

export function knownSourceIds() {
  return Object.keys(DEFINITIONS);
}

function exposedObjectsFor(definition) {
  const key = definition.viewsFrom ?? definition.logicalSource;
  const views = listViews(key);
  const spec = VIEW_ALLOW_LISTS[key];
  return spec.engine === 'postgres' ? views.map((view) => `ai_export.${view}`) : views;
}

export function buildSourceDocument(sourceId, { mode, clock, env = process.env }) {
  const definition = DEFINITIONS[sourceId];
  if (!definition) throw new Error(`Unknown source id ${sourceId}`);
  const now = clock.now();
  return {
    _id: sourceId,
    displayName: definition.displayName,
    engine: definition.engine,
    kind: definition.kind,
    logicalSource: definition.logicalSource,
    mode,
    state: 'not_configured',
    onDisable: env.ON_DISABLE_DEFAULT ?? 'hide',
    exposedObjects: exposedObjectsFor(definition),
    credentialRef: `env:SRC_${sourceId.toUpperCase()}_URI`,
    readOnlyCheck: null,
    limits: limitsFromEnv(sourceId, env),
    pools: {},
    lastSuccessAt: null,
    lastError: null,
    stateChangedAt: now,
    stateChangedBy: null,
    stateReason: null,
    purgedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
