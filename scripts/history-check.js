import { createRealClock } from '@fab5/shared/clock';
import { createRuntime, loadSnapshotDb } from '@fab5/source-gate';
import { checkHistoryBump } from '@fab5/sources';

const sourceId = process.argv[2] ?? 'crm';
const handle = await loadSnapshotDb();
try {
  const runtime = createRuntime({
    db: handle.db,
    clock: createRealClock(),
    processName: 'history-check'
  });
  const result = await checkHistoryBump({ gate: runtime.gate, sourceId });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.conclusion === 'suspect' ? 2 : 0;
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exitCode = 1;
} finally {
  await handle.close();
}
