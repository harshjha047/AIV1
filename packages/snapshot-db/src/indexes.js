import { INDEX_CONFLICT_CODES, LLM_DEBUG_TEXT_COLLECTION } from './constants.js';

export const SECONDS = Object.freeze({
  day7: 604800,
  day30: 2592000,
  day90: 7776000,
  day365: 31536000,
});

export const indexName = (keys) =>
  Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');

const spec = (collection, keys, options = {}, extra = {}) => ({
  collection,
  keys,
  options: { ...options, name: options.name ?? indexName(keys) },
  ...extra,
});

const SOURCE_ID_FIELDS = ['crmUserId', 'bahikhataUserId', 'invoicingUserId', 'samadhanEmployeePk'];

const SRC_COLLECTIONS = [
  'fact_connections',
  'fact_connection_events',
  'fact_service_requests',
  'fact_sales_targets',
  'fact_invoices',
  'fact_credit_notes',
  'fact_ledger_entries',
  'fact_aging_daily',
  'legacy_collections',
  'fact_tickets',
  'fact_ticket_events',
  'communication_events',
  'text_chunks',
  'embeddings',
];

const TOMBSTONE_COLLECTIONS = [
  'fact_connections',
  'fact_connection_events',
  'fact_service_requests',
  'fact_invoices',
  'fact_credit_notes',
  'fact_ledger_entries',
  'fact_tickets',
  'fact_ticket_events',
  'communication_events',
];

export const INDEX_SPECS = Object.freeze([
  spec('employees', { email: 1 }, { unique: true }),
  spec('employees', { aiRole: 1, active: 1 }),
  spec('employees', { managerId: 1 }),
  ...SOURCE_ID_FIELDS.map((field) =>
    spec('employees', { [`sources.${field}`]: 1 }, { unique: true, sparse: true }),
  ),
  spec('employee_kpi_profiles', { employeeId: 1, profile: 1, effectiveFrom: -1 }),
  spec('customers', { 'sources.crmId': 1 }, { unique: true, sparse: true }),
  spec('customers', { 'sources.bahikhataId': 1 }, { sparse: true }),
  spec('customers', { 'sources.invoicingCrmCustomerId': 1 }, { sparse: true }),
  spec('customers', { 'sources.samadhanCustomerPk': 1 }, { sparse: true }),
  spec('customers', { nameNorm: 1 }),
  spec('customers', { 'mapping.samadhan.status': 1 }),
  spec('customers', { managedByEmployeeId: 1 }),
  spec('customers', { collectionsManagerEmployeeId: 1 }),
  spec('ai_clients', { keyHash: 1 }, { unique: true }),

  spec('data_sources', { state: 1 }),
  spec('data_sources', { logicalSource: 1, kind: 1 }),

  spec('fact_connections', { customerId: 1, status: 1 }),
  spec('fact_connections', { createdByEmployeeId: 1, status: 1 }),
  spec('fact_connections', { status: 1, srcUpdatedAt: -1 }),
  spec('fact_connection_events', { action: 1, date: -1 }),
  spec('fact_connection_events', { connectionId: 1, date: 1 }),
  spec('fact_connection_events', { performedByEmployeeId: 1, action: 1, date: -1 }),
  spec('fact_service_requests', { customerId: 1, status: 1 }),
  spec('fact_service_requests', { createdByEmployeeId: 1, requestType: 1, status: 1 }),
  spec('fact_sales_targets', { employeeId: 1, monthKey: 1 }, { unique: true }),
  spec('fact_invoices', { customerId: 1, paymentStatus: 1 }),
  spec('fact_invoices', { invoiceNumber: 1 }, { sparse: true }),
  spec('fact_invoices', { dueDate: 1, paymentStatus: 1 }),
  spec('fact_invoices', { invoiceDate: -1 }),
  spec('fact_credit_notes', { invoiceId: 1 }),
  spec('fact_ledger_entries', { customerId: 1, date: -1 }),
  spec('fact_ledger_entries', { status: 1, date: 1 }),
  spec('fact_ledger_entries', { invoiceNo: 1 }, { sparse: true }),
  spec('fact_ledger_entries', { addedByEmployeeId: 1, date: -1 }),
  spec('fact_aging_daily', { customerId: 1, asOfDate: -1 }),
  spec('legacy_collections', { employeeId: 1, monthKey: 1 }, { unique: true }),
  spec('fact_tickets', { customerId: 1, status: 1 }),
  spec('fact_tickets', { assigneeEmployeeId: 1, status: 1 }),
  spec('fact_tickets', { status: 1, resolvedAt: -1 }),
  spec('fact_tickets', { ticketNo: 1 }, { unique: true }),
  spec('fact_ticket_events', { ticketId: 1, createdAt: 1 }),
  spec('fact_ticket_events', { eventType: 1, newStatus: 1, createdAt: -1 }),
  spec('fact_ticket_events', { actorEmployeeId: 1, eventType: 1, createdAt: -1 }),
  spec('communication_events', { customerId: 1, sentAt: -1 }),
  spec('communication_events', { type: 1, status: 1, sentAt: -1 }),
  spec('communication_events', { 'documentRef.kind': 1, 'documentRef.id': 1 }),

  ...SRC_COLLECTIONS.map((collection) => spec(collection, { _src: 1 })),
  ...TOMBSTONE_COLLECTIONS.flatMap((collection) => [
    spec(collection, { _deleted: 1 }, { partialFilterExpression: { _deleted: true } }),
    spec(collection, { _runId: 1 }),
  ]),

  spec('text_chunks', { refType: 1, refId: 1 }),
  spec('text_chunks', { categoryCode: 1, status: 1, createdAt: -1 }),
  spec('text_chunks', { assigneeEmployeeId: 1 }),
  spec('embeddings', { refId: 1, model: 1 }, { unique: true }),
  spec('embeddings', { model: 1, refType: 1 }),

  spec(
    'prepared_answers',
    { employeeId: 1, intent: 1, paramsHash: 1, snapshotVersion: 1 },
    { unique: true },
  ),
  spec('prepared_answers', { usedSources: 1 }),
  spec('prepared_answers', { expiresAt: 1 }, { expireAfterSeconds: 0 }),
  spec('live_jobs', { employeeId: 1, createdAt: -1 }),
  spec('live_jobs', { expiresAt: 1 }, { expireAfterSeconds: 0 }),
  spec('question_log', { employeeId: 1, weekday: 1, matchedIntent: 1 }),
  spec('question_log', { outcome: 1, createdAt: -1 }),
  spec('question_log', { createdAt: 1 }, { expireAfterSeconds: SECONDS.day365 }),
  spec('feedback', { refType: 1, refId: 1 }),
  spec('unmatched_clusters', { status: 1, size: -1 }),

  spec('llm_usage_events', { ts: 1 }, { expireAfterSeconds: SECONDS.day90 }),
  spec('llm_usage_events', { model: 1, route: 1, ts: -1 }),
  spec('llm_usage_events', { employeeId: 1, ts: -1 }),
  spec('llm_usage_events', { outcome: 1, ts: -1 }),
  spec(
    'llm_usage_events',
    { ts: 1 },
    {
      name: 'text_ttl',
      expireAfterSeconds: SECONDS.day7,
      partialFilterExpression: { text: { $exists: true } },
    },
    { optional: true },
  ),
  spec('llm_usage_daily', { day: -1, model: 1, route: 1 }, { unique: true }),
  spec('system_samples', { ts: 1 }, { expireAfterSeconds: SECONDS.day30 }),
  spec('source_access_log', { ts: 1 }, { expireAfterSeconds: SECONDS.day30 }),
  spec('source_access_log', { sourceId: 1, ts: -1 }),
  spec('source_access_log', { sourceId: 1, action: 1, ts: -1 }),
  spec('source_inventory', { ts: 1 }, { expireAfterSeconds: SECONDS.day90 }),
  spec('source_inventory', { sourceId: 1, entity: 1, ts: -1 }),
  spec('kpi_readiness', { employeeId: 1, profile: 1, monthKey: 1 }, { unique: true }),
  spec('kpi_readiness', { status: 1, monthKey: 1 }),
  spec('activity_events', { ts: 1 }, { expireAfterSeconds: SECONDS.day30 }),
  spec('activity_events', { kind: 1, ts: -1 }),
  spec('activity_events', { sourceId: 1, ts: -1 }),
  spec('activity_events', { level: 1, ts: -1 }),
  spec('snapshot_runs', { startedAt: -1 }),
  spec('sync_quarantine', { createdAt: 1 }, { expireAfterSeconds: SECONDS.day30 }),
  spec('alerts', { openedAt: -1 }),
  spec('alerts', { ruleId: 1, closedAt: 1 }),
  spec('admin_audit', { at: -1 }),
  spec('admin_audit', { 'target.collection': 1, 'target.id': 1, at: -1 }),
]);

export const ensureIndexes = async (db) => {
  const ensured = [];
  let llmTextStore = 'llm_usage_events';

  for (const { collection, keys, options, optional } of INDEX_SPECS) {
    try {
      await db.collection(collection).createIndex(keys, options);
      ensured.push(`${collection}.${options.name}`);
    } catch (error) {
      if (!optional || !INDEX_CONFLICT_CODES.includes(error.code)) throw error;
      await db.createCollection(LLM_DEBUG_TEXT_COLLECTION).catch((createError) => {
        if (createError.code !== 48) throw createError;
      });
      await db
        .collection(LLM_DEBUG_TEXT_COLLECTION)
        .createIndex({ ts: 1 }, { name: 'ts_1', expireAfterSeconds: SECONDS.day7 });
      ensured.push(`${LLM_DEBUG_TEXT_COLLECTION}.ts_1`);
      llmTextStore = LLM_DEBUG_TEXT_COLLECTION;
    }
  }

  return { ensured, count: ensured.length, llmTextStore };
};

export const resolveLlmTextStore = async (db) => {
  const indexes = await db.collection('llm_usage_events').indexes();
  return indexes.some((index) => index.name === 'text_ttl')
    ? 'llm_usage_events'
    : LLM_DEBUG_TEXT_COLLECTION;
};
