export class ConfigError extends Error {
  constructor(issues) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const fail = (message) => {
  throw new Error(message);
};

export const str = (fallback = null) => ({ parse: (raw) => raw, fallback });

export const bool = (fallback) => ({
  parse: (raw) => {
    const value = raw.toLowerCase();
    if (['true', '1', 'yes'].includes(value)) return true;
    if (['false', '0', 'no'].includes(value)) return false;
    return fail('must be true or false');
  },
  fallback,
});

export const int = (
  fallback,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
) => ({
  parse: (raw) => {
    if (!/^-?\d+$/.test(raw)) fail('must be an integer');
    const value = Number(raw);
    if (value < min || value > max) fail(`must be between ${min} and ${max}`);
    return value;
  },
  fallback,
});

export const num = (fallback, { min = -Infinity, max = Infinity } = {}) => ({
  parse: (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) fail('must be a number');
    if (value < min || value > max) fail(`must be between ${min} and ${max}`);
    return value;
  },
  fallback,
});

export const oneOf = (values, fallback) => ({
  parse: (raw) => (values.includes(raw) ? raw : fail(`must be one of ${values.join(', ')}`)),
  fallback,
});

export const url = (fallback, protocols) => ({
  parse: (raw) => {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return fail('must be a valid URL');
    }
    if (protocols && !protocols.includes(parsed.protocol)) {
      return fail(`must use ${protocols.join(' or ')}`);
    }
    return raw;
  },
  fallback,
});

export const isoDate = (fallback) => ({
  parse: (raw) =>
    /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))
      ? raw
      : fail('must be YYYY-MM-DD'),
  fallback,
});

export const base64Key = (bytes, fallback) => ({
  parse: (raw) =>
    Buffer.from(raw, 'base64').length === bytes
      ? raw
      : fail(`must be ${bytes} bytes, base64 encoded`),
  fallback,
});

export const configSpec = {
  mode: ['MODE', oneOf(['practice', 'production'], 'practice')],
  nodeEnv: ['NODE_ENV', oneOf(['development', 'test', 'production'], 'development')],
  logLevel: [
    'LOG_LEVEL',
    oneOf(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], 'info'),
  ],
  servicePort: ['AI_SERVICE_PORT', int(4100, { min: 1, max: 65535 })],
  hubBaseUrl: ['HUB_BASE_URL', url('http://localhost:4101', ['http:', 'https:'])],
  mongoUri: ['AI_MONGO_URI', str()],
  redisUrl: ['AI_REDIS_URL', url('redis://127.0.0.1:6380', ['redis:', 'rediss:'])],
  ollamaUrl: ['OLLAMA_URL', url('http://127.0.0.1:11434', ['http:', 'https:'])],
  modelSmall: ['MODEL_SMALL', str()],
  modelLarge: ['MODEL_LARGE', str()],
  modelEmbed: ['MODEL_EMBED', str()],
  sourceCredMasterKey: ['SOURCE_CRED_MASTER_KEY', base64Key(32, null)],
  sourceStateTtlS: ['SOURCE_STATE_TTL_S', int(5, { min: 1, max: 300 })],
  referenceDate: ['REFERENCE_DATE', isoDate(null)],
  salesAttribution: ['SALES_ATTRIBUTION', oneOf(['createdBy', 'managedBy'], 'createdBy')],
  netLostMbps: ['NET_LOST_MBPS', bool(false)],
  supportAttribution: ['SUPPORT_ATTRIBUTION', oneOf(['resolver', 'assignee'], 'resolver')],
  repeatIssueWindowDays: ['REPEAT_ISSUE_WINDOW_DAYS', int(30, { min: 1, max: 365 })],
  resendPullEnabled: ['RESEND_PULL_ENABLED', bool(false)],
  llmTextLogging: ['LLM_TEXT_LOGGING', bool(false)],
  intentServe: ['INTENT_SERVE', num(0.8, { min: 0, max: 1 })],
  intentSuggest: ['INTENT_SUGGEST', num(0.65, { min: 0, max: 1 })],
  simMinSuggest: ['SIM_MIN_SUGGEST', num(0.72, { min: 0, max: 1 })],
  largeMaxWaitS: ['LARGE_MAX_WAIT_S', int(20, { min: 1, max: 600 })],
  guardCpuPct: ['GUARD_CPU_PCT', int(85, { min: 1, max: 100 })],
  guardLatencyX: ['GUARD_LATENCY_X', num(2, { min: 1, max: 100 })],
  onDisableDefault: ['ON_DISABLE_DEFAULT', oneOf(['keep', 'hide', 'purge'], 'hide')],
  inventoryRefreshMin: ['INVENTORY_REFRESH_MIN', int(15, { min: 1, max: 1440 })],
  verifyCron: ['VERIFY_CRON', str('30 3 * * *')],
  localAdminEmail: ['LOCAL_ADMIN_EMAIL', str()],
  localAdminPasswordHash: ['LOCAL_ADMIN_PASSWORD_HASH', str()],
};
