import crm from './crm/views.spec.js';
import bahikhata from './bahikhata/views.spec.js';
import invoicing from './invoicing/views.spec.js';
import samadhan from './samadhan/views.spec.js';
import { bahikhataEntities } from './bahikhata/entities.js';
import { crmEntities } from './crm/entities.js';

export const viewsSpecs = Object.freeze({ crm, bahikhata, invoicing, samadhan });

export function getViewsSpec(sourceId) {
  const spec = viewsSpecs[sourceId];
  if (!spec) throw new Error(`No views spec for ${sourceId}`);
  return spec;
}

export const entitySpecs = Object.freeze({ crm: crmEntities, bahikhata: bahikhataEntities });

export function listEntities(sourceId) {
  const specs = entitySpecs[sourceId];
  if (!specs) throw new Error(`No entity specs for ${sourceId}`);
  return Object.keys(specs);
}

export function getEntitySpec(sourceId, entity) {
  const spec = entitySpecs[sourceId]?.[entity];
  if (!spec) throw new Error(`No entity spec for ${sourceId}.${entity}`);
  return spec;
}

export { defineEntity } from './src/spec.js';
export { MappingError, SourceReaderError } from './src/errors.js';
export {
  allNull,
  asBool,
  asDate,
  asInt,
  asNumber,
  asPaise,
  asText,
  bandwidthOf,
  createMapContext,
  idOf,
  monthKeyOf,
  normalizeEmail,
  NULL_MAP_CONTEXT,
  requireId,
  requireText
} from './src/mapping.js';
export {
  decodeCursor,
  defaultIdCodec,
  encodeCursor,
  incrementalFilter,
  readEntity
} from './src/reader.js';
export { mapPage, quarantineRecord, sampleRedacted } from './src/pipeline.js';
export { createCursorStore } from './src/cursorStore.js';
export { checkHistoryBump } from './crm/historyCheck.js';
export {
  LEGACY_SOURCE,
  buildLegacyRows,
  extractLiteral,
  parseMonthLabel,
  readLegacyExport
} from './bahikhata/legacy.js';
