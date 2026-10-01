import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { ConfigError, configSpec } from './schema.js';

export { ConfigError } from './schema.js';

export const loadEnvFile = (path = '.env', target = process.env) => {
  if (!existsSync(path)) return false;
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value;
  }
  return true;
};

export const parseConfig = (env = process.env, { require = [] } = {}) => {
  const issues = [];
  const config = {};

  for (const [key, [variable, spec]] of Object.entries(configSpec)) {
    const raw = env[variable];
    if (raw === undefined || raw === '') {
      config[key] = spec.fallback;
      continue;
    }
    try {
      config[key] = spec.parse(raw.trim());
    } catch (error) {
      issues.push(`${variable} ${error.message}`);
    }
  }

  for (const key of require) {
    if (!(key in configSpec)) {
      issues.push(`unknown required key ${key}`);
    } else if (config[key] === null || config[key] === undefined || config[key] === '') {
      issues.push(`${configSpec[key][0]} is required`);
    }
  }

  if (config.mode === 'production') {
    if (config.localAdminEmail || config.localAdminPasswordHash) {
      issues.push('LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD_HASH are refused in production mode');
    }
    if (config.referenceDate) {
      issues.push('REFERENCE_DATE is refused in production mode');
    }
  }

  if (config.intentSuggest > config.intentServe) {
    issues.push('INTENT_SUGGEST must not exceed INTENT_SERVE');
  }

  if (issues.length > 0) throw new ConfigError(issues);
  return Object.freeze(config);
};

export const loadConfig = ({ envFile = '.env', env = process.env, require = [] } = {}) => {
  loadEnvFile(envFile, env);
  return parseConfig(env, { require });
};
