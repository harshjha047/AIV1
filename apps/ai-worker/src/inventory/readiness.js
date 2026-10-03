import { listMonthKeys, monthKey, periodRange } from '@fab5/shared/periods';
import { sourceVisibility } from '@fab5/source-gate';
import {
  MAX_READINESS_MONTHS,
  PROFILE_DATA,
  PROFILE_REQUIREMENTS,
  READINESS_STATUS,
  WRITE_BATCH_SIZE
} from './constants.js';

const toDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function unsatisfiedSources(profile, { sources, syncedBySource }) {
  const missing = [];
  for (const group of PROFILE_REQUIREMENTS[profile] ?? []) {
    const satisfied = group.some((logical) =>
      sources.some((source) => {
        if ((source.logicalSource ?? source._id) !== logical) return false;
        const visibility = sourceVisibility(source, sources);
        if (visibility === 'live') return true;
        return visibility === 'stale' && (syncedBySource.get(source._id) ?? 0) > 0;
      })
    );
    if (!satisfied) missing.push(...group);
  }
  return missing;
}

export function profileMonths(profile, inventory) {
  let min = null;
  let max = null;
  for (const { sourceId, entity } of PROFILE_DATA[profile] ?? []) {
    const row = inventory.get(`${sourceId}.${entity}`);
    const low = toDate(row?.minDate);
    const high = toDate(row?.maxDate);
    if (low && (!min || low < min)) min = low;
    if (high && (!max || high > max)) max = high;
  }
  if (!min || !max) return [];
  return listMonthKeys(monthKey(min), monthKey(max)).slice(-MAX_READINESS_MONTHS);
}

const profileCoversMonth = (entry, month) => {
  const { start, end } = periodRange(month);
  const from = toDate(entry.effectiveFrom);
  const to = toDate(entry.effectiveTo);
  if (from && from >= end) return false;
  if (to && to < start) return false;
  return true;
};

export function buildReadiness({
  employees,
  profileEntries,
  inventory,
  sources,
  syncedBySource,
  facts,
  now
}) {
  const docs = [];
  const months = new Map();
  const missingByProfile = new Map();
  const entriesByEmployee = new Map();
  for (const entry of profileEntries) {
    const list = entriesByEmployee.get(entry.employeeId) ?? [];
    list.push(entry);
    entriesByEmployee.set(entry.employeeId, list);
  }

  for (const employee of employees) {
    if (employee.active === false) continue;
    const entries = entriesByEmployee.get(employee._id) ?? [];
    const profiles = [...new Set(entries.map((entry) => entry.profile))].sort();
    for (const profile of profiles) {
      if (!months.has(profile)) months.set(profile, profileMonths(profile, inventory));
      if (!missingByProfile.has(profile)) {
        missingByProfile.set(profile, unsatisfiedSources(profile, { sources, syncedBySource }));
      }
      const missing = missingByProfile.get(profile);
      const mine = entries.filter((entry) => entry.profile === profile);
      for (const month of months.get(profile)) {
        if (!mine.some((entry) => profileCoversMonth(entry, month))) continue;
        let status;
        if (missing.length > 0) status = READINESS_STATUS.SOURCE_OFF;
        else if (profile === 'sales') {
          const active = facts.salesActivity.get(employee._id)?.has(month) ?? false;
          const targeted = facts.targets.has(`${employee._id}:${month}`);
          if (!active) status = READINESS_STATUS.NO_ACTIVITY;
          else status = targeted ? READINESS_STATUS.READY : READINESS_STATUS.NO_TARGET;
        } else if (profile === 'collections') {
          const active = facts.collectionsActivity.get(employee._id)?.has(month) ?? false;
          status = active ? READINESS_STATUS.READY : READINESS_STATUS.NO_ACTIVITY;
        } else {
          status = READINESS_STATUS.NO_ACTIVITY;
        }
        docs.push({
          _id: `${employee._id}:${profile}:${month}`,
          employeeId: employee._id,
          profile,
          monthKey: month,
          status,
          missingSources: status === READINESS_STATUS.SOURCE_OFF ? [...missing] : [],
          updatedAt: now
        });
      }
    }
  }
  return docs;
}

const sameRow = (existing, next) =>
  existing &&
  existing.status === next.status &&
  JSON.stringify(existing.missingSources ?? []) === JSON.stringify(next.missingSources);

export async function writeReadiness({ collection, docs }) {
  const existing = new Map();
  for await (const row of collection.find({}, { projection: { status: 1, missingSources: 1 } })) {
    existing.set(row._id, row);
  }
  const wanted = new Set(docs.map((doc) => doc._id));
  const changed = docs.filter((doc) => !sameRow(existing.get(doc._id), doc));
  const stale = [...existing.keys()].filter((id) => !wanted.has(id));

  for (let index = 0; index < changed.length; index += WRITE_BATCH_SIZE) {
    const batch = changed.slice(index, index + WRITE_BATCH_SIZE);
    await collection.bulkWrite(
      batch.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true }
      })),
      { ordered: false }
    );
  }
  for (let index = 0; index < stale.length; index += WRITE_BATCH_SIZE) {
    await collection.deleteMany({ _id: { $in: stale.slice(index, index + WRITE_BATCH_SIZE) } });
  }
  return { rows: docs.length, written: changed.length, removed: stale.length };
}
