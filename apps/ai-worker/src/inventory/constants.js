export const COUNT_MAX_TIME_MS = 10000;
export const PROBE_MAX_TIME_MS = 10000;
export const MAX_SOURCE_READS_PER_ENTITY = 2;
export const MAX_SOURCE_OPERATIONS_PER_ENTITY = 5;
export const MAX_READINESS_MONTHS = 36;
export const WRITE_BATCH_SIZE = 500;
export const ACTIVATION_ACTION = 'ACTIVATED';
export const APPROVED_STATUS = 'approved';

export const READINESS_STATUS = Object.freeze({
  READY: 'ready',
  NO_TARGET: 'no_target',
  NO_ACTIVITY: 'no_activity',
  SOURCE_OFF: 'source_off'
});

export const FLAGS = Object.freeze({
  BANDWIDTH_UNPARSED: 'bandwidthUnparsed',
  NO_CUSTOMER_MAPPING: 'noCustomerMapping',
  NO_TARGET_FOR_MONTH: 'noTargetForMonth',
  ACTIVATIONS_WITHOUT_CREATOR: 'activationsWithoutCreator',
  EMPLOYEES_WITH_ACTIVITY_NO_TARGET: 'employeesWithActivityNoTarget',
  NO_MANAGER: 'noManager',
  UNMAPPED_BETWEEN_SYSTEMS: 'unmappedBetweenSystems',
  PENDING_UNAPPROVED: 'pendingUnapproved',
  PRESENT_IN_ONE_SYSTEM_ONLY: 'presentInOneSystemOnly'
});

export const PROFILE_REQUIREMENTS = Object.freeze({
  sales: Object.freeze([Object.freeze(['crm'])]),
  collections: Object.freeze([Object.freeze(['bahikhata'])]),
  support: Object.freeze([Object.freeze(['samadhan'])])
});

export const PROFILE_DATA = Object.freeze({
  sales: Object.freeze([
    Object.freeze({ sourceId: 'crm', entity: 'connections' }),
    Object.freeze({ sourceId: 'crm', entity: 'connection_events' }),
    Object.freeze({ sourceId: 'crm', entity: 'sales_targets' })
  ]),
  collections: Object.freeze([Object.freeze({ sourceId: 'bahikhata', entity: 'ledger_entries' })]),
  support: Object.freeze([])
});

export const IDENTITY_SYNC = Object.freeze({
  'crm.employees': Object.freeze({ collection: 'employees', field: 'sources.crmUserId' }),
  'bahikhata.employees': Object.freeze({ collection: 'employees', field: 'sources.bahikhataUserId' }),
  'crm.customers': Object.freeze({ collection: 'customers', field: 'sources.crmId' }),
  'bahikhata.customers': Object.freeze({ collection: 'customers', field: 'sources.bahikhataId' })
});

export const EMPLOYEE_SOURCE_FIELDS = Object.freeze([
  'crmUserId',
  'bahikhataUserId',
  'invoicingUserId',
  'samadhanEmployeePk'
]);

export const MAPPING_SYSTEMS = Object.freeze(['bahikhata', 'invoicing', 'samadhan']);
export const MAPPING_STATUSES = Object.freeze(['matched', 'ambiguous', 'unmatched', 'rejected']);
