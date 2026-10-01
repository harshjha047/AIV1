import { allowListedPaths } from './inventory.js';
import { verifyMongo } from '../verify/mongo.js';

const UNAUTHORIZED = 13;

async function probe(client, database, name) {
  try {
    await client.db(database).collection(name).find({}).limit(1).toArray();
    return { outcome: 'readable' };
  } catch (error) {
    return { outcome: error.code === UNAUTHORIZED ? 'denied' : 'error', code: error.code ?? null };
  }
}

export async function verifyPractice({ client, spec, database, now = () => new Date() }) {
  const viewNames = spec.views.map((view) => view.name);
  const baseNames = [...allowListedPaths(spec.sourceId).keys()].sort();
  const verification = await verifyMongo(client, { exposedObjects: viewNames });
  const views = {};
  for (const name of viewNames) views[name] = await probe(client, database, name);
  const bases = {};
  for (const name of baseNames) bases[name] = await probe(client, database, name);
  const viewsReadable = Object.values(views).every((entry) => entry.outcome === 'readable');
  const basesDenied = Object.values(bases).every((entry) => entry.outcome === 'denied');
  const authEnforced = verification.authEnforced;
  return {
    sourceId: spec.sourceId,
    database,
    checkedAt: now().toISOString(),
    authEnforced,
    verification: { status: verification.status, ok: verification.ok, details: verification.details },
    views,
    bases,
    ok: authEnforced && verification.ok && viewsReadable && basesDenied
  };
}
