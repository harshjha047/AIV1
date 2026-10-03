import { allowedOutputFields, getViewAllowList, listViews, scanDocument } from '@fab5/shared/pii';
import { validateContract, listContracts } from '@fab5/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  MappingError,
  NULL_MAP_CONTEXT,
  createMapContext,
  entitySpecs,
  getEntitySpec,
  listEntities
} from '../index.js';
import { fixturesByEntity, ids } from './fixtures.js';
import { trackedDoc } from './helpers.js';

const withinAllowed = (accessed, allowed) =>
  [...accessed].filter(
    (path) =>
      path !== '_id' &&
      !allowed.some(
        (name) => name === path || path.startsWith(`${name}.`) || name.startsWith(`${path}.`)
      )
  );

const context = createMapContext({
  employees: new Map([
    [`crm:${ids.user1}`, 'emp_A'],
    [`crm:${ids.user2}`, 'emp_B'],
    [`bahikhata:${ids.user3}`, 'emp_C']
  ]),
  customers: new Map([
    [`crm:${ids.cust1}`, 'cus_A'],
    [`bahikhata:${ids.cust2}`, 'cus_A']
  ])
});

describe('entity spec registry', () => {
  it('has one spec per view allow-list entry', () => {
    for (const sourceId of ['crm', 'bahikhata']) {
      const views = listViews(sourceId);
      const specViews = listEntities(sourceId).map(
        (entity) => getEntitySpec(sourceId, entity).view
      );
      expect(specViews.sort()).toEqual([...views].sort());
    }
  });

  it('references a contract that exists for every spec', () => {
    const known = new Set(listContracts());
    for (const [sourceId, specs] of Object.entries(entitySpecs)) {
      for (const spec of Object.values(specs)) {
        expect(known.has(spec.contract), `${sourceId}.${spec.entity}`).toBe(true);
        expect(spec.contract).toBe(`${sourceId}.${spec.entity}`);
      }
    }
  });

  it('declares fact targets and identity entities consistently', () => {
    for (const specs of Object.values(entitySpecs)) {
      for (const spec of Object.values(specs)) {
        if (spec.kind === 'fact') expect(spec.target).toMatch(/^fact_/);
        else expect(spec.target).toBeNull();
      }
    }
  });

  it('uses the compound cursor with a tie field on every spec', () => {
    for (const specs of Object.values(entitySpecs)) {
      for (const spec of Object.values(specs)) {
        expect(spec.cursor.tie).toBe('_id');
        expect(['updatedAt', 'parentUpdatedAt']).toContain(spec.cursor.time);
      }
    }
    expect(getEntitySpec('crm', 'connection_events').cursor.time).toBe('parentUpdatedAt');
  });

  it('freezes specs', () => {
    expect(Object.isFrozen(getEntitySpec('crm', 'connections'))).toBe(true);
    expect(Object.isFrozen(getEntitySpec('crm', 'connections').cursor)).toBe(true);
  });
});

describe('entity mapping reads only allow-listed view fields', () => {
  for (const [sourceId, entities] of Object.entries(fixturesByEntity)) {
    for (const [entity, doc] of Object.entries(entities)) {
      it(`${sourceId}.${entity} never touches a field outside its view`, () => {
        const spec = getEntitySpec(sourceId, entity);
        const allowed = allowedOutputFields(getViewAllowList(sourceId, spec.view));
        const { proxy, seen } = trackedDoc(doc);
        spec.map(proxy, context);
        expect(withinAllowed(seen, allowed)).toEqual([]);
      });

      it(`${sourceId}.${entity} produces a contract-valid row without denied keys`, () => {
        const spec = getEntitySpec(sourceId, entity);
        const mapped = spec.map(doc, context);
        expect(validateContract(spec.contract, mapped)).toEqual({ ok: true, reason: null });
        expect(scanDocument(mapped).filter((hit) => hit.kind === 'key')).toEqual([]);
        const serialized = JSON.stringify(mapped);
        for (const leaked of [
          'rt-secret',
          'reset-secret',
          '$2b$10$hash',
          '123412341234',
          'ABCDE1234F',
          'secret street',
          'UTR123',
          'billing@acme.example'
        ]) {
          expect(serialized).not.toContain(leaked);
        }
      });
    }
  }
});

describe('CRM mapping', () => {
  const crm = (entity) => getEntitySpec('crm', entity);

  it('normalizes employees', () => {
    const mapped = crm('employees').map(fixturesByEntity.crm.employees, context);
    expect(mapped).toMatchObject({
      _id: `crm:${ids.user1}`,
      sourceUserId: ids.user1,
      email: 'asha.rao@example.com',
      name: 'Asha Rao',
      sourceRole: 'sales',
      active: true
    });
  });

  it('maps customers with the manager resolved', () => {
    const mapped = crm('customers').map(fixturesByEntity.crm.customers, context);
    expect(mapped).toMatchObject({
      _id: `crm:${ids.cust1}`,
      name: 'Acme Networks Pvt Ltd',
      state: 'Maharashtra',
      managedByEmployeeId: 'emp_A',
      managedBySourceId: ids.user1
    });
  });

  it('maps connections to integer paise, bandwidth and margin', () => {
    const mapped = crm('connections').map(fixturesByEntity.crm.connections, context);
    expect(mapped).toMatchObject({
      _id: `crm:${ids.conn1}`,
      opportunityId: 'OPP-1001',
      customerId: 'cus_A',
      customerSourceId: ids.cust1,
      createdByEmployeeId: 'emp_A',
      approvedByEmployeeId: 'emp_B',
      activatedByEmployeeId: null,
      bandwidthRaw: '500 Mbps',
      bandwidthMbps: 500,
      bandwidthParsed: true,
      telcoProvider: 'Airtel',
      mrcPaise: 1250050,
      otcPaise: 200000,
      providerMrcPaise: 900000,
      marginMrcPaise: 350050,
      ipCount: 4,
      ipCostPaise: 40000,
      aEndBtsId: 'BTS-1',
      bEndBtsId: 'BTS-2',
      termination: null,
      rejection: null
    });
    expect(mapped.srcUpdatedAt).toEqual(new Date('2026-08-05T05:00:00.000Z'));
  });

  it('flags unparsed bandwidth and keeps a null margin when a cost is missing', () => {
    const doc = {
      ...fixturesByEntity.crm.connections,
      bandwidth: 'as per plan',
      providerCost: undefined
    };
    const mapped = crm('connections').map(doc, NULL_MAP_CONTEXT);
    expect(mapped).toMatchObject({
      bandwidthMbps: 0,
      bandwidthParsed: false,
      providerMrcPaise: null,
      marginMrcPaise: null,
      customerId: null,
      customerSourceId: ids.cust1
    });
  });

  it('keeps termination detail when any part is present', () => {
    const doc = {
      ...fixturesByEntity.crm.connections,
      termination: {
        raiseDate: new Date('2026-08-20T00:00:00.000Z'),
        finalDate: null,
        reasonSnippet: 'Moving office'
      }
    };
    const mapped = crm('connections').map(doc, context);
    expect(mapped.termination).toEqual({
      raiseDate: new Date('2026-08-20T00:00:00.000Z'),
      finalDate: null,
      reasonSnippet: 'Moving office'
    });
  });

  it('rejects an unparseable amount instead of zeroing it', () => {
    const doc = { ...fixturesByEntity.crm.connections, commercials: { mrc: 'abc' } };
    expect(() => crm('connections').map(doc, context)).toThrow(MappingError);
  });

  it('rejects a connection without a status', () => {
    const doc = { ...fixturesByEntity.crm.connections, status: null };
    expect(() => crm('connections').map(doc, context)).toThrow(/status is missing/);
  });

  it('builds composite ids for connection events', () => {
    const mapped = crm('connection_events').map(fixturesByEntity.crm.connection_events, context);
    expect(mapped).toMatchObject({
      _id: `crm:${ids.conn1}:${ids.hist1}`,
      connectionId: `crm:${ids.conn1}`,
      action: 'UPGRADE',
      bandwidthRaw: '1 Gbps',
      bandwidthMbps: 1000,
      mrcPaise: 1500000,
      performedByEmployeeId: 'emp_A'
    });
    expect(mapped.parentUpdatedAt).toEqual(new Date('2026-08-05T05:00:00.000Z'));
  });

  it('leaves bandwidth null on events that carry none', () => {
    const doc = { ...fixturesByEntity.crm.connection_events, bandwidth: null };
    const mapped = crm('connection_events').map(doc, context);
    expect(mapped.bandwidthRaw).toBeNull();
    expect(mapped.bandwidthMbps).toBeNull();
  });

  it('maps service requests', () => {
    const mapped = crm('service_requests').map(fixturesByEntity.crm.service_requests, context);
    expect(mapped).toMatchObject({
      requestType: 'Upgrade',
      bandwidthCurrentMbps: 100,
      bandwidthRequestedMbps: 200,
      mrcPaise: 800000,
      customerId: 'cus_A',
      approvedByEmployeeId: null
    });
  });

  it('derives the IST month key for sales targets', () => {
    const mapped = crm('sales_targets').map(fixturesByEntity.crm.sales_targets, context);
    expect(mapped).toMatchObject({
      monthKey: '2026-09',
      targetMbps: 1500,
      employeeId: 'emp_A',
      employeeSourceId: ids.user1,
      setByEmployeeId: 'emp_B'
    });
  });
});

describe('BahiKhata mapping', () => {
  const bahikhata = (entity) => getEntitySpec('bahikhata', entity);

  it('maps customers with the CRM link and advance in paise', () => {
    const mapped = bahikhata('customers').map(fixturesByEntity.bahikhata.customers, context);
    expect(mapped).toMatchObject({
      _id: `bahikhata:${ids.cust2}`,
      crmId: ids.cust1,
      name: 'ACME NETWORKS PRIVATE LIMITED',
      collectionsManagerEmployeeId: 'emp_C',
      availableAdvancePaise: 150075
    });
  });

  it('maps ledger entries with zero for absent amounts', () => {
    const mapped = bahikhata('ledger_entries').map(
      fixturesByEntity.bahikhata.ledger_entries,
      context
    );
    expect(mapped).toMatchObject({
      _id: `bahikhata:${ids.ledger1}`,
      customerId: 'cus_A',
      customerSourceId: ids.cust2,
      invoiceNo: 'INV-2026-0042',
      debitPaise: 1180000,
      creditPaise: 0,
      advancePaise: 0,
      amountPaidPaise: 500000,
      balanceDuePaise: 680000,
      paymentStatus: 'Partially Paid',
      addedByEmployeeId: 'emp_C'
    });
  });

  it('keeps unmapped customers addressable by their source id', () => {
    const mapped = bahikhata('ledger_entries').map(
      fixturesByEntity.bahikhata.ledger_entries,
      NULL_MAP_CONTEXT
    );
    expect(mapped.customerId).toBeNull();
    expect(mapped.customerSourceId).toBe(ids.cust2);
  });

  it('rejects a ledger entry with a corrupt amount', () => {
    const doc = { ...fixturesByEntity.bahikhata.ledger_entries, debit: 'twelve' };
    expect(() => bahikhata('ledger_entries').map(doc, context)).toThrow(MappingError);
  });

  it('rejects a ledger entry without a date', () => {
    const doc = { ...fixturesByEntity.bahikhata.ledger_entries, date: null };
    expect(() => bahikhata('ledger_entries').map(doc, context)).toThrow(/date is missing/);
  });
});
