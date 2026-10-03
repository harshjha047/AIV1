const d = (text) => new Date(text);

export const ids = {
  conn1: '64f000000000000000000001',
  conn2: '64f000000000000000000002',
  hist1: '64f0000000000000000000b1',
  hist2: '64f0000000000000000000b2',
  cust1: '64f0000000000000000000c1',
  cust2: '64f0000000000000000000c2',
  user1: '64f0000000000000000000a1',
  user2: '64f0000000000000000000a2',
  user3: '64f0000000000000000000a3',
  sr1: '64f0000000000000000000d1',
  target1: '64f0000000000000000000e1',
  ledger1: '64f0000000000000000000f1'
};

export const crmUser = {
  _id: ids.user1,
  name: 'Asha Rao',
  email: ' Asha.Rao@Example.com ',
  role: 'sales',
  isActive: true,
  createdAt: d('2025-01-10T05:00:00.000Z'),
  updatedAt: d('2026-08-01T05:00:00.000Z'),
  password: '$2b$10$hash',
  phone: '9999988888',
  adharNumber: '123412341234',
  panNumber: 'ABCDE1234F',
  refreshToken: 'rt-secret'
};

export const crmCustomer = {
  _id: ids.cust1,
  name: 'Acme Networks Pvt Ltd',
  customerType: 'Enterprise',
  managedBy: ids.user1,
  isActive: true,
  state: 'Maharashtra',
  createdAt: d('2025-02-01T05:00:00.000Z'),
  updatedAt: d('2026-08-02T05:00:00.000Z'),
  email: 'billing@acme.example',
  mobile: '9876500000',
  gstNumber: '27ABCDE1234F1Z5',
  address: { street: '1 Main Road', city: 'Pune', pincode: '411001' }
};

export const crmConnection = {
  _id: ids.conn1,
  opportunityId: 'OPP-1001',
  customer: ids.cust1,
  createdBy: ids.user1,
  approvedBy: ids.user2,
  activatedBy: null,
  serviceType: 'ILL',
  bandwidth: '500 Mbps',
  status: 'Active',
  acceptanceDate: d('2026-08-03T00:00:00.000Z'),
  technicalDetails: {
    telcoProvider: 'Airtel',
    aEnd: { btsId: 'BTS-1', address: 'secret street', coordinates: [1, 2] },
    bEnd: { btsId: 'BTS-2', address: 'other street', coordinates: [3, 4] }
  },
  commercials: { mrc: 12500.5, otc: '2,000' },
  providerCost: { mrc: 9000 },
  ips: { count: 4, cost: 400 },
  remarksSnippet: 'Delivered on time',
  termination: { raiseDate: null, finalDate: null, reasonSnippet: null },
  rejection: null,
  createdAt: d('2026-07-01T05:00:00.000Z'),
  updatedAt: d('2026-08-05T05:00:00.000Z'),
  purchaseOrder: { url: 'https://files.example/po.pdf' },
  caf: { url: 'https://files.example/caf.pdf' }
};

export const crmEvent = {
  _id: ids.hist1,
  connectionId: ids.conn1,
  action: 'UPGRADE',
  date: d('2026-08-04T05:00:00.000Z'),
  performedBy: ids.user1,
  bandwidth: '1 Gbps',
  mrc: '15000',
  noteSnippet: 'Customer requested upgrade',
  parentUpdatedAt: d('2026-08-05T05:00:00.000Z')
};

export const crmServiceRequest = {
  _id: ids.sr1,
  customer: ids.cust1,
  requestType: 'Upgrade',
  status: 'Pending',
  serviceType: 'ILL',
  bandwidthCurrent: '100 Mbps',
  bandwidthRequested: '200',
  commercials: { mrc: '8000.00' },
  createdBy: ids.user1,
  approvedBy: null,
  raiseDate: d('2026-08-06T00:00:00.000Z'),
  finalDisconnectionDate: null,
  disconnectionReasonSnippet: null,
  createdAt: d('2026-08-06T05:00:00.000Z'),
  updatedAt: d('2026-08-07T05:00:00.000Z')
};

export const crmSalesTarget = {
  _id: ids.target1,
  employee: ids.user1,
  monthStart: d('2026-08-31T18:30:00.000Z'),
  targetMbps: 1500,
  setBy: ids.user2,
  createdAt: d('2026-08-01T05:00:00.000Z'),
  updatedAt: d('2026-08-02T05:00:00.000Z')
};

export const bkUser = {
  _id: ids.user3,
  name: 'Ravi Kumar',
  email: 'ravi@example.com',
  role: 'collector',
  createdAt: d('2025-03-01T05:00:00.000Z'),
  updatedAt: d('2026-08-01T05:00:00.000Z'),
  password: '$2b$10$hash',
  resetPasswordToken: 'reset-secret'
};

export const bkCustomer = {
  _id: ids.cust2,
  crmId: ids.cust1,
  companyName: 'ACME NETWORKS PRIVATE LIMITED',
  manager: ids.user3,
  availableAdvance: '1500.75',
  isActive: true,
  createdAt: d('2025-03-05T05:00:00.000Z'),
  updatedAt: d('2026-08-02T05:00:00.000Z'),
  address: 'secret address',
  gstNumber: '27ABCDE1234F1Z5'
};

export const bkLedger = {
  _id: ids.ledger1,
  customer: ids.cust2,
  date: d('2026-08-10T00:00:00.000Z'),
  invoiceNo: 'INV-2026-0042',
  debit: '11800.00',
  credit: null,
  advanceAmount: 0,
  status: 'approved',
  paymentStatus: 'Partially Paid',
  amountPaid: '5000',
  balanceDue: '6800',
  addedBy: ids.user3,
  descriptionSnippet: 'Monthly rental August',
  createdAt: d('2026-08-10T05:00:00.000Z'),
  updatedAt: d('2026-08-12T05:00:00.000Z'),
  bankInfo: { bankName: 'HDFC', utr: 'UTR123' },
  remarks: 'internal note',
  allocations: [{ x: 1 }]
};

export const fixturesByEntity = {
  crm: {
    employees: crmUser,
    customers: crmCustomer,
    connections: crmConnection,
    connection_events: crmEvent,
    service_requests: crmServiceRequest,
    sales_targets: crmSalesTarget
  },
  bahikhata: {
    employees: bkUser,
    customers: bkCustomer,
    ledger_entries: bkLedger
  }
};
