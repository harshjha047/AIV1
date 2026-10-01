export const TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 330;

export const MODES = Object.freeze(['practice', 'production']);
export const LOGICAL_SOURCES = Object.freeze(['crm', 'bahikhata', 'invoicing', 'samadhan']);
export const SOURCE_IDS = Object.freeze([
  ...LOGICAL_SOURCES,
  'samadhan_synthetic',
  'invoicing_synthetic',
]);
export const SOURCE_STATES = Object.freeze(['not_configured', 'active', 'paused', 'disabled']);
export const ON_DISABLE_POLICIES = Object.freeze(['keep', 'hide', 'purge']);
export const AI_ROLES = Object.freeze(['employee', 'manager', 'admin', 'owner']);
export const KPI_PROFILES = Object.freeze(['sales', 'collections', 'support']);
export const CLIENT_IDS = Object.freeze(['crm', 'bahikhata', 'samadhan', 'invoicing', 'hub']);

export const DATA_QUALITY = Object.freeze({
  NO_TARGET: 'NO_TARGET',
  BANDWIDTH_UNPARSED: 'BANDWIDTH_UNPARSED',
  SOURCE_STALE: 'SOURCE_STALE',
  UNMAPPED_CUSTOMER: 'UNMAPPED_CUSTOMER',
  SYNTHETIC_SOURCE: 'SYNTHETIC_SOURCE',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
});

export const ID_PREFIXES = Object.freeze({
  employee: 'emp',
  customer: 'cus',
});

export const SYSTEM_FIELDS = Object.freeze(['_src', '_hash', '_runId', '_syncedAt', '_deleted']);

export const EMBEDDING_DIM = 768;
export const MBPS_PER_GBPS = 1000;
