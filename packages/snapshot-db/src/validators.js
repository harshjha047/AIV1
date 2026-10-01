const str = { bsonType: 'string' };
const nstr = { bsonType: ['string', 'null'] };
const date = { bsonType: 'date' };
const ndate = { bsonType: ['date', 'null'] };
const bool = { bsonType: 'bool' };
const num = { bsonType: ['int', 'long', 'double', 'decimal'] };
const nnum = { bsonType: ['int', 'long', 'double', 'decimal', 'null'] };
const obj = { bsonType: 'object' };
const nobj = { bsonType: ['object', 'null'] };
const strArr = { bsonType: 'array', items: str };
const enumOf = (...values) => ({ enum: values });
const schema = (required, properties) =>
  required.length > 0
    ? { bsonType: 'object', required, properties }
    : { bsonType: 'object', properties };

const roles = ['employee', 'manager', 'admin', 'owner'];
const profiles = ['sales', 'collections', 'support'];
const externalId = { bsonType: ['string', 'int', 'long'] };

const meta = schema(['_id'], {
  _id: enumOf('snapshot', 'embedding', 'flags', 'guard', 'mode'),
  currentVersion: nstr,
  promotedAt: ndate,
  schemaVersion: num,
  perSource: obj,
  activeModel: nstr,
  dim: num,
  activatedAt: ndate,
  state: enumOf('ok', 'paused_large', 'paused_all'),
  since: date,
  reason: nstr,
  mode: enumOf('practice', 'production'),
  referenceDate: ndate,
  referenceAuto: bool,
  updatedBy: nstr,
  updatedAt: ndate,
});

const aiClients = schema(['_id', 'name', 'keyHash', 'enabled', 'createdAt'], {
  _id: enumOf('crm', 'bahikhata', 'samadhan', 'invoicing', 'hub'),
  name: str,
  keyHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
  secretEnc: nstr,
  enabled: bool,
  allowedIps: strArr,
  rateLimit: schema([], { perUserPerMin: num, perAppPerMin: num }),
  createdAt: date,
  rotatedAt: ndate,
  lastUsedAt: ndate,
});

const employees = schema(['_id', 'email', 'name', 'active', 'aiRole'], {
  _id: { bsonType: 'string', pattern: '^emp_' },
  email: { bsonType: 'string', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
  name: str,
  aliases: strArr,
  active: bool,
  aiRole: enumOf(...roles),
  managerId: { bsonType: ['string', 'null'] },
  sources: schema([], {
    crmUserId: str,
    bahikhataUserId: str,
    invoicingUserId: str,
    samadhanEmployeePk: externalId,
    samadhanUserPk: externalId,
  }),
  sourceRoles: obj,
  mappingStatus: enumOf('complete', 'partial'),
  createdAt: date,
  updatedAt: date,
  updatedBy: nstr,
});

const employeeKpiProfiles = schema(['_id', 'employeeId', 'profile', 'effectiveFrom'], {
  _id: str,
  employeeId: { bsonType: 'string', pattern: '^emp_' },
  profile: enumOf(...profiles),
  effectiveFrom: date,
  effectiveTo: ndate,
  overrides: nobj,
  createdBy: nstr,
  createdAt: date,
});

const customers = schema(['_id', 'name', 'nameNorm', 'active'], {
  _id: { bsonType: 'string', pattern: '^cus_' },
  name: str,
  nameNorm: str,
  type: str,
  state: nstr,
  active: bool,
  managedByEmployeeId: nstr,
  collectionsManagerEmployeeId: nstr,
  sources: schema([], {
    crmId: str,
    bahikhataId: str,
    invoicingCrmCustomerId: str,
    samadhanCustomerPk: externalId,
  }),
  mapping: obj,
  createdAt: date,
  updatedAt: date,
});

const intents = schema(
  [
    '_id',
    'description',
    'allowedRoles',
    'domain',
    'requiresSources',
    'optionalSources',
    'templateKey',
    'active',
  ],
  {
    _id: str,
    description: str,
    allowedRoles: { bsonType: 'array', items: enumOf(...roles) },
    domain: enumOf('kpi', 'customer', 'billing', 'tickets', 'communication'),
    profile: { enum: [...profiles, null] },
    requiresSources: { bsonType: 'array', items: strArr },
    optionalSources: strArr,
    paramsSchema: obj,
    examples: { bsonType: 'array' },
    templateKey: str,
    active: bool,
    version: num,
    updatedAt: date,
    updatedBy: nstr,
  },
);

const dataSources = schema(
  [
    '_id',
    'displayName',
    'engine',
    'kind',
    'logicalSource',
    'mode',
    'state',
    'onDisable',
    'exposedObjects',
    'credentialRef',
    'limits',
  ],
  {
    _id: str,
    displayName: str,
    engine: enumOf('mongodb', 'postgres'),
    kind: enumOf('real', 'synthetic'),
    logicalSource: enumOf('crm', 'bahikhata', 'invoicing', 'samadhan'),
    mode: enumOf('practice', 'production'),
    state: enumOf('not_configured', 'active', 'paused', 'disabled'),
    onDisable: enumOf('keep', 'hide', 'purge'),
    exposedObjects: strArr,
    credentialRef: { bsonType: 'string', pattern: '^(env|store):' },
    readOnlyCheck: nobj,
    limits: schema([], { pageSize: num, maxTimeMs: num, rowsPerMin: num }),
    pools: obj,
    lastSuccessAt: ndate,
    lastError: nstr,
    stateChangedAt: ndate,
    stateChangedBy: nstr,
    stateReason: nstr,
    purgedAt: ndate,
    createdAt: date,
    updatedAt: date,
  },
);

const sourceCredentials = schema(['_id', 'enc', 'keyId', 'createdAt'], {
  _id: str,
  enc: schema(['iv', 'tag', 'ciphertext'], { iv: str, tag: str, ciphertext: str }),
  keyId: str,
  createdAt: date,
  rotatedAt: ndate,
  createdBy: nstr,
});

const preparedAnswers = schema(
  [
    'employeeId',
    'intent',
    'paramsHash',
    'snapshotVersion',
    'status',
    'finalText',
    'usedSources',
    'expiresAt',
  ],
  {
    _id: str,
    employeeId: str,
    intent: str,
    params: obj,
    paramsHash: str,
    periodKey: nstr,
    snapshotVersion: str,
    kpi: obj,
    metricsHash: str,
    factsText: str,
    commentary: nstr,
    finalText: str,
    model: nstr,
    status: enumOf('ready', 'fallback', 'stale'),
    validator: schema([], { passed: bool, issues: { bsonType: 'array' } }),
    usedSources: strArr,
    missingSources: strArr,
    asOf: obj,
    createdAt: date,
    expiresAt: date,
  },
);

const liveJobs = schema(
  ['_id', 'employeeId', 'appId', 'text', 'route', 'status', 'createdAt', 'expiresAt'],
  {
    _id: str,
    employeeId: str,
    appId: str,
    text: str,
    intent: nstr,
    params: nobj,
    route: str,
    status: enumOf('queued', 'running', 'done', 'failed', 'cancelled'),
    quick: bool,
    refineOf: nstr,
    result: nobj,
    timings: nobj,
    model: nstr,
    error: nstr,
    createdAt: date,
    expiresAt: date,
  },
);

const questionLog = schema(['_id', 'employeeId', 'appId', 'text', 'outcome', 'createdAt'], {
  _id: str,
  employeeId: str,
  appId: str,
  text: str,
  embeddingId: nstr,
  matchedIntent: nstr,
  score: nnum,
  margin: nnum,
  outcome: enumOf(
    'served_prepared',
    'served_live',
    'suggested',
    'unmatched',
    'denied',
    'unavailable',
  ),
  weekday: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 6 },
  hour: { bsonType: ['int', 'long', 'double'], minimum: 0, maximum: 23 },
  createdAt: date,
});

const feedback = schema(['_id', 'employeeId', 'refType', 'refId', 'rating', 'createdAt'], {
  _id: str,
  employeeId: str,
  refType: enumOf('prepared', 'live'),
  refId: str,
  rating: enumOf(1, -1),
  comment: { bsonType: ['string', 'null'], maxLength: 500 },
  createdAt: date,
});

const unmatchedClusters = schema(['_id', 'size', 'status', 'createdAt'], {
  _id: str,
  centroid: { bsonType: ['binData', 'null'] },
  size: num,
  sampleQuestions: { bsonType: 'array', items: str, maxItems: 5 },
  status: enumOf('new', 'accepted', 'dismissed'),
  suggestedIntent: nstr,
  createdAt: date,
  updatedAt: date,
});

const llmUsageEvents = schema(['ts', 'route', 'model', 'outcome'], {
  ts: date,
  requestId: str,
  jobId: str,
  route: enumOf('night_draft', 'night_review', 'live_small', 'live_large', 'refine', 'embed'),
  model: str,
  employeeId: nstr,
  intent: nstr,
  attempts: num,
  outcome: enumOf('ok', 'timeout', 'cancelled', 'validator_fail', 'error'),
  errorClass: nstr,
  text: obj,
});

const sourceAccessLog = schema(['ts', 'sourceId', 'action', 'rows', 'ok'], {
  ts: date,
  sourceId: str,
  entity: nstr,
  action: enumOf('read_page', 'count', 'verify', 'blocked'),
  rows: num,
  durationMs: num,
  ok: bool,
  error: { bsonType: ['string', 'null'], maxLength: 200 },
  runId: nstr,
  triggeredBy: enumOf('schedule', 'manual', 'dashboard'),
  stateAtRead: nstr,
});

const activityEvents = schema(['ts', 'kind', 'level', 'action', 'ok'], {
  ts: date,
  kind: enumOf(
    'source_read',
    'blocked',
    'sync_run',
    'kpi_compute',
    'draft',
    'validate',
    'llm_call',
    'toggle',
    'verify',
    'inventory',
    'purge',
    'alert',
  ),
  level: enumOf('info', 'warn', 'error'),
  sourceId: nstr,
  action: str,
  count: nnum,
  durationMs: nnum,
  ok: bool,
  runId: nstr,
  refType: nstr,
  refId: nstr,
  message: { bsonType: ['string', 'null'], maxLength: 200 },
});

const snapshotRuns = schema(['_id', 'version', 'trigger', 'startedAt', 'status'], {
  _id: str,
  version: str,
  trigger: enumOf('schedule', 'manual', 'backfill'),
  startedAt: date,
  finishedAt: ndate,
  status: enumOf('ok', 'partial', 'failed'),
  sources: obj,
  embedded: obj,
  kpi: obj,
  drafts: obj,
  piiScan: obj,
  promoted: bool,
});

const alerts = schema(['_id', 'ruleId', 'severity', 'message', 'openedAt'], {
  _id: str,
  ruleId: str,
  severity: str,
  message: str,
  openedAt: date,
  closedAt: ndate,
  ack: nobj,
  context: obj,
});

const adminAudit = schema(['_id', 'actorEmployeeId', 'action', 'target', 'at'], {
  _id: str,
  actorEmployeeId: str,
  action: str,
  target: schema(['collection', 'id'], { collection: str, id: {} }),
  reason: nstr,
  before: nobj,
  after: nobj,
  at: date,
  requestId: nstr,
});

export const VALIDATORS = Object.freeze({
  meta,
  ai_clients: aiClients,
  employees,
  employee_kpi_profiles: employeeKpiProfiles,
  customers,
  intents,
  data_sources: dataSources,
  source_credentials: sourceCredentials,
  prepared_answers: preparedAnswers,
  live_jobs: liveJobs,
  question_log: questionLog,
  feedback,
  unmatched_clusters: unmatchedClusters,
  llm_usage_events: llmUsageEvents,
  source_access_log: sourceAccessLog,
  activity_events: activityEvents,
  snapshot_runs: snapshotRuns,
  alerts,
  admin_audit: adminAudit,
});

export const VALIDATION_OPTIONS = Object.freeze({
  validationLevel: 'moderate',
  validationAction: 'error',
});
