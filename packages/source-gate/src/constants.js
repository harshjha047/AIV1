export const SOURCE_CHANGED_CHANNEL = 'ai:source:changed';
export const SOURCE_STATES = Object.freeze(['not_configured', 'active', 'paused', 'disabled']);
export const ON_DISABLE_POLICIES = Object.freeze(['keep', 'hide', 'purge']);
export const DEFAULT_LIMITS = Object.freeze({ pageSize: 500, maxTimeMs: 30000, rowsPerMin: 20000 });
export const DEFAULT_STATE_TTL_MS = 5000;
export const POOL_SIZES = Object.freeze({ mongodb: 2, postgres: 3 });

export function resolveLimits(source) {
  return { ...DEFAULT_LIMITS, ...(source.limits ?? {}) };
}

export function limitsFromEnv(sourceId, env = process.env) {
  const prefix = `SRC_${sourceId.toUpperCase()}`;
  const read = (suffix, fallback) => {
    const value = Number(env[`${prefix}_${suffix}`]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    pageSize: read('PAGE_SIZE', DEFAULT_LIMITS.pageSize),
    maxTimeMs: read('MAX_TIME_MS', DEFAULT_LIMITS.maxTimeMs),
    rowsPerMin: read('ROWS_PER_MIN', DEFAULT_LIMITS.rowsPerMin)
  };
}
