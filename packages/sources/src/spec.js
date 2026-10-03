import { allowedOutputFields, getViewAllowList } from '@fab5/shared/pii';
import { SourceReaderError } from './errors.js';

const KINDS = new Set(['fact', 'identity']);
const TIE_TYPES = new Set(['objectId', 'string']);

const fail = (message, details) => {
  throw new SourceReaderError(message, 'ENTITY_SPEC_INVALID', details);
};

export function defineEntity(sourceId, spec) {
  const label = `${sourceId}.${spec?.entity ?? '?'}`;
  if (!spec || typeof spec.entity !== 'string')
    fail(`Entity spec for ${sourceId} needs an entity`, { sourceId });
  if (!KINDS.has(spec.kind)) fail(`${label} has an invalid kind`, { label });
  if (typeof spec.view !== 'string') fail(`${label} needs a view`, { label });
  if (typeof spec.map !== 'function') fail(`${label} needs a map function`, { label });
  if (typeof spec.contract !== 'string') fail(`${label} needs a contract id`, { label });
  if (spec.kind === 'fact' && typeof spec.target !== 'string')
    fail(`${label} needs a target`, { label });
  if (spec.kind === 'identity' && spec.target)
    fail(`${label} is an identity entity and has no target`, { label });
  const cursor = spec.cursor ?? {};
  if (typeof cursor.time !== 'string' || typeof cursor.tie !== 'string') {
    fail(`${label} needs cursor.time and cursor.tie`, { label });
  }
  if (!TIE_TYPES.has(cursor.tieType))
    fail(`${label} needs cursor.tieType objectId or string`, { label });

  const view = getViewAllowList(sourceId, spec.view);
  if (view.entity !== spec.entity) {
    fail(`${label} does not match the view allow-list entity ${view.entity}`, { label });
  }
  const outputs = new Set([...allowedOutputFields(view), '_id']);
  for (const field of [cursor.time, cursor.tie]) {
    if (!outputs.has(field))
      fail(`${label} cursor field ${field} is not exported by ${spec.view}`, { label, field });
  }

  return Object.freeze({
    sourceId,
    target: null,
    activityDate: null,
    ...spec,
    cursor: Object.freeze({ ...cursor })
  });
}
