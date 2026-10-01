import { describe, expect, it } from 'vitest';
import {
  SYSTEM_FIELDS,
  contentHash,
  hashJson,
  sha1Hex,
  sha256Hex,
  stableStringify,
  textHash,
} from '../src/index.js';

describe('digests', () => {
  it('matches the published SHA test vectors', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('hashes text with SHA-1', () => {
    expect(textHash('abc')).toBe(sha1Hex('abc'));
    expect(textHash(42)).toBe(sha1Hex('42'));
  });
});

describe('stableStringify', () => {
  it('is independent of key order at every depth', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('keeps array order significant', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('drops undefined object members and turns undefined array items into null', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('serialises dates as ISO strings and binary as tagged base64', () => {
    expect(stableStringify({ d: new Date('2026-09-14T10:00:00Z') })).toBe(
      '{"d":"2026-09-14T10:00:00.000Z"}',
    );
    expect(stableStringify(new Uint8Array([1, 2, 3]))).toBe('"bin:AQID"');
  });

  it('honours toJSON for driver types such as ObjectId', () => {
    expect(stableStringify({ id: { toJSON: () => '6650f1a2b3c4d5e6f7a8b9c0' } })).toBe(
      '{"id":"6650f1a2b3c4d5e6f7a8b9c0"}',
    );
  });

  it('normalises negative zero and distinguishes types', () => {
    expect(stableStringify(-0)).toBe('0');
    expect(stableStringify('1')).not.toBe(stableStringify(1));
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(10n)).toBe('10');
  });

  it('refuses values that cannot be hashed deterministically', () => {
    expect(() => stableStringify(NaN)).toThrow(TypeError);
    expect(() => stableStringify({ a: Infinity })).toThrow(/\$\.a/);
    expect(() => stableStringify(new Date('x'))).toThrow(TypeError);
    expect(() => stableStringify(() => 1)).toThrow(TypeError);
    expect(() => stableStringify(undefined)).toThrow(TypeError);
    expect(() => stableStringify({ nested: { s: Symbol('x') } })).toThrow(/\$\.nested\.s/);
  });
});

describe('contentHash', () => {
  const row = () => ({
    _id: 'crm:6650aa',
    bandwidthMbps: 500,
    mrcPaise: 4500000,
    srcUpdatedAt: new Date('2026-09-14T06:30:05Z'),
    _src: 'crm',
    _hash: 'old',
    _runId: '20261002-1',
    _syncedAt: new Date('2026-10-01T22:41:00Z'),
    _deleted: false,
  });

  it('ignores every system field', () => {
    const base = contentHash(row());
    for (const field of SYSTEM_FIELDS) {
      const changed = { ...row(), [field]: field === '_deleted' ? true : 'changed' };
      expect(contentHash(changed)).toBe(base);
    }
    const stripped = { ...row() };
    for (const field of SYSTEM_FIELDS) delete stripped[field];
    expect(contentHash(stripped)).toBe(base);
  });

  it('changes when mapped content changes, including the id', () => {
    const base = contentHash(row());
    expect(contentHash({ ...row(), mrcPaise: 4500001 })).not.toBe(base);
    expect(contentHash({ ...row(), _id: 'crm:6650ab' })).not.toBe(base);
    expect(contentHash({ ...row(), srcUpdatedAt: new Date('2026-09-14T06:30:06Z') })).not.toBe(
      base,
    );
  });

  it('is independent of field order and returns 40 hex characters', () => {
    const reversed = Object.fromEntries(Object.entries(row()).reverse());
    expect(contentHash(reversed)).toBe(contentHash(row()));
    expect(contentHash(row())).toMatch(/^[a-f0-9]{40}$/);
  });

  it('supports a custom exclusion list', () => {
    const a = contentHash({ x: 1, y: 2 }, { exclude: ['y'] });
    const b = contentHash({ x: 1, y: 3 }, { exclude: ['y'] });
    expect(a).toBe(b);
  });

  it('treats an unset optional field the same as an absent one', () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: 1, b: null })).not.toBe(contentHash({ a: 1 }));
  });
});

describe('hashJson', () => {
  it('hashes parameter objects deterministically', () => {
    expect(hashJson({ profile: 'sales', period: '2026-09' })).toBe(
      hashJson({ period: '2026-09', profile: 'sales' }),
    );
    expect(hashJson({ profile: 'sales' })).not.toBe(hashJson({ profile: 'support' }));
  });

  it('treats a Date and its ISO string as the same content', () => {
    expect(hashJson({ d: new Date('2026-09-14T10:00:00Z') })).toBe(
      hashJson({ d: '2026-09-14T10:00:00.000Z' }),
    );
  });
});
