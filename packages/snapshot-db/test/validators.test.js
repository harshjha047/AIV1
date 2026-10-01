import { describe, expect, it } from 'vitest';
import { VALIDATORS } from '../src/index.js';
import { validate } from './bson-schema.js';

const now = new Date('2026-10-01T10:00:00Z');
const ok = (collection, document) => validate(VALIDATORS[collection], document);

const employee = () => ({
  _id: 'emp_01J9ZK3M8Q',
  email: 'employee@example.com',
  name: 'Example Employee',
  aliases: ['Example'],
  active: true,
  aiRole: 'employee',
  managerId: 'emp_01J9ZK0A11',
  sources: { crmUserId: '6650f1a2b3c4d5e6f7a8b9c0', bahikhataUserId: '66a1' },
  sourceRoles: { crm: 'employee' },
  mappingStatus: 'partial',
  createdAt: now,
  updatedAt: now,
  updatedBy: 'emp_01J9ZK0A11',
});

const dataSource = () => ({
  _id: 'crm',
  displayName: 'CRM (MongoDB)',
  engine: 'mongodb',
  kind: 'real',
  logicalSource: 'crm',
  mode: 'practice',
  state: 'active',
  onDisable: 'hide',
  exposedObjects: ['ai_users_v', 'ai_connections_v'],
  credentialRef: 'env:SRC_CRM_URI',
  readOnlyCheck: {
    ok: true,
    status: 'ok',
    checkedAt: now,
    details: 'find only',
    authEnforced: true,
  },
  limits: { pageSize: 500, maxTimeMs: 30000, rowsPerMin: 20000 },
  pools: {},
  lastSuccessAt: now,
  lastError: null,
  stateChangedAt: now,
  stateChangedBy: 'emp_01J9ZK0A11',
  stateReason: 'Initial activation',
});

const preparedAnswer = () => ({
  _id: 'pa_20261002_emp01_my_kpi_sales_2026-09',
  employeeId: 'emp_01J9ZK3M8Q',
  intent: 'my_kpi',
  params: { profile: 'sales', period: '2026-09' },
  paramsHash: 'b7f',
  periodKey: '2026-09',
  snapshotVersion: '20261002-1',
  kpi: { profile: 'sales', attainmentPct: 84.0 },
  metricsHash: 'a41',
  factsText: 'text',
  commentary: null,
  finalText: 'text',
  model: null,
  status: 'ready',
  validator: { passed: true, issues: [] },
  usedSources: ['crm'],
  missingSources: [],
  asOf: { crm: now },
  createdAt: now,
  expiresAt: now,
});

describe('employees', () => {
  it('accepts the documented example', () => {
    expect(ok('employees', employee())).toEqual([]);
  });

  it('rejects unknown roles, bad emails, bad ids and missing fields', () => {
    expect(ok('employees', { ...employee(), aiRole: 'superuser' })).not.toEqual([]);
    expect(ok('employees', { ...employee(), email: 'not-an-email' })).not.toEqual([]);
    expect(ok('employees', { ...employee(), _id: 'abc' })).not.toEqual([]);
    const { name: _name, ...missing } = employee();
    expect(ok('employees', missing)).not.toEqual([]);
  });

  it('rejects null source ids so sparse unique indexes stay meaningful', () => {
    const doc = employee();
    doc.sources.invoicingUserId = null;
    expect(ok('employees', doc)).not.toEqual([]);
  });

  it('accepts numeric Samadhan keys', () => {
    const doc = employee();
    doc.sources.samadhanEmployeePk = 42;
    expect(ok('employees', doc)).toEqual([]);
  });

  it('allows a null manager', () => {
    expect(ok('employees', { ...employee(), managerId: null })).toEqual([]);
  });
});

describe('customers', () => {
  const customer = () => ({
    _id: 'cus_01J9ZK4P2X',
    name: 'EXAMPLE NETWORKS PRIVATE LIMITED',
    nameNorm: 'EXAMPLE NETWORKS',
    type: 'ISP',
    state: 'UTTAR PRADESH',
    active: true,
    sources: { crmId: '664a', bahikhataId: '665b', samadhanCustomerPk: 42 },
    mapping: { samadhan: { status: 'matched' } },
  });

  it('accepts the documented example and rejects null source ids', () => {
    expect(ok('customers', customer())).toEqual([]);
    const doc = customer();
    doc.sources.crmId = null;
    expect(ok('customers', doc)).not.toEqual([]);
  });
});

describe('data_sources', () => {
  it('accepts the documented example', () => {
    expect(ok('data_sources', dataSource())).toEqual([]);
  });

  it('rejects secrets-looking refs, bad states and bad engines', () => {
    expect(
      ok('data_sources', { ...dataSource(), credentialRef: 'mongodb://u:p@h/db' }),
    ).not.toEqual([]);
    expect(ok('data_sources', { ...dataSource(), state: 'archived' })).not.toEqual([]);
    expect(ok('data_sources', { ...dataSource(), engine: 'mysql' })).not.toEqual([]);
    expect(
      ok('data_sources', { ...dataSource(), logicalSource: 'samadhan_synthetic' }),
    ).not.toEqual([]);
  });

  it('accepts store references and synthetic sources', () => {
    expect(ok('data_sources', { ...dataSource(), credentialRef: 'store:crm' })).toEqual([]);
    expect(
      ok('data_sources', {
        ...dataSource(),
        _id: 'samadhan_synthetic',
        kind: 'synthetic',
        logicalSource: 'samadhan',
        engine: 'postgres',
      }),
    ).toEqual([]);
  });
});

describe('ai_clients', () => {
  const client = () => ({
    _id: 'hub',
    name: 'Hub',
    keyHash: 'a'.repeat(64),
    secretEnc: null,
    enabled: true,
    allowedIps: [],
    rateLimit: { perUserPerMin: 30, perAppPerMin: 300 },
    createdAt: now,
  });

  it('accepts a hashed key and rejects raw keys', () => {
    expect(ok('ai_clients', client())).toEqual([]);
    expect(ok('ai_clients', { ...client(), keyHash: 'plain-text-key' })).not.toEqual([]);
    expect(ok('ai_clients', { ...client(), _id: 'other' })).not.toEqual([]);
  });
});

describe('source_credentials', () => {
  it('requires the encrypted envelope', () => {
    const doc = {
      _id: 'crm',
      enc: { iv: 'a', tag: 'b', ciphertext: 'c' },
      keyId: 'k1',
      createdAt: now,
    };
    expect(ok('source_credentials', doc)).toEqual([]);
    expect(ok('source_credentials', { ...doc, enc: { iv: 'a' } })).not.toEqual([]);
  });
});

describe('prepared_answers', () => {
  it('accepts the documented example', () => {
    expect(ok('prepared_answers', preparedAnswer())).toEqual([]);
  });

  it('rejects unknown statuses and missing required fields', () => {
    expect(ok('prepared_answers', { ...preparedAnswer(), status: 'draft' })).not.toEqual([]);
    const { usedSources: _used, ...missing } = preparedAnswer();
    expect(ok('prepared_answers', missing)).not.toEqual([]);
  });
});

describe('runtime and operations collections', () => {
  it('validates question_log ranges and outcomes', () => {
    const doc = {
      _id: 'q1',
      employeeId: 'emp_1',
      appId: 'crm',
      text: 'my target',
      matchedIntent: 'my_kpi',
      score: 0.91,
      margin: 0.2,
      outcome: 'served_prepared',
      weekday: 3,
      hour: 9,
      createdAt: now,
    };
    expect(ok('question_log', doc)).toEqual([]);
    expect(ok('question_log', { ...doc, weekday: 7 })).not.toEqual([]);
    expect(ok('question_log', { ...doc, outcome: 'ignored' })).not.toEqual([]);
  });

  it('validates feedback rating and comment length', () => {
    const doc = {
      _id: 'f1',
      employeeId: 'emp_1',
      refType: 'live',
      refId: 'j1',
      rating: -1,
      createdAt: now,
    };
    expect(ok('feedback', doc)).toEqual([]);
    expect(ok('feedback', { ...doc, rating: 5 })).not.toEqual([]);
    expect(ok('feedback', { ...doc, comment: 'x'.repeat(501) })).not.toEqual([]);
  });

  it('validates unmatched cluster sample limit', () => {
    const doc = { _id: 'c1', size: 3, status: 'new', sampleQuestions: ['a', 'b'], createdAt: now };
    expect(ok('unmatched_clusters', doc)).toEqual([]);
    expect(
      ok('unmatched_clusters', { ...doc, sampleQuestions: ['1', '2', '3', '4', '5', '6'] }),
    ).not.toEqual([]);
  });

  it('validates the blocked source access log row from the schema example', () => {
    const doc = {
      ts: now,
      sourceId: 'crm',
      entity: 'connections',
      action: 'blocked',
      rows: 0,
      durationMs: 1,
      ok: false,
      triggeredBy: 'schedule',
      stateAtRead: 'disabled',
    };
    expect(ok('source_access_log', doc)).toEqual([]);
    expect(ok('source_access_log', { ...doc, action: 'write' })).not.toEqual([]);
  });

  it('validates the activity event example and its kind list', () => {
    const doc = {
      ts: now,
      kind: 'source_read',
      level: 'info',
      sourceId: 'crm',
      action: 'connections page',
      count: 500,
      durationMs: 840,
      ok: true,
      runId: '20260814-3',
      message: 'cursor advanced',
    };
    expect(ok('activity_events', doc)).toEqual([]);
    expect(ok('activity_events', { ...doc, kind: 'unknown' })).not.toEqual([]);
    expect(ok('activity_events', { ...doc, message: 'x'.repeat(201) })).not.toEqual([]);
  });

  it('validates llm_usage_events route and outcome', () => {
    const doc = { ts: now, route: 'night_draft', model: 'm', outcome: 'ok', promptTokens: 410 };
    expect(ok('llm_usage_events', doc)).toEqual([]);
    expect(ok('llm_usage_events', { ...doc, route: 'other' })).not.toEqual([]);
  });

  it('validates the snapshot run example', () => {
    const doc = {
      _id: '20261002-1',
      version: '20261002-1',
      trigger: 'schedule',
      startedAt: now,
      finishedAt: now,
      status: 'partial',
      sources: { samadhan: { ok: false, skippedReason: 'not_configured' } },
      promoted: true,
    };
    expect(ok('snapshot_runs', doc)).toEqual([]);
    expect(ok('snapshot_runs', { ...doc, status: 'running' })).not.toEqual([]);
  });

  it('validates admin_audit targets', () => {
    const doc = {
      _id: 'a1',
      actorEmployeeId: 'emp_1',
      action: 'source.disable',
      target: { collection: 'data_sources', id: 'crm' },
      reason: 'maintenance',
      at: now,
    };
    expect(ok('admin_audit', doc)).toEqual([]);
    expect(ok('admin_audit', { ...doc, target: { collection: 'data_sources' } })).not.toEqual([]);
  });

  it('validates meta singleton documents', () => {
    expect(ok('meta', { _id: 'guard', state: 'paused_large', since: now, reason: 'cpu' })).toEqual(
      [],
    );
    expect(ok('meta', { _id: 'guard', state: 'broken', since: now })).not.toEqual([]);
    expect(
      ok('meta', { _id: 'mode', mode: 'production', referenceDate: null, referenceAuto: true }),
    ).toEqual([]);
    expect(ok('meta', { _id: 'other' })).not.toEqual([]);
  });

  it('validates intents requirement shapes', () => {
    const doc = {
      _id: 'my_kpi',
      description: 'own KPI',
      allowedRoles: ['employee', 'manager'],
      domain: 'kpi',
      profile: 'sales',
      requiresSources: [['crm']],
      optionalSources: ['bahikhata'],
      templateKey: 'kpi.sales',
      active: true,
    };
    expect(ok('intents', doc)).toEqual([]);
    expect(ok('intents', { ...doc, requiresSources: ['crm'] })).not.toEqual([]);
    expect(ok('intents', { ...doc, allowedRoles: ['guest'] })).not.toEqual([]);
    expect(ok('intents', { ...doc, profile: null })).toEqual([]);
  });
});
