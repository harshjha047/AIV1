import { VIEW_ALLOW_LISTS, allowedOutputFields, getViewAllowList, listViews } from '@fab5/shared/pii';
import { ViewsSpecError } from './errors.js';

const ENGINES = new Set(['mongodb', 'postgres']);

export function defineViewsSpec({
  sourceId,
  specVersion,
  database,
  roleName = 'ai_reader',
  userName = 'ai_ro',
  schema = 'ai_export',
  selects = {},
  indexes = {}
}) {
  const source = VIEW_ALLOW_LISTS[sourceId];
  if (!source) throw new ViewsSpecError(`No allow-list for ${sourceId}`, 'UNKNOWN_SOURCE', { sourceId });
  if (!ENGINES.has(source.engine)) throw new ViewsSpecError(`Unsupported engine ${source.engine}`, 'UNKNOWN_ENGINE');
  if (!Number.isInteger(specVersion) || specVersion < 1) {
    throw new ViewsSpecError('specVersion must be a positive integer', 'INVALID_SPEC_VERSION');
  }
  const views = listViews(sourceId).map((name) => {
    const allowList = getViewAllowList(sourceId, name);
    const entry = { name, allowList };
    if (source.engine === 'postgres') {
      const select = selects[name];
      if (!select) throw new ViewsSpecError(`Missing select for ${sourceId}.${name}`, 'MISSING_SELECT', { name });
      const declared = Object.keys(select.columns);
      const allowed = allowedOutputFields(allowList);
      const extra = declared.filter((column) => !allowed.includes(column));
      const missing = allowed.filter((column) => !declared.includes(column));
      if (extra.length > 0 || missing.length > 0) {
        throw new ViewsSpecError(`Select columns differ from allow-list for ${name}`, 'COLUMN_MISMATCH', {
          name,
          extra,
          missing
        });
      }
      entry.select = select;
    }
    return entry;
  });
  return Object.freeze({
    sourceId,
    engine: source.engine,
    status: source.status,
    specVersion,
    database,
    roleName,
    userName,
    schema,
    indexes,
    views
  });
}
