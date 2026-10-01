import { sourcePathsToVerify } from '@fab5/shared/pii';

export function pathExists(value, path) {
  const segments = Array.isArray(path) ? path : path.split('.');
  if (segments.length === 0) return value !== undefined;
  if (Array.isArray(value)) return value.some((item) => pathExists(item, segments));
  if (value === null || typeof value !== 'object') return false;
  const [head, ...tail] = segments;
  if (!Object.prototype.hasOwnProperty.call(value, head)) return false;
  if (tail.length === 0) return value[head] !== undefined;
  return pathExists(value[head], tail);
}

export function missingPaths(view, documents) {
  return sourcePathsToVerify(view).filter((path) => !documents.some((doc) => pathExists(doc, path)));
}

export function checkViewAgainstSamples(viewName, view, samplesByCollection) {
  const problems = [];
  const documents = samplesByCollection?.[view.collection];
  if (!documents) {
    problems.push({ view: viewName, kind: 'collection_not_found', path: view.collection });
    return problems;
  }
  if (documents.length === 0) {
    problems.push({ view: viewName, kind: 'no_sample_documents', path: view.collection });
    return problems;
  }
  for (const path of missingPaths(view, documents)) {
    problems.push({ view: viewName, kind: 'field_not_found', path, collection: view.collection });
  }
  return problems;
}
