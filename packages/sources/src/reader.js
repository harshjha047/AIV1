import { idToString, toMongoId } from '@fab5/source-gate/engines/mongoIds';
import { SourceReaderError } from './errors.js';

export const defaultIdCodec = Object.freeze({
  decode: (value, spec) => (spec.cursor.tieType === 'objectId' ? toMongoId(value) : value),
  encode: idToString
});

export function encodeCursor(spec, doc, codec = defaultIdCodec) {
  const time = doc?.[spec.cursor.time];
  const tie = doc?.[spec.cursor.tie];
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) {
    throw new SourceReaderError(`Row has no valid ${spec.cursor.time}`, 'CURSOR_TIME_INVALID', {
      entity: spec.entity
    });
  }
  if (tie === null || tie === undefined) {
    throw new SourceReaderError(`Row has no ${spec.cursor.tie}`, 'CURSOR_TIE_MISSING', {
      entity: spec.entity
    });
  }
  return `${time.toISOString()}|${codec.encode(tie)}`;
}

export function decodeCursor(cursor, spec, codec = defaultIdCodec) {
  if (cursor === null || cursor === undefined || cursor === '') return null;
  const text = String(cursor);
  const at = text.indexOf('|');
  if (at < 1 || at === text.length - 1) {
    throw new SourceReaderError('Malformed sync cursor', 'CURSOR_MALFORMED', {
      entity: spec.entity
    });
  }
  const time = new Date(text.slice(0, at));
  if (Number.isNaN(time.getTime())) {
    throw new SourceReaderError('Malformed sync cursor', 'CURSOR_MALFORMED', {
      entity: spec.entity
    });
  }
  return { time, id: codec.decode(text.slice(at + 1), spec) };
}

export function incrementalFilter(spec, { since = null, position = null } = {}) {
  const { time, tie } = spec.cursor;
  if (position) {
    return {
      $or: [
        { [time]: { $gt: position.time } },
        { [time]: position.time, [tie]: { $gt: position.id } }
      ]
    };
  }
  if (since) return { [time]: { $gte: since } };
  return {};
}

export async function* readEntity({
  gate,
  sourceId,
  spec,
  since = null,
  cursor = null,
  triggeredBy = 'sync',
  runId = null,
  codec = defaultIdCodec
}) {
  let position = decodeCursor(cursor, spec, codec);
  let lastCursor = cursor ?? null;
  let page = 0;
  for (;;) {
    const filter = incrementalFilter(spec, { since, position });
    const fetched = await gate.read(
      sourceId,
      async (client, { limits }) => {
        const docs = await client
          .db()
          .collection(spec.view)
          .find(filter)
          .sort({ [spec.cursor.time]: 1, [spec.cursor.tie]: 1 })
          .limit(limits.pageSize + 1)
          .maxTimeMS(limits.maxTimeMs)
          .toArray();
        const hasMore = docs.length > limits.pageSize;
        const items = hasMore ? docs.slice(0, limits.pageSize) : docs;
        return { value: { items, hasMore }, rows: items.length };
      },
      { entity: spec.entity, triggeredBy, runId: runId ?? undefined, action: 'read_page' }
    );
    page += 1;
    const last = fetched.items.at(-1);
    if (last) {
      lastCursor = encodeCursor(spec, last, codec);
      position = { time: last[spec.cursor.time], id: last[spec.cursor.tie] };
    }
    yield {
      entity: spec.entity,
      page,
      items: fetched.items,
      hasMore: fetched.hasMore,
      cursor: lastCursor
    };
    if (!fetched.hasMore || fetched.items.length === 0) return;
  }
}
