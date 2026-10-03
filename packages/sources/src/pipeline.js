import { contentHash } from '@fab5/shared/hash';
import { validateContract } from '@fab5/shared/contracts';
import { scanDocument, matchDeniedKey } from '@fab5/shared/pii';
import { redactSecrets, truncate } from '@fab5/shared/redact';
import { sha1Hex } from '@fab5/shared/hash';
import { MappingError } from './errors.js';

const typeOf = (value) => {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const docIdOf = (doc) => {
  const id = doc?._id;
  return id === null || id === undefined ? 'unknown' : String(id);
};

export function sampleRedacted(doc) {
  const fields = Object.keys(doc ?? {})
    .filter((key) => matchDeniedKey(key) === null)
    .slice(0, 40)
    .map((key) => `${key}:${typeOf(doc[key])}`);
  return truncate(`_id=${docIdOf(doc)}; fields=${fields.join(',')}`, 600);
}

export function quarantineRecord({ source, spec, doc, page, reason, now }) {
  return {
    _id: `quarantine:${sha1Hex(`${source}|${spec.entity}|${docIdOf(doc)}`)}`,
    source,
    entity: spec.entity,
    page,
    reason: truncate(redactSecrets(reason), 200),
    sampleRedacted: sampleRedacted(doc),
    createdAt: now
  };
}

function mapOne(spec, doc, ctx, validate) {
  const mapped = spec.map(doc, ctx);
  const verdict = validate(spec.contract, mapped);
  if (!verdict.ok) throw new MappingError(verdict.reason, 'CONTRACT_VIOLATION');
  const keyHit = scanDocument(mapped).find((hit) => hit.kind === 'key');
  if (keyHit) throw new MappingError(`denied key ${keyHit.path}`, 'DENIED_KEY');
  return { mapped, hash: contentHash(mapped) };
}

export async function mapPage({
  spec,
  source,
  items,
  page,
  ctx,
  clock,
  runId,
  loadHashes = null,
  validate = validateContract
}) {
  const now = clock.now();
  const valid = [];
  const quarantined = [];
  for (const doc of items) {
    try {
      valid.push(mapOne(spec, doc, ctx, validate));
    } catch (error) {
      quarantined.push(
        quarantineRecord({
          source,
          spec,
          doc,
          page,
          reason: error?.message ?? 'mapping failed',
          now
        })
      );
    }
  }

  const known =
    spec.target && loadHashes && valid.length > 0
      ? await loadHashes(
          spec.target,
          valid.map(({ mapped }) => mapped._id)
        )
      : new Map();

  const rows = [];
  let unchanged = 0;
  for (const { mapped, hash } of valid) {
    if (spec.target && known.get(mapped._id) === hash) {
      unchanged += 1;
      continue;
    }
    rows.push(
      spec.target
        ? { ...mapped, _src: source, _hash: hash, _runId: runId, _syncedAt: now, _deleted: false }
        : { ...mapped, _hash: hash }
    );
  }
  return { rows, unchanged, quarantined, read: items.length };
}
