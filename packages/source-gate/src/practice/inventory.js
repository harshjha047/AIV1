import { getViewAllowList, listViews, matchDeniedKey, sourcePathsToVerify } from '@fab5/shared/pii';

export function typeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object') return value._bsontype ? String(value._bsontype).toLowerCase() : 'object';
  return typeof value;
}

export function skeletonize(value, maxItems = 3) {
  const kind = typeOf(value);
  if (kind === 'array') return value.slice(0, maxItems).map((item) => skeletonize(item, maxItems));
  if (kind === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, skeletonize(child, maxItems)]));
  }
  if (kind === 'null') return null;
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  return 's';
}

export function pickPaths(document, paths) {
  const result = {};
  const visit = (source, segments, target) => {
    if (source === null || source === undefined) return;
    const [head, ...tail] = segments;
    if (typeof source !== 'object' || !(head in source)) return;
    const value = source[head];
    if (tail.length === 0) {
      target[head] = value;
      return;
    }
    if (Array.isArray(value)) {
      const items = target[head] ?? value.map(() => ({}));
      value.forEach((item, index) => visit(item, tail, items[index]));
      target[head] = items;
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const child = target[head] ?? {};
    visit(value, tail, child);
    target[head] = child;
  };
  for (const path of paths) visit(document, path.split('.'), result);
  return result;
}

export function collectPaths(documents) {
  const fields = new Map();
  const record = (path, value) => {
    const entry = fields.get(path) ?? { count: 0, types: new Set() };
    entry.count += 1;
    entry.types.add(typeOf(value));
    fields.set(path, entry);
  };
  const visit = (value, prefix) => {
    const kind = typeOf(value);
    if (kind === 'array') {
      for (const item of value) {
        if (typeOf(item) === 'object' || typeOf(item) === 'array') visit(item, prefix);
      }
      return;
    }
    if (kind !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      record(path, child);
      visit(child, path);
    }
  };
  for (const document of documents) visit(document, '');
  return fields;
}

export function buildInventory(collection, documents, totalCount) {
  const fields = [...collectPaths(documents).entries()]
    .map(([path, entry]) => {
      const denied = path
        .split('.')
        .map((segment) => matchDeniedKey(segment))
        .find(Boolean);
      return { path, count: entry.count, types: [...entry.types].sort(), denied: denied ?? null };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { collection, totalCount, sampled: documents.length, fields };
}

export function allowListedPaths(sourceId) {
  const byCollection = new Map();
  for (const viewName of listViews(sourceId)) {
    const view = getViewAllowList(sourceId, viewName);
    if (!view.collection) continue;
    const entry = byCollection.get(view.collection) ?? new Set();
    for (const path of sourcePathsToVerify(view)) entry.add(path);
    byCollection.set(view.collection, entry);
  }
  return new Map([...byCollection.entries()].map(([collection, paths]) => [collection, [...paths].sort()]));
}
