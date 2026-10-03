import { createRealClock } from '@fab5/shared/clock';

const defaults = (now, mode) => [
  { _id: 'snapshot', currentVersion: null, promotedAt: null, schemaVersion: 0, perSource: {} },
  { _id: 'embedding', activeModel: null, dim: 768, activatedAt: null },
  { _id: 'flags', updatedBy: null, updatedAt: null },
  { _id: 'guard', state: 'ok', since: now, reason: null },
  {
    _id: 'mode',
    mode,
    referenceDate: null,
    referenceAuto: true,
    updatedBy: null,
    updatedAt: now,
  },
];

export const seedMeta = async (db, { now = createRealClock().now(), mode = 'practice' } = {}) => {
  const seeded = [];
  for (const document of defaults(now, mode)) {
    const { _id, ...fields } = document;
    const result = await db
      .collection('meta')
      .updateOne({ _id }, { $setOnInsert: fields }, { upsert: true });
    if (result.upsertedCount === 1) seeded.push(_id);
  }
  return seeded;
};
