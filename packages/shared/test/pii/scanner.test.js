import { describe, expect, it } from 'vitest';
import {
  PiiViolationError,
  assertClean,
  scanDocument,
  scanDocuments,
  scanStream,
  scanText,
  summarizeHits
} from '../../src/pii/scanner.js';

const clean = {
  _id: 'crm:6650f1a2b3c4d5e6f7a8b9c0',
  _src: 'crm',
  customerId: 'cus_01HZX',
  bandwidthRaw: '100 Mbps',
  mrcPaise: 4500000,
  remarksSnippet: 'Upgrade approved by manager on 12 March for 2 links',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  embedding: new Float32Array([0.1, 0.2]),
  nested: { list: [{ note: 'ok' }, { note: 'fine' }] }
};

describe('scanDocument keys', () => {
  it('passes a clean document', () => {
    expect(scanDocument(clean)).toEqual([]);
  });

  it.each([
    ['password', { password: 'x' }],
    ['token', { auth: { token: 'x' } }],
    ['otp', { otp: 1 }],
    ['secret', { secret: 'x' }],
    ['aadhaar', { aadhaarNumber: 'x' }],
    ['adhar', { adharNumber: 'x' }],
    ['pan', { panNumber: 'x' }],
    ['array', { items: [{ refreshToken: 'x' }] }]
  ])('catches seeded key %s', (_name, doc) => {
    const hits = scanDocument(doc);
    expect(hits.some((hit) => hit.kind === 'key')).toBe(true);
  });

  it('reports the path without the value', () => {
    const hits = scanDocument({ owner: { passwordHash: 'hunter2hunter2' } });
    expect(hits).toEqual([{ path: 'owner.passwordHash', kind: 'key', rule: 'key_word' }]);
    expect(JSON.stringify(hits)).not.toContain('hunter2');
  });
});

describe('scanText values', () => {
  it('catches 12 consecutive digits', () => {
    expect(scanText('id 123456789012 end')).toContain('aadhaar_like');
    expect(scanText('id 1234567890123 end')).not.toContain('aadhaar_like');
    expect(scanText('id 12345678901 end')).not.toContain('aadhaar_like');
    expect(scanText('crm:6650f1234567890123abcdef')).not.toContain('aadhaar_like');
  });

  it('catches PAN patterns', () => {
    expect(scanText('pan is ABCDE1234F ok')).toContain('pan');
    expect(scanText('ABCDE1234FG')).not.toContain('pan');
    expect(scanText('abcde1234f')).not.toContain('pan');
  });

  it('catches otp and code adjacency in both directions', () => {
    expect(scanText('Your OTP is 482913')).toContain('otp_code');
    expect(scanText('code: 5521')).toContain('otp_code');
    expect(scanText('482913 is your OTP')).toContain('otp_code');
    expect(scanText('use 99887766 code')).toContain('otp_code');
    expect(scanText('code 123456789')).not.toContain('otp_code');
    expect(scanText('order 4821 shipped')).not.toContain('otp_code');
  });

  it('catches bearer strings', () => {
    expect(scanText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toContain('bearer');
    expect(scanText('the bearer of news')).not.toContain('bearer');
  });

  it('catches credential-like text near password', () => {
    expect(scanText('password: Winter2026!')).toContain('password_text');
    expect(scanText('The password is hunter2')).toContain('password_text');
    expect(scanText('forgot password flow')).not.toContain('password_text');
  });

  it('truncates very long strings before scanning', () => {
    const text = `${'a'.repeat(30000)} 123456789012`;
    expect(scanText(text, { maxStringLength: 1000 })).toEqual([]);
  });
});

describe('scanDocument values', () => {
  it('finds values in nested arrays with paths', () => {
    const hits = scanDocument({ events: [{ noteSnippet: 'call 123456789012 back' }] });
    expect(hits).toEqual([{ path: 'events[0].noteSnippet', kind: 'value', rule: 'aadhaar_like' }]);
  });

  it('skips configured value keys but still checks key names', () => {
    const doc = { invoiceNumber: '202609123456', note: 'fine' };
    expect(scanDocument(doc)).toHaveLength(1);
    expect(scanDocument(doc, { skipValueKeys: ['invoiceNumber'] })).toEqual([]);
  });

  it('does not scan numbers, dates, buffers or object ids', () => {
    const doc = {
      amount: 123456789012,
      at: new Date(),
      bin: Buffer.from('123456789012'),
      oid: { _bsontype: 'ObjectId', toString: () => '123456789012' }
    };
    expect(scanDocument(doc)).toEqual([]);
  });

  it('survives cycles', () => {
    const doc = { name: 'x' };
    doc.self = doc;
    expect(scanDocument(doc)).toEqual([]);
  });

  it('caps hits', () => {
    const doc = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`password${i}`, 'x']));
    expect(scanDocument(doc, { maxHits: 5 })).toHaveLength(5);
  });
});

describe('batch scanning', () => {
  const dirty = { _id: 'crm:1', remarksSnippet: 'pan ABCDE1234F' };

  it('scanDocuments aggregates hits with doc ids', () => {
    const result = scanDocuments([clean, dirty]);
    expect(result.ok).toBe(false);
    expect(result.scanned).toBe(2);
    expect(result.hits).toEqual([
      { path: 'remarksSnippet', kind: 'value', rule: 'pan', docId: 'crm:1' }
    ]);
    expect(summarizeHits(result.hits)).toEqual({ 'value:pan': 1 });
  });

  it('scanStream supports async iterables', async () => {
    async function* source() {
      yield clean;
      yield dirty;
    }
    const result = await scanStream(source());
    expect(result.ok).toBe(false);
    expect(result.scanned).toBe(2);
  });

  it('assertClean throws a PiiViolationError carrying hits', () => {
    const result = scanDocuments([dirty]);
    expect(() => assertClean(result)).toThrow(PiiViolationError);
    expect(assertClean(scanDocuments([clean])).ok).toBe(true);
  });
});
