import { describe, expect, it } from 'vitest';
import { viewsSpecs } from '@fab5/sources';
import { generateSource } from '../src/views/index.js';
import {
  RemoteTargetError,
  allowListedPaths,
  assertLocalUri,
  buildInventory,
  collectPaths,
  hostsOf,
  pickPaths,
  recordSamples,
  skeletonize,
  typeOf,
  verifyPractice
} from '../src/index.js';

describe('skeletons', () => {
  it('replaces every value but keeps structure', () => {
    const skeleton = skeletonize({
      name: 'Asha Verma',
      aadhaar: '123412341234',
      n: 42,
      ok: true,
      when: new Date(),
      nested: { a: 'x', list: [{ k: 'v' }, { k: 'w' }, { k: 'z' }, { k: 'q' }] },
      none: null
    });
    expect(skeleton).toEqual({
      name: 's',
      aadhaar: 's',
      n: 0,
      ok: false,
      when: 's',
      nested: { a: 's', list: [{ k: 's' }, { k: 's' }, { k: 's' }] },
      none: null
    });
    expect(JSON.stringify(skeleton)).not.toContain('Asha');
    expect(JSON.stringify(skeleton)).not.toContain('1234');
  });

  it('identifies bson types', () => {
    expect(typeOf({ _bsontype: 'ObjectId' })).toBe('objectid');
    expect(typeOf([])).toBe('array');
    expect(typeOf(undefined)).toBe('null');
  });
});

describe('picking allow-listed paths', () => {
  it('keeps only listed paths and descends arrays', () => {
    const document = { a: { b: 1, secret: 2 }, items: [{ sourceType: 's', crm: 1 }], top: 1, drop: 1 };
    expect(pickPaths(document, ['a.b', 'items.sourceType', 'top'])).toEqual({
      a: { b: 1 },
      items: [{ sourceType: 's' }],
      top: 1
    });
  });

  it('groups source paths by collection', () => {
    const paths = allowListedPaths('crm');
    expect([...paths.keys()].sort()).toEqual(['connections', 'customers', 'salestargets', 'servicerequests', 'users']);
    expect(paths.get('connections')).toContain('history._id');
    expect(paths.get('users')).not.toContain('password');
  });
});

describe('inventory', () => {
  it('lists paths with counts, types and deny flags', () => {
    const inventory = buildInventory(
      'users',
      [{ name: 's', password: 's', profile: { adharNumber: 's' }, tags: [{ id: 0 }] }, { name: 's' }],
      10
    );
    expect(inventory.totalCount).toBe(10);
    const byPath = Object.fromEntries(inventory.fields.map((field) => [field.path, field]));
    expect(byPath.name.count).toBe(2);
    expect(byPath.password.denied).not.toBeNull();
    expect(byPath['profile.adharNumber'].denied).not.toBeNull();
    expect(byPath['tags.id'].types).toEqual(['number']);
    expect(byPath.name.denied).toBeNull();
    expect(collectPaths([{ a: 1 }]).get('a').count).toBe(1);
  });
});

function fakeDb(collections) {
  const calls = [];
  return {
    calls,
    listCollections: ({ name }) => ({ toArray: async () => (name in collections ? [{ name }] : []) }),
    collection: (name) => ({
      estimatedDocumentCount: async () => collections[name].length,
      aggregate: () => ({ toArray: async () => collections[name].slice(0, 2) }),
      find: (filter) => {
        calls.push({ name, filter });
        const [path] = Object.keys(filter);
        const get = (doc, segments) => {
          if (Array.isArray(doc)) return doc.some((item) => get(item, segments));
          if (!doc || typeof doc !== 'object') return false;
          const [head, ...tail] = segments;
          return head in doc && (tail.length === 0 || get(doc[head], tail));
        };
        return {
          limit: () => ({ toArray: async () => collections[name].filter((doc) => get(doc, path.split('.'))) })
        };
      }
    })
  };
}

describe('recordSamples', () => {
  const base = (extra = {}) => ({
    _id: 1,
    name: 'Real Name',
    email: 'real@corp.in',
    role: 'admin',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    password: 'hash',
    ...extra
  });

  it('writes structure-only samples, probes rare paths and never records values', async () => {
    const connection = {
      _id: 1,
      opportunityId: 'o',
      customer: 1,
      createdBy: 1,
      approvedBy: 1,
      activatedBy: 1,
      serviceType: 'x',
      bandwidth: 1,
      status: 's',
      acceptanceDate: 1,
      technicalDetails: { telcoProvider: 'p', aEnd: { btsId: 'a', address: 'secret street' }, bEnd: { btsId: 'b' } },
      commercials: { mrc: 1, otc: 1 },
      providerCost: { mrc: 1 },
      ips: { count: 1, cost: 1 },
      history: [{ _id: 1, action: 'a', date: 1, performedBy: 1, bandwidth: 1, commercials: { mrc: 1 }, note: 'n' }],
      createdAt: 1,
      updatedAt: 1
    };
    const rare = { ...connection, _id: 2, terminationDetails: { raiseDate: 1, finalDate: 1, reason: 'cust request' }, rejectionDetails: { rejectedAt: 1, reason: 'r' }, remarks: 'remarks text' };
    const store = {
      users: [base()],
      customers: [{ _id: 1, name: 'c', customerType: 't', managedBy: 1, isActive: true, createdAt: 1, updatedAt: 1, billingProfile: [{ address: { state: 'DL' } }] }],
      connections: [connection, connection, rare],
      servicerequests: [{ _id: 1, customer: 1, requestType: 't', status: 's', serviceType: 'x', bandwidthCurrent: 1, bandwidthRequested: 1, commercials: { mrc: 1 }, createdBy: 1, approvedBy: 1, raiseDate: 1, finalDisconnectionDate: 1, disconnectionReason: 'x', createdAt: 1, updatedAt: 1 }],
      salestargets: [{ _id: 1, employee: 1, monthStart: 1, targetMbps: 1, setBy: 1, createdAt: 1, updatedAt: 1 }]
    };
    const written = {};
    const db = fakeDb(store);
    const summary = await recordSamples({
      db,
      sourceId: 'crm',
      sampleSize: 2,
      write: async (name, data) => {
        written[name] = data;
      }
    });
    expect(summary.problems).toEqual([]);
    expect(summary.collections.connections.probed).toEqual(
      expect.arrayContaining(['terminationDetails.raiseDate', 'rejectionDetails.reason', 'remarks'])
    );
    expect(summary.collections.connections.missing).toEqual([]);
    const text = JSON.stringify(written);
    for (const secret of ['Real Name', 'real@corp.in', 'secret street', 'cust request', 'remarks text', 'hash']) {
      expect(text).not.toContain(secret);
    }
    expect(written['users.json'][0]).not.toHaveProperty('password');
    expect(written['users.json'][0]).toHaveProperty('email');
    expect(written['inventory.json'].collections.find((entry) => entry.collection === 'users').fields.some((field) => field.path === 'password' && field.denied)).toBe(true);
    const samples = Object.fromEntries(Object.entries(written).filter(([name]) => name !== 'inventory.json').map(([name, docs]) => [name.slice(0, -5), docs]));
    expect(() => generateSource(viewsSpecs.crm, { samples })).not.toThrow();
  });

  it('reports collections that do not exist', async () => {
    const summary = await recordSamples({ db: fakeDb({ users: [base()] }), sourceId: 'crm', write: async () => {} });
    expect(summary.problems.map((problem) => problem.collection).sort()).toEqual([
      'connections',
      'customers',
      'salestargets',
      'servicerequests'
    ]);
  });
});

function aiClient({ privileges, denied = new Set(), readable = true }) {
  return {
    db: (name) => ({
      command: async () => ({
        authInfo: {
          authenticatedUsers: [{ user: 'ai_ro', db: name }],
          authenticatedUserPrivileges: privileges
        },
        ok: 1
      }),
      collection: (collection) => ({
        find: () => ({
          limit: () => ({
            toArray: async () => {
              if (denied.has(collection)) throw Object.assign(new Error('not authorized'), { code: 13 });
              if (!readable) throw Object.assign(new Error('boom'), { code: 8 });
              return [];
            }
          })
        })
      })
    })
  };
}

describe('verifyPractice', () => {
  const spec = viewsSpecs.crm;
  const privileges = spec.views.map((view) => ({ resource: { db: 'crm_practice', collection: view.name }, actions: ['find'] }));
  const bases = new Set(['users', 'customers', 'connections', 'servicerequests', 'salestargets']);
  const now = () => new Date('2026-10-01T00:00:00Z');

  it('passes when views are readable and base collections denied', async () => {
    const result = await verifyPractice({ client: aiClient({ privileges, denied: bases }), spec, database: 'crm_practice', now });
    expect(result).toMatchObject({ ok: true, authEnforced: true, checkedAt: '2026-10-01T00:00:00.000Z' });
    expect(Object.values(result.bases).every((entry) => entry.outcome === 'denied')).toBe(true);
  });

  it('fails when a base collection is readable', async () => {
    const result = await verifyPractice({ client: aiClient({ privileges, denied: new Set(['users']) }), spec, database: 'crm_practice', now });
    expect(result.ok).toBe(false);
    expect(result.bases.connections.outcome).toBe('readable');
  });

  it('fails when a write privilege is granted', async () => {
    const withWrite = [...privileges, { resource: { db: 'crm_practice', collection: 'users' }, actions: ['insert'] }];
    const result = await verifyPractice({ client: aiClient({ privileges: withWrite, denied: bases }), spec, database: 'crm_practice', now });
    expect(result.ok).toBe(false);
    expect(result.verification.status).toBe('fail');
  });

  it('records auth not enforced', async () => {
    const client = {
      db: () => ({
        command: async () => ({ authInfo: { authenticatedUsers: [], authenticatedUserPrivileges: [] }, ok: 1 }),
        collection: () => ({ find: () => ({ limit: () => ({ toArray: async () => [] }) }) })
      })
    };
    const result = await verifyPractice({ client, spec, database: 'crm_practice', now });
    expect(result.authEnforced).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.verification.status).toBe('warn');
  });
});

describe('local target safety', () => {
  it('accepts local hosts and rejects others', () => {
    expect(assertLocalUri('mongodb://127.0.0.1:27017')).toEqual(['127.0.0.1']);
    expect(assertLocalUri('mongodb://user:pw@localhost:27017/db?authSource=admin')).toEqual(['localhost']);
    expect(hostsOf('mongodb://[::1]:27017')).toEqual(['[::1]']);
    expect(() => assertLocalUri('mongodb://db.prod.example.com:27017')).toThrow(RemoteTargetError);
    expect(() => assertLocalUri('mongodb://127.0.0.1,db.prod:27017')).toThrow(RemoteTargetError);
    expect(() => assertLocalUri('mongodb+srv://cluster.example.net')).toThrow(RemoteTargetError);
    expect(() => assertLocalUri('http://x')).toThrow(TypeError);
    expect(assertLocalUri('mongodb://db.prod:27017', { allowRemote: true })).toEqual(['db.prod']);
  });
});
