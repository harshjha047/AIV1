import { describe, expect, it } from 'vitest';
import { assertSnapshotUri, openSnapshotDb, snapshotDbNameFromUri } from '../src/index.js';

describe('snapshotDbNameFromUri', () => {
  it('extracts the database path', () => {
    expect(
      snapshotDbNameFromUri('mongodb://u:p@127.0.0.1:27017/ai_snapshot?authSource=admin'),
    ).toBe('ai_snapshot');
    expect(snapshotDbNameFromUri('mongodb+srv://u:p@cluster.example.net/ai_snapshot')).toBe(
      'ai_snapshot',
    );
    expect(snapshotDbNameFromUri('mongodb://a:1,b:2/other?replicaSet=rs0')).toBe('other');
  });

  it('returns null when no database is given', () => {
    expect(snapshotDbNameFromUri('mongodb://127.0.0.1:27017')).toBeNull();
    expect(snapshotDbNameFromUri('mongodb://127.0.0.1:27017/')).toBeNull();
    expect(snapshotDbNameFromUri('mongodb://127.0.0.1:27017/?appName=x')).toBeNull();
  });
});

describe('assertSnapshotUri', () => {
  it('accepts ai_snapshot or no database', () => {
    expect(assertSnapshotUri('mongodb://127.0.0.1:27017/ai_snapshot')).toBe(
      'mongodb://127.0.0.1:27017/ai_snapshot',
    );
    expect(assertSnapshotUri('mongodb://127.0.0.1:27017')).toBe('mongodb://127.0.0.1:27017');
  });

  it('refuses any other database so source or app databases cannot be opened here', () => {
    expect(() => assertSnapshotUri('mongodb://127.0.0.1:27017/fab5_crm')).toThrow(/hard-wired/);
  });

  it('refuses non-mongodb values', () => {
    expect(() => assertSnapshotUri('postgres://h/db')).toThrow(/mongodb/);
    expect(() => assertSnapshotUri(undefined)).toThrow(/mongodb/);
  });
});

describe('openSnapshotDb', () => {
  it('rejects before connecting when the URI names another database', async () => {
    await expect(openSnapshotDb({ uri: 'mongodb://127.0.0.1:1/fab5_crm' })).rejects.toThrow(
      /hard-wired/,
    );
  });
});
