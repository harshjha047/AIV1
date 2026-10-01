import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadEnvFile, parseConfig } from '../src/index.js';

const key32 = Buffer.alloc(32, 7).toString('base64');

describe('parseConfig', () => {
  it('applies documented defaults', () => {
    const config = parseConfig({});
    expect(config).toMatchObject({
      mode: 'practice',
      servicePort: 4100,
      ollamaUrl: 'http://127.0.0.1:11434',
      redisUrl: 'redis://127.0.0.1:6380',
      sourceStateTtlS: 5,
      salesAttribution: 'createdBy',
      supportAttribution: 'resolver',
      netLostMbps: false,
      repeatIssueWindowDays: 30,
      resendPullEnabled: false,
      llmTextLogging: false,
      intentServe: 0.8,
      intentSuggest: 0.65,
      simMinSuggest: 0.72,
      largeMaxWaitS: 20,
      guardCpuPct: 85,
      guardLatencyX: 2,
      onDisableDefault: 'hide',
      inventoryRefreshMin: 15,
      verifyCron: '30 3 * * *',
      mongoUri: null,
    });
  });

  it('parses overrides with correct types', () => {
    const config = parseConfig({
      MODE: 'production',
      AI_SERVICE_PORT: '5000',
      NET_LOST_MBPS: 'TRUE',
      SALES_ATTRIBUTION: 'managedBy',
      INTENT_SERVE: '0.9',
      SOURCE_CRED_MASTER_KEY: key32,
    });
    expect(config.mode).toBe('production');
    expect(config.servicePort).toBe(5000);
    expect(config.netLostMbps).toBe(true);
    expect(config.salesAttribution).toBe('managedBy');
    expect(config.intentServe).toBe(0.9);
  });

  it('returns a frozen object', () => {
    const config = parseConfig({});
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('collects every issue in one error', () => {
    let error;
    try {
      parseConfig({
        MODE: 'staging',
        AI_SERVICE_PORT: 'abc',
        NET_LOST_MBPS: 'maybe',
        OLLAMA_URL: 'not a url',
        SOURCE_CRED_MASTER_KEY: 'c2hvcnQ=',
        SOURCE_STATE_TTL_S: '0',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.issues).toHaveLength(6);
    expect(error.issues.join(' ')).toContain('MODE must be one of practice, production');
    expect(error.issues.join(' ')).toContain('SOURCE_CRED_MASTER_KEY must be 32 bytes');
  });

  it('treats empty strings as unset', () => {
    expect(parseConfig({ AI_SERVICE_PORT: '', MODEL_SMALL: '' }).servicePort).toBe(4100);
  });

  it('enforces required keys', () => {
    expect(() => parseConfig({}, { require: ['mongoUri', 'modelSmall'] })).toThrow(
      /AI_MONGO_URI is required; MODEL_SMALL is required/,
    );
    expect(
      parseConfig(
        { AI_MONGO_URI: 'mongodb://127.0.0.1:27017/ai_snapshot' },
        { require: ['mongoUri'] },
      ).mongoUri,
    ).toBe('mongodb://127.0.0.1:27017/ai_snapshot');
  });

  it('rejects unknown required keys', () => {
    expect(() => parseConfig({}, { require: ['nope'] })).toThrow(/unknown required key nope/);
  });

  it('refuses local admin and reference date in production', () => {
    expect(() => parseConfig({ MODE: 'production', LOCAL_ADMIN_EMAIL: 'a@b.c' })).toThrow(
      /refused in production/,
    );
    expect(() => parseConfig({ MODE: 'production', REFERENCE_DATE: '2025-01-01' })).toThrow(
      /REFERENCE_DATE/,
    );
    expect(
      parseConfig({ MODE: 'practice', LOCAL_ADMIN_EMAIL: 'a@b.c', REFERENCE_DATE: '2025-01-01' })
        .referenceDate,
    ).toBe('2025-01-01');
  });

  it('rejects inverted intent thresholds', () => {
    expect(() => parseConfig({ INTENT_SERVE: '0.5', INTENT_SUGGEST: '0.6' })).toThrow(
      /INTENT_SUGGEST/,
    );
  });

  it('rejects invalid reference dates', () => {
    expect(() => parseConfig({ REFERENCE_DATE: '2025-13-45' })).toThrow(/YYYY-MM-DD/);
  });
});

describe('loadEnvFile', () => {
  const writeEnv = (content) => {
    const dir = mkdtempSync(join(tmpdir(), 'fab5-env-'));
    const path = join(dir, '.env');
    writeFileSync(path, content);
    return path;
  };

  it('returns false when the file is missing', () => {
    expect(loadEnvFile(join(tmpdir(), 'does-not-exist.env'), {})).toBe(false);
  });

  it('fills unset keys and keeps existing ones', () => {
    const path = writeEnv('MODE=production\nAI_SERVICE_PORT=4200\n');
    const target = { MODE: 'practice' };
    expect(loadEnvFile(path, target)).toBe(true);
    expect(target).toEqual({ MODE: 'practice', AI_SERVICE_PORT: '4200' });
  });

  it('loadConfig reads the file then validates', () => {
    const path = writeEnv('AI_SERVICE_PORT=4300\nLOG_LEVEL=debug\n');
    const config = loadConfig({ envFile: path, env: {} });
    expect(config.servicePort).toBe(4300);
    expect(config.logLevel).toBe('debug');
  });
});
