import { allowListedPaths, buildInventory, pickPaths, skeletonize } from './inventory.js';

export async function recordSamples({ db, sourceId, sampleSize = 300, probeSize = 2, write }) {
  const summary = { sourceId, collections: {}, problems: [] };
  const inventory = { sourceId, collections: [] };
  for (const [collection, paths] of allowListedPaths(sourceId)) {
    const existing = await db.listCollections({ name: collection }, { nameOnly: true }).toArray();
    if (existing.length === 0) {
      summary.problems.push({ kind: 'collection_not_found', collection });
      continue;
    }
    const target = db.collection(collection);
    const totalCount = await target.estimatedDocumentCount();
    const sampled = await target.aggregate([{ $sample: { size: sampleSize } }]).toArray();
    const skeletons = sampled.map((document) => skeletonize(document));
    const picked = skeletons.map((skeleton) => pickPaths(skeleton, paths));
    const found = (path) => picked.some((document) => hasPath(document, path.split('.')));
    const probed = [];
    for (const path of paths.filter((entry) => !found(entry))) {
      const extra = await target.find({ [path]: { $exists: true } }).limit(probeSize).toArray();
      for (const document of extra) {
        const skeleton = skeletonize(document);
        skeletons.push(skeleton);
        picked.push(pickPaths(skeleton, paths));
      }
      if (extra.length > 0) probed.push(path);
    }
    const missing = paths.filter((entry) => !found(entry));
    inventory.collections.push(buildInventory(collection, skeletons, totalCount));
    await write(`${collection}.json`, picked);
    summary.collections[collection] = { totalCount, sampled: sampled.length, probed, missing };
  }
  await write('inventory.json', inventory);
  return summary;
}

function hasPath(value, segments) {
  if (segments.length === 0) return value !== undefined;
  if (Array.isArray(value)) return value.some((item) => hasPath(item, segments));
  if (value === null || typeof value !== 'object') return false;
  const [head, ...tail] = segments;
  if (!(head in value)) return false;
  return hasPath(value[head], tail);
}
