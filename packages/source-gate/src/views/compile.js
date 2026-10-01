import { ViewsSpecError } from './errors.js';

export const fieldRef = (scope) => (field) => (scope ? `$$${scope}.${field}` : `$${field}`);

const orEmpty = (value) => ({ $ifNull: [value, []] });

function domainOf(variable) {
  const text = { $toString: variable };
  return {
    $cond: [
      { $and: [{ $eq: [{ $type: variable }, 'string'] }, { $gt: [{ $indexOfCP: [text, '@'] }, -1] }] },
      { $toLower: { $arrayElemAt: [{ $split: [text, '@'] }, 1] } },
      null
    ]
  };
}

export function compileExpr(expr, ref) {
  switch (expr.op) {
    case 'ref':
      return ref(expr.field);
    case 'firstOf':
      return { $arrayElemAt: [ref(expr.field), 0] };
    case 'snippet':
      return { $substrCP: [{ $ifNull: [ref(expr.field), ''] }, 0, expr.length] };
    case 'size':
      return { $size: orEmpty(ref(expr.field)) };
    case 'pluck':
      return { $map: { input: orEmpty(ref(expr.field)), as: 'item', in: `$$item.${expr.key}` } };
    case 'domains':
      return { $map: { input: orEmpty(ref(expr.field)), as: 'recipient', in: domainOf('$$recipient') } };
    case 'object':
      return Object.fromEntries(Object.entries(expr.fields).map(([key, child]) => [key, compileExpr(child, ref)]));
    default:
      throw new ViewsSpecError(`Unsupported expression op ${expr.op}`, 'UNSUPPORTED_OP', { op: expr.op });
  }
}

export function buildMongoPipeline(view) {
  const root = fieldRef();
  const stages = [];
  if (view.filter) stages.push({ $match: { [view.filter.field]: { $in: [...view.filter.in] } } });
  const project = {};
  for (const path of view.include) project[path] = 1;
  for (const field of view.computed) project[field.name] = compileExpr(field.expr, root);
  if (!view.unwind) {
    stages.push({ $project: project });
    return stages;
  }
  const { unwind } = view;
  const row = fieldRef('h');
  const mapped = {};
  for (const path of unwind.include) {
    if (path.includes('.')) {
      throw new ViewsSpecError(`Unwind include must be flat: ${path}`, 'UNWIND_NESTED_PATH', { path });
    }
    mapped[path] = `$$h.${path}`;
  }
  for (const field of unwind.computed ?? []) mapped[field.name] = compileExpr(field.expr, row);
  project[unwind.path] = { $map: { input: orEmpty(`$${unwind.path}`), as: 'h', in: mapped } };
  stages.push({ $project: project });
  stages.push({ $unwind: `$${unwind.path}` });
  const rootFields = Object.fromEntries(Object.entries(unwind.rootAs ?? {}).map(([name, source]) => [name, `$${source}`]));
  stages.push({ $replaceRoot: { newRoot: { $mergeObjects: [`$${unwind.path}`, rootFields] } } });
  return stages;
}

export function collectPipelineFields(value, found = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) {
      const [, ...rest] = value.slice(2).split('.');
      for (const segment of rest) found.add(segment);
    } else if (value.startsWith('$')) {
      for (const segment of value.slice(1).split('.')) found.add(segment);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPipelineFields(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!key.startsWith('$')) for (const segment of key.split('.')) found.add(segment);
      collectPipelineFields(child, found);
    }
  }
  return found;
}

export function projectionIsInclusionOnly(pipeline) {
  const problems = [];
  const visit = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$project') {
        for (const [field, flag] of Object.entries(child)) {
          if (flag === 0 || flag === false || flag === '$$REMOVE') problems.push(`${path}.$project.${field}`);
        }
      }
      if (key === '$unset') problems.push(`${path}.$unset`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(pipeline, 'pipeline');
  return problems;
}
