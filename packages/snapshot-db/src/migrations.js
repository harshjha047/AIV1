import { createRealClock } from '@fab5/shared/clock';
import { DUPLICATE_KEY, MIGRATIONS_COLLECTION } from './constants.js';

export class MigrationStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationStateError';
  }
}

const assertDefinitions = (migrations) => {
  let previousVersion = 0;
  const ids = new Set();
  for (const migration of migrations) {
    if (!/^\d{3}_[a-z0-9_]+$/.test(migration.id)) {
      throw new MigrationStateError(`invalid migration id ${migration.id}`);
    }
    if (ids.has(migration.id)) throw new MigrationStateError(`duplicate migration ${migration.id}`);
    if (!Number.isInteger(migration.version) || migration.version !== previousVersion + 1) {
      throw new MigrationStateError(
        `migration ${migration.id} must have version ${previousVersion + 1}`,
      );
    }
    if (!migration.id.startsWith(String(migration.version).padStart(3, '0'))) {
      throw new MigrationStateError(`migration ${migration.id} prefix does not match version`);
    }
    ids.add(migration.id);
    previousVersion = migration.version;
  }
};

const readApplied = async (db) =>
  db.collection(MIGRATIONS_COLLECTION).find({}).sort({ _id: 1 }).toArray();

export const getMigrationStatus = async (db, migrations) => {
  assertDefinitions(migrations);
  const applied = await readApplied(db);
  const known = new Set(migrations.map((migration) => migration.id));
  const unknown = applied.filter((entry) => !known.has(entry._id)).map((entry) => entry._id);
  if (unknown.length > 0) {
    throw new MigrationStateError(
      `database has migrations unknown to this code: ${unknown.join(', ')}`,
    );
  }
  const appliedIds = new Set(applied.map((entry) => entry._id));
  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  const schemaVersion = applied.reduce((max, entry) => Math.max(max, entry.version), 0);
  return {
    applied: applied.map((entry) => entry._id),
    pending: pending.map((migration) => migration.id),
    schemaVersion,
  };
};

export const runMigrations = async (
  db,
  migrations,
  { clock = createRealClock(), now = () => clock.now(), monotonic = () => clock.monotonic(), context = {} } = {},
) => {
  const status = await getMigrationStatus(db, migrations);
  const pending = migrations.filter((migration) => status.pending.includes(migration.id));
  const ran = [];

  for (const migration of pending) {
    const startedAt = now();
    const timer = monotonic();
    await migration.up(db, { ...context, now: startedAt });
    const durationMs = Math.round(monotonic() - timer);
    try {
      await db.collection(MIGRATIONS_COLLECTION).insertOne({
        _id: migration.id,
        version: migration.version,
        appliedAt: now(),
        durationMs,
      });
    } catch (error) {
      if (error.code !== DUPLICATE_KEY) throw error;
    }
    await db
      .collection('meta')
      .updateOne(
        { _id: 'snapshot' },
        { $set: { schemaVersion: migration.version } },
        { upsert: true },
      );
    ran.push({ id: migration.id, durationMs });
  }

  const schemaVersion =
    pending.length > 0 ? pending[pending.length - 1].version : status.schemaVersion;
  return { ran, pending: [], schemaVersion };
};
