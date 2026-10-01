export const SNAPSHOT_DB_NAME = 'ai_snapshot';
export const MIGRATIONS_COLLECTION = 'schema_migrations';
export const LLM_DEBUG_TEXT_COLLECTION = 'llm_debug_text';

export const COLLECTIONS = Object.freeze([
  'meta',
  'ai_clients',
  'employees',
  'employee_kpi_profiles',
  'customers',
  'intents',
  'data_sources',
  'source_credentials',
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
  'prepared_answers',
  'live_jobs',
  'question_log',
  'feedback',
  'unmatched_clusters',
  'llm_usage_events',
  'llm_usage_daily',
  'system_samples',
  'source_access_log',
  'source_inventory',
  'kpi_readiness',
  'activity_events',
  'snapshot_runs',
  'sync_state',
  'sync_quarantine',
  'alerts',
  'admin_audit',
]);

export const CURATED_COLLECTIONS = Object.freeze([
  'ai_clients',
  'employees',
  'employee_kpi_profiles',
  'customers',
  'intents',
  'feedback',
  'admin_audit',
  'meta',
  'data_sources',
  'source_credentials',
]);

export const DUPLICATE_KEY = 11000;
export const NAMESPACE_EXISTS = 48;
export const INDEX_CONFLICT_CODES = Object.freeze([67, 85, 86]);
