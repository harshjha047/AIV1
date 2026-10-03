import { describe, expect, it } from 'vitest';
import { checkHistoryBump } from '../index.js';
import { createFakeGate, createFakeView } from './helpers.js';

const event = (n, date, parent) => ({
  _id: `ev-${String(n).padStart(3, '0')}`,
  connectionId: `conn-${n}`,
  action: 'UPGRADE',
  date: new Date(date),
  parentUpdatedAt: new Date(parent)
});

const gateFor = (docs, pageSize = 3) =>
  createFakeGate({ views: { ai_connection_events_v: createFakeView(docs) }, pageSize });

describe('checkHistoryBump', () => {
  it('is consistent when every event is on or before its parent update', async () => {
    const docs = [
      event(1, '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      event(2, '2026-08-01T09:00:00.000Z', '2026-08-02T10:00:00.000Z'),
      event(3, '2026-08-03T10:00:00.500Z', '2026-08-03T10:00:00.000Z')
    ];
    const result = await checkHistoryBump({ gate: gateFor(docs) });
    expect(result).toMatchObject({
      checked: 3,
      violations: 0,
      conclusion: 'consistent',
      recommendFullRescan: false,
      truncated: false
    });
  });

  it('reports isolated exceptions without recommending a rescan', async () => {
    const docs = Array.from({ length: 200 }, (_, i) =>
      event(
        i + 1,
        '2026-08-01T10:00:00.000Z',
        `2026-08-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`
      )
    );
    docs.push(event(500, '2026-09-30T10:00:00.000Z', '2026-08-01T10:00:00.000Z'));
    const result = await checkHistoryBump({ gate: gateFor(docs, 50) });
    expect(result).toMatchObject({
      checked: 201,
      violations: 1,
      conclusion: 'exceptions',
      recommendFullRescan: false,
      sampleIds: ['conn-500:ev-500']
    });
  });

  it('flags a suspect when history appends do not bump the parent', async () => {
    const docs = [
      event(1, '2026-08-10T10:00:00.000Z', '2026-08-01T10:00:00.000Z'),
      event(2, '2026-08-11T10:00:00.000Z', '2026-08-01T11:00:00.000Z'),
      event(3, '2026-08-01T10:00:00.000Z', '2026-08-01T12:00:00.000Z')
    ];
    const result = await checkHistoryBump({ gate: gateFor(docs) });
    expect(result.conclusion).toBe('suspect');
    expect(result.recommendFullRescan).toBe(true);
    expect(result.violations).toBe(2);
    expect(result.sampleIds).toEqual(['conn-1:ev-001', 'conn-2:ev-002']);
  });

  it('respects the tolerance window', async () => {
    const docs = [event(1, '2026-08-01T10:00:30.000Z', '2026-08-01T10:00:00.000Z')];
    expect((await checkHistoryBump({ gate: gateFor(docs), toleranceMs: 60000 })).violations).toBe(
      0
    );
    expect((await checkHistoryBump({ gate: gateFor(docs), toleranceMs: 0 })).violations).toBe(1);
  });

  it('stops at maxRows and says so', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      event(i + 1, '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z')
    );
    const result = await checkHistoryBump({ gate: gateFor(docs, 4), maxRows: 5 });
    expect(result).toMatchObject({ checked: 5, truncated: true });
  });

  it('handles a source with no events', async () => {
    const result = await checkHistoryBump({ gate: gateFor([]) });
    expect(result).toMatchObject({ checked: 0, violations: 0, ratio: 0, conclusion: 'consistent' });
  });

  it('reads through the gate as a verification', async () => {
    const gate = gateFor([event(1, '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z')]);
    await checkHistoryBump({ gate });
    expect(gate.calls[0]).toMatchObject({
      sourceId: 'crm',
      ctx: { entity: 'connection_events', triggeredBy: 'verify' }
    });
  });
});
