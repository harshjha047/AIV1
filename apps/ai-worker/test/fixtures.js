import { d } from './helpers.js';

export const crmViews = () => ({
  ai_connections_v: [
    { _id: 'a1', createdAt: d('2026-06-30T20:00:00.000Z'), updatedAt: d('2026-07-02T05:00:00.000Z') },
    { _id: 'a2', createdAt: d('2026-07-10T05:00:00.000Z'), updatedAt: d('2026-07-11T05:00:00.000Z') },
    { _id: 'a3', createdAt: d('2026-08-02T05:00:00.000Z'), updatedAt: d('2026-08-03T05:00:00.000Z') },
    { _id: 'a4', createdAt: d('2026-08-20T05:00:00.000Z'), updatedAt: d('2026-08-21T09:30:00.000Z') }
  ],
  ai_connection_events_v: [
    { _id: 'e1', date: d('2026-07-12T05:00:00.000Z'), parentUpdatedAt: d('2026-07-12T06:00:00.000Z') },
    { _id: 'e2', date: d('2026-08-12T05:00:00.000Z'), parentUpdatedAt: d('2026-08-12T06:00:00.000Z') }
  ],
  ai_sales_targets_v: [
    { _id: 't1', monthStart: d('2026-06-30T18:30:00.000Z'), updatedAt: d('2026-06-25T05:00:00.000Z') }
  ],
  ai_service_requests_v: [
    { _id: 's1', createdAt: d('2026-08-05T05:00:00.000Z'), updatedAt: d('2026-08-06T05:00:00.000Z') }
  ],
  ai_users_v: [{ _id: 'u1', updatedAt: d('2026-08-01T05:00:00.000Z') }],
  ai_customers_v: [
    { _id: 'k1', updatedAt: d('2026-08-01T05:00:00.000Z') },
    { _id: 'k2', updatedAt: d('2026-08-02T05:00:00.000Z') }
  ]
});

export const bahikhataViews = () => ({
  ai_users_v: [{ _id: 'bu1', updatedAt: d('2026-08-01T05:00:00.000Z') }],
  ai_customers_v: [{ _id: 'bk1', updatedAt: d('2026-08-01T05:00:00.000Z') }],
  ai_ledger_v: [
    { _id: 'l1', date: d('2026-07-05T05:00:00.000Z'), updatedAt: d('2026-07-06T05:00:00.000Z') },
    { _id: 'l2', date: d('2026-08-10T05:00:00.000Z'), updatedAt: d('2026-08-11T05:00:00.000Z') },
    { _id: 'l3', date: d('2026-08-11T05:00:00.000Z'), updatedAt: d('2026-08-12T05:00:00.000Z') }
  ]
});

export const snapshotSeed = () => ({
  fact_sales_targets: [
    { _id: 'crm:t1', _src: 'crm', _deleted: false, employeeId: 'emp_1', monthKey: '2026-07' }
  ],
  fact_connections: [
    {
      _id: 'crm:1',
      _src: 'crm',
      _deleted: false,
      createdByEmployeeId: 'emp_1',
      srcCreatedAt: d('2026-07-10T05:00:00.000Z'),
      customerId: 'cus_1',
      bandwidthRaw: '100 Mbps',
      bandwidthParsed: true
    },
    {
      _id: 'crm:2',
      _src: 'crm',
      _deleted: false,
      createdByEmployeeId: 'emp_1',
      srcCreatedAt: d('2026-08-02T05:00:00.000Z'),
      customerId: null,
      bandwidthRaw: 'fast',
      bandwidthParsed: false
    },
    {
      _id: 'crm:3',
      _src: 'crm',
      _deleted: false,
      createdByEmployeeId: null,
      srcCreatedAt: d('2026-08-03T05:00:00.000Z'),
      customerId: 'cus_1',
      bandwidthRaw: null,
      bandwidthParsed: false
    },
    {
      _id: 'crm:4',
      _src: 'crm',
      _deleted: true,
      createdByEmployeeId: 'emp_1',
      srcCreatedAt: d('2026-08-04T05:00:00.000Z'),
      customerId: null,
      bandwidthRaw: 'bad',
      bandwidthParsed: false
    }
  ],
  fact_connection_events: [
    {
      _id: 'crm:1:e1',
      _src: 'crm',
      _deleted: false,
      connectionId: 'crm:1',
      action: 'ACTIVATED',
      performedByEmployeeId: 'emp_1',
      date: d('2026-07-12T05:00:00.000Z')
    },
    {
      _id: 'crm:3:e2',
      _src: 'crm',
      _deleted: false,
      connectionId: 'crm:3',
      action: 'ACTIVATED',
      performedByEmployeeId: null,
      date: d('2026-08-12T05:00:00.000Z')
    },
    {
      _id: 'crm:99:e3',
      _src: 'crm',
      _deleted: false,
      connectionId: 'crm:99',
      action: 'ACTIVATED',
      performedByEmployeeId: null,
      date: d('2026-08-13T05:00:00.000Z')
    }
  ],
  fact_service_requests: [
    { _id: 'crm:s1', _src: 'crm', _deleted: false, customerId: null },
    { _id: 'crm:s2', _src: 'crm', _deleted: false, customerId: 'cus_1' }
  ],
  fact_ledger_entries: [
    {
      _id: 'bahikhata:l1',
      _src: 'bahikhata',
      _deleted: false,
      customerId: 'cus_1',
      date: d('2026-07-05T05:00:00.000Z'),
      addedByEmployeeId: 'emp_2',
      status: 'approved'
    },
    {
      _id: 'bahikhata:l2',
      _src: 'bahikhata',
      _deleted: false,
      customerId: null,
      date: d('2026-08-10T05:00:00.000Z'),
      addedByEmployeeId: null,
      status: 'pending'
    },
    {
      _id: 'bahikhata:l3',
      _src: 'bahikhata',
      _deleted: true,
      customerId: 'cus_1',
      date: d('2026-08-11T05:00:00.000Z'),
      addedByEmployeeId: 'emp_2',
      status: 'pending'
    }
  ],
  customers: [
    {
      _id: 'cus_1',
      sources: { crmId: '1', bahikhataId: 'b1' },
      managedByEmployeeId: 'emp_1',
      collectionsManagerEmployeeId: 'emp_2',
      mapping: { bahikhata: { status: 'matched' } }
    },
    {
      _id: 'cus_2',
      sources: { crmId: '2' },
      managedByEmployeeId: null,
      collectionsManagerEmployeeId: null,
      mapping: { bahikhata: { status: 'unmatched' } }
    },
    {
      _id: 'cus_3',
      sources: { bahikhataId: 'b3' },
      managedByEmployeeId: null,
      collectionsManagerEmployeeId: null
    }
  ],
  employees: [
    {
      _id: 'emp_1',
      active: true,
      sources: { crmUserId: 'u1', bahikhataUserId: 'b1' },
      mappingStatus: 'complete'
    },
    { _id: 'emp_2', active: true, sources: { bahikhataUserId: 'b2' }, mappingStatus: 'partial' },
    { _id: 'emp_3', active: true, sources: { crmUserId: 'u3' }, mappingStatus: 'partial' },
    { _id: 'emp_4', active: false, sources: { crmUserId: 'u4' }, mappingStatus: 'partial' }
  ],
  employee_kpi_profiles: [
    { _id: 'p1', employeeId: 'emp_1', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null },
    { _id: 'p2', employeeId: 'emp_2', profile: 'collections', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null },
    { _id: 'p3', employeeId: 'emp_3', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null },
    { _id: 'p4', employeeId: 'emp_4', profile: 'sales', effectiveFrom: d('2026-01-01T00:00:00.000Z'), effectiveTo: null }
  ]
});
