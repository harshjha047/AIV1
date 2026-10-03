import { readEntity } from '../src/reader.js';
import { connectionEvents } from './entities.js';

const SAMPLE_LIMIT = 10;
const EXCEPTION_RATIO = 0.01;

export async function checkHistoryBump({
  gate,
  sourceId = 'crm',
  spec = connectionEvents,
  toleranceMs = 60000,
  maxRows = 50000,
  runId = null
}) {
  let checked = 0;
  let violations = 0;
  const sampleIds = [];
  scan: for await (const batch of readEntity({
    gate,
    sourceId,
    spec,
    triggeredBy: 'verify',
    runId
  })) {
    for (const doc of batch.items) {
      checked += 1;
      const eventDate = doc.date instanceof Date ? doc.date.getTime() : null;
      const parent = doc.parentUpdatedAt instanceof Date ? doc.parentUpdatedAt.getTime() : null;
      if (eventDate !== null && parent !== null && eventDate > parent + toleranceMs) {
        violations += 1;
        if (sampleIds.length < SAMPLE_LIMIT) sampleIds.push(`${doc.connectionId}:${doc._id}`);
      }
      if (checked >= maxRows) break scan;
    }
  }
  const ratio = checked === 0 ? 0 : violations / checked;
  let conclusion = 'consistent';
  if (violations > 0) conclusion = ratio < EXCEPTION_RATIO ? 'exceptions' : 'suspect';
  return {
    checked,
    violations,
    ratio,
    sampleIds,
    conclusion,
    recommendFullRescan: conclusion === 'suspect',
    truncated: checked >= maxRows
  };
}
