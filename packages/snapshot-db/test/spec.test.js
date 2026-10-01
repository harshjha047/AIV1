import { describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  CURATED_COLLECTIONS,
  INDEX_SPECS,
  SECONDS,
  VALIDATION_OPTIONS,
  VALIDATORS,
  indexName,
} from '../src/index.js';

const byCollection = (collection) => INDEX_SPECS.filter((spec) => spec.collection === collection);
const named = (collection, name) =>
  INDEX_SPECS.find((s) => s.collection === collection && s.options.name === name);

describe('collections', () => {
  it('lists the 39 collections of BACKEND_SCHEMA_v2 without duplicates', () => {
    expect(COLLECTIONS).toHaveLength(39);
    expect(new Set(COLLECTIONS).size).toBe(39);
  });

  it('keeps curated collections inside the collection list', () => {
    for (const name of CURATED_COLLECTIONS) expect(COLLECTIONS).toContain(name);
  });
});

describe('index specs', () => {
  it('transcribes all 120 indexes of section 9', () => {
    expect(INDEX_SPECS).toHaveLength(120);
  });

  it('only targets known collections', () => {
    for (const spec of INDEX_SPECS) expect(COLLECTIONS).toContain(spec.collection);
  });

  it('uses unique names within a collection', () => {
    for (const collection of COLLECTIONS) {
      const names = byCollection(collection).map((spec) => spec.options.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('derives default names from the key pattern', () => {
    expect(indexName({ a: 1, 'b.c': -1 })).toBe('a_1_b.c_-1');
    expect(named('employees', 'email_1')).toBeDefined();
    expect(named('admin_audit', 'target.collection_1_target.id_1_at_-1')).toBeDefined();
  });

  it('indexes _src on every source-derived collection', () => {
    const expected = [
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
    for (const collection of expected) expect(named(collection, '_src_1')).toBeDefined();
  });

  it('adds tombstone and run indexes on the nine mutable fact collections', () => {
    const tombstoned = INDEX_SPECS.filter((s) => s.options.name === '_deleted_1');
    expect(tombstoned).toHaveLength(9);
    for (const spec of tombstoned) {
      expect(spec.options.partialFilterExpression).toEqual({ _deleted: true });
    }
    expect(INDEX_SPECS.filter((s) => s.options.name === '_runId_1')).toHaveLength(9);
  });

  it('enforces the documented unique indexes', () => {
    const unique = INDEX_SPECS.filter((s) => s.options.unique).map(
      (s) => `${s.collection}.${s.options.name}`,
    );
    expect(unique.sort()).toEqual(
      [
        'employees.email_1',
        'employees.sources.crmUserId_1',
        'employees.sources.bahikhataUserId_1',
        'employees.sources.invoicingUserId_1',
        'employees.sources.samadhanEmployeePk_1',
        'customers.sources.crmId_1',
        'ai_clients.keyHash_1',
        'fact_sales_targets.employeeId_1_monthKey_1',
        'legacy_collections.employeeId_1_monthKey_1',
        'fact_tickets.ticketNo_1',
        'embeddings.refId_1_model_1',
        'prepared_answers.employeeId_1_intent_1_paramsHash_1_snapshotVersion_1',
        'llm_usage_daily.day_-1_model_1_route_1',
        'kpi_readiness.employeeId_1_profile_1_monthKey_1',
      ].sort(),
    );
  });

  it('makes unique source-id indexes sparse', () => {
    for (const spec of INDEX_SPECS.filter(
      (s) =>
        s.collection === 'employees' &&
        s.options.unique &&
        s.keys['sources.crmUserId'] !== undefined,
    )) {
      expect(spec.options.sparse).toBe(true);
    }
  });

  it('applies the retention table as TTLs', () => {
    const ttl = Object.fromEntries(
      INDEX_SPECS.filter((s) => s.options.expireAfterSeconds !== undefined).map((s) => [
        `${s.collection}.${s.options.name}`,
        s.options.expireAfterSeconds,
      ]),
    );
    expect(ttl).toEqual({
      'prepared_answers.expiresAt_1': 0,
      'live_jobs.expiresAt_1': 0,
      'question_log.createdAt_1': 31536000,
      'llm_usage_events.ts_1': 7776000,
      'llm_usage_events.text_ttl': 604800,
      'system_samples.ts_1': 2592000,
      'source_access_log.ts_1': 2592000,
      'source_inventory.ts_1': 7776000,
      'activity_events.ts_1': 2592000,
      'sync_quarantine.createdAt_1': 2592000,
    });
    expect(SECONDS).toEqual({ day7: 604800, day30: 2592000, day90: 7776000, day365: 31536000 });
  });

  it('marks only the text-logging TTL as optional and partial', () => {
    const optional = INDEX_SPECS.filter((s) => s.optional);
    expect(optional).toHaveLength(1);
    expect(optional[0].options.partialFilterExpression).toEqual({ text: { $exists: true } });
  });

  it('declares no compound index on arrays twice', () => {
    for (const spec of INDEX_SPECS) {
      const arrays = Object.keys(spec.keys).filter((key) =>
        ['usedSources', 'allowedIps'].includes(key),
      );
      expect(arrays.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('validators', () => {
  it('only target known collections', () => {
    for (const name of Object.keys(VALIDATORS)) expect(COLLECTIONS).toContain(name);
  });

  it('covers every curated and runtime collection', () => {
    const covered = [
      ...CURATED_COLLECTIONS,
      'prepared_answers',
      'live_jobs',
      'question_log',
      'unmatched_clusters',
    ];
    for (const name of covered) expect(VALIDATORS[name], name).toBeDefined();
  });

  it('use moderate level and error action', () => {
    expect(VALIDATION_OPTIONS).toEqual({ validationLevel: 'moderate', validationAction: 'error' });
  });

  it('require only declared properties and never an empty required list', () => {
    const visit = (schema, path) => {
      if (schema.required !== undefined) {
        expect(schema.required.length, path).toBeGreaterThan(0);
        for (const key of schema.required)
          expect(schema.properties, `${path}.${key}`).toHaveProperty(key);
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (child.properties) visit(child, `${path}.${key}`);
      }
    };
    for (const [name, schema] of Object.entries(VALIDATORS)) visit(schema, name);
  });

  it('are serialisable', () => {
    for (const schema of Object.values(VALIDATORS)) {
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    }
  });
});
