import { describe, expect, it } from 'vitest';
import {
  buildReadiness,
  profileMonths,
  unsatisfiedSources,
  writeReadiness
} from '../src/inventory/index.js';
import { createCollection, d, sourceDoc } from './helpers.js';

const now = d('2026-09-01T00:00:00.000Z');

const inventory = () =>
  new Map([
    ['crm.connections', { minDate: d('2026-06-30T20:00:00.000Z'), maxDate: d('2026-08-20T05:00:00.000Z') }],
    ['crm.connection_events', { minDate: null, maxDate: null }],
    ['crm.sales_targets', { minDate: d('2026-06-30T18:30:00.000Z'), maxDate: d('2026-07-31T18:30:00.000Z') }],
    ['bahikhata.ledger_entries', { minDate: d('2026-07-05T05:00:00.000Z'), maxDate: d('2026-08-10T05:00:00.000Z') }]
  ]);

const facts = () => ({
  targets: new Set(['emp_1:2026-07']),
  salesActivity: new Map([['emp_1', new Set(['2026-07', '2026-08'])]]),
  collectionsActivity: new Map([['emp_2', new Set(['2026-07'])]])
});

const base = (overrides = {}) => ({
  employees: [{ _id: 'emp_1', active: true }, { _id: 'emp_2', active: true }],
  profileEntries: [
    { employeeId: 'emp_1', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null },
    { employeeId: 'emp_2', profile: 'collections', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null }
  ],
  inventory: inventory(),
  sources: [sourceDoc('crm'), sourceDoc('bahikhata')],
  syncedBySource: new Map([['crm', 10], ['bahikhata', 10]]),
  facts: facts(),
  now,
  ...overrides
});

const statusOf = (docs, id) => docs.find((doc) => doc._id === id)?.status;

describe('profileMonths', () => {
  it('spans the union of the profile entity ranges in IST months', () => {
    expect(profileMonths('sales', inventory())).toEqual(['2026-07', '2026-08']);
    expect(profileMonths('collections', inventory())).toEqual(['2026-07', '2026-08']);
  });

  it('returns nothing without data or for profiles without entities', () => {
    expect(profileMonths('sales', new Map())).toEqual([]);
    expect(profileMonths('support', inventory())).toEqual([]);
  });

  it('caps the number of months', () => {
    const wide = new Map([
      ['bahikhata.ledger_entries', { minDate: d('2018-01-10T00:00:00.000Z'), maxDate: d('2026-08-10T00:00:00.000Z') }]
    ]);
    const months = profileMonths('collections', wide);
    expect(months).toHaveLength(36);
    expect(months.at(-1)).toBe('2026-08');
  });
});

describe('unsatisfiedSources', () => {
  const synced = (value) => new Map([['crm', value]]);

  it('is satisfied by a live source', () => {
    expect(unsatisfiedSources('sales', { sources: [sourceDoc('crm')], syncedBySource: synced(0) })).toEqual([]);
  });

  it('treats stale sources with copied data as available and without data as missing', () => {
    const paused = [sourceDoc('crm', { state: 'paused' })];
    expect(unsatisfiedSources('sales', { sources: paused, syncedBySource: synced(5) })).toEqual([]);
    expect(unsatisfiedSources('sales', { sources: paused, syncedBySource: synced(0) })).toEqual(['crm']);
  });

  it('treats hidden and unregistered sources as missing', () => {
    const hidden = [sourceDoc('crm', { state: 'disabled', onDisable: 'hide' })];
    expect(unsatisfiedSources('sales', { sources: hidden, syncedBySource: synced(5) })).toEqual(['crm']);
    expect(unsatisfiedSources('sales', { sources: [], syncedBySource: synced(5) })).toEqual(['crm']);
    const kept = [sourceDoc('crm', { state: 'disabled', onDisable: 'keep' })];
    expect(unsatisfiedSources('sales', { sources: kept, syncedBySource: synced(5) })).toEqual([]);
  });

  it('accepts a synthetic source standing in for the logical source', () => {
    const sources = [
      sourceDoc('samadhan_synthetic', { kind: 'synthetic', logicalSource: 'samadhan' }),
      sourceDoc('samadhan', { state: 'not_configured' })
    ];
    expect(unsatisfiedSources('support', { sources, syncedBySource: new Map() })).toEqual([]);
    const withReal = [
      ...sources.slice(0, 1),
      sourceDoc('samadhan', { state: 'active' })
    ];
    expect(unsatisfiedSources('support', { sources: withReal, syncedBySource: new Map() })).toEqual([]);
  });
});

describe('buildReadiness', () => {
  it('assigns ready, no_target and no_activity', () => {
    const docs = buildReadiness(
      base({
        employees: [{ _id: 'emp_1', active: true }, { _id: 'emp_2', active: true }, { _id: 'emp_5', active: true }],
        profileEntries: [
          { employeeId: 'emp_1', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null },
          { employeeId: 'emp_5', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null },
          { employeeId: 'emp_2', profile: 'collections', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null }
        ]
      })
    );
    expect(statusOf(docs, 'emp_1:sales:2026-07')).toBe('ready');
    expect(statusOf(docs, 'emp_1:sales:2026-08')).toBe('no_target');
    expect(statusOf(docs, 'emp_5:sales:2026-07')).toBe('no_activity');
    expect(statusOf(docs, 'emp_5:sales:2026-08')).toBe('no_activity');
    expect(statusOf(docs, 'emp_2:collections:2026-07')).toBe('ready');
    expect(statusOf(docs, 'emp_2:collections:2026-08')).toBe('no_activity');
    expect(docs.every((doc) => doc.updatedAt === now && Array.isArray(doc.missingSources))).toBe(true);
  });

  it('reports source_off with the missing logical sources', () => {
    const docs = buildReadiness(
      base({ sources: [sourceDoc('crm', { state: 'disabled', onDisable: 'hide' }), sourceDoc('bahikhata')] })
    );
    expect(docs.find((doc) => doc._id === 'emp_1:sales:2026-07')).toMatchObject({
      status: 'source_off',
      missingSources: ['crm']
    });
    expect(statusOf(docs, 'emp_2:collections:2026-07')).toBe('ready');
  });

  it('respects effective windows and inactive employees', () => {
    const docs = buildReadiness(
      base({
        employees: [{ _id: 'emp_1', active: true }, { _id: 'emp_2', active: false }],
        profileEntries: [
          { employeeId: 'emp_1', profile: 'sales', effectiveFrom: d('2026-07-31T18:30:00.000Z'), effectiveTo: null },
          { employeeId: 'emp_2', profile: 'collections', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null }
        ]
      })
    );
    expect(docs.map((doc) => doc._id)).toEqual(['emp_1:sales:2026-08']);
  });

  it('closes a profile at its effectiveTo month', () => {
    const docs = buildReadiness(
      base({
        profileEntries: [
          { employeeId: 'emp_1', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: d('2026-07-15T00:00:00.000Z') }
        ]
      })
    );
    expect(docs.map((doc) => doc._id)).toEqual(['emp_1:sales:2026-07']);
  });

  it('emits no rows for a profile without cached data', () => {
    const docs = buildReadiness(base({ inventory: new Map() }));
    expect(docs).toEqual([]);
  });
});

describe('writeReadiness', () => {
  const doc = (id, status, missingSources = []) => ({
    _id: id,
    employeeId: 'emp_1',
    profile: 'sales',
    monthKey: id.split(':')[2],
    status,
    missingSources,
    updatedAt: now
  });

  it('upserts only changed rows and removes rows that no longer apply', async () => {
    const collection = createCollection({ name: 'kpi_readiness' });
    const first = await writeReadiness({
      collection,
      docs: [doc('emp_1:sales:2026-07', 'ready'), doc('emp_1:sales:2026-08', 'no_target')]
    });
    expect(first).toEqual({ rows: 2, written: 2, removed: 0 });

    const second = await writeReadiness({
      collection,
      docs: [doc('emp_1:sales:2026-07', 'ready'), doc('emp_1:sales:2026-08', 'no_target')]
    });
    expect(second).toEqual({ rows: 2, written: 0, removed: 0 });

    const third = await writeReadiness({
      collection,
      docs: [doc('emp_1:sales:2026-07', 'source_off', ['crm'])]
    });
    expect(third).toEqual({ rows: 1, written: 1, removed: 1 });
    expect(collection.store).toHaveLength(1);
    expect(collection.store[0]).toMatchObject({ status: 'source_off', missingSources: ['crm'] });
  });
});
