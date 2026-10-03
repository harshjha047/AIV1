import { describe, expect, it } from 'vitest';
import { CONTRACTS, listContracts, validateContract } from '../contracts/index.js';
import { matchDeniedKey } from '../src/pii/denyList.js';

const connection = () => ({
  _id: 'crm:1',
  opportunityId: 'OPP-1',
  customerId: null,
  customerSourceId: 'c1',
  createdByEmployeeId: null,
  approvedByEmployeeId: null,
  activatedByEmployeeId: null,
  serviceType: 'ILL',
  bandwidthRaw: '100 Mbps',
  bandwidthMbps: 100,
  bandwidthParsed: true,
  telcoProvider: null,
  status: 'Active',
  mrcPaise: 1000,
  otcPaise: null,
  providerMrcPaise: null,
  marginMrcPaise: null,
  ipCount: null,
  ipCostPaise: null,
  aEndBtsId: null,
  bEndBtsId: null,
  acceptanceDate: null,
  remarksSnippet: null,
  termination: null,
  rejection: null,
  srcCreatedAt: null,
  srcUpdatedAt: new Date('2026-08-01T00:00:00.000Z')
});

describe('contracts', () => {
  it('compiles every contract', () => {
    expect(listContracts().length).toBeGreaterThanOrEqual(9);
    for (const id of listContracts()) expect(() => validateContract(id, {})).not.toThrow();
  });

  it('rejects unknown contract ids', () => {
    expect(() => validateContract('crm.nothing', {})).toThrow(/Unknown contract/);
  });

  it('never declares a deny-listed property', () => {
    const walk = (node, path, hits) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (matchDeniedKey(key)) hits.push(`${path}.${key}`);
        walk(child, `${path}.${key}`, hits);
        for (const branch of child.anyOf ?? []) walk(branch, `${path}.${key}`, hits);
      }
    };
    for (const [id, schema] of Object.entries(CONTRACTS)) {
      const hits = [];
      walk(schema, id, hits);
      expect(hits, id).toEqual([]);
      expect(schema.additionalProperties, id).toBe(false);
    }
  });

  it('accepts a complete row', () => {
    expect(validateContract('crm.connections', connection())).toEqual({ ok: true, reason: null });
  });

  it('names a missing property', () => {
    const { mrcPaise, ...rest } = connection();
    expect(mrcPaise).toBe(1000);
    expect(validateContract('crm.connections', rest)).toEqual({
      ok: false,
      reason: '(root): missing property mrcPaise'
    });
  });

  it('names an unexpected property', () => {
    const result = validateContract('crm.connections', { ...connection(), password: 'x' });
    expect(result).toEqual({ ok: false, reason: '(root): unexpected property password' });
  });

  it('treats undefined as missing', () => {
    expect(validateContract('crm.connections', { ...connection(), status: undefined }).ok).toBe(
      false
    );
  });

  it('rejects a wrong type with its path and never echoes the value', () => {
    const result = validateContract('crm.connections', { ...connection(), mrcPaise: '1000' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('mrcPaise');
    expect(result.reason).not.toContain('"1000"');
  });

  it('rejects fractional paise', () => {
    expect(validateContract('crm.connections', { ...connection(), mrcPaise: 10.5 }).ok).toBe(false);
  });

  it('requires real Date objects', () => {
    expect(
      validateContract('crm.connections', { ...connection(), srcUpdatedAt: '2026-08-01' }).ok
    ).toBe(false);
    expect(
      validateContract('crm.connections', { ...connection(), srcUpdatedAt: new Date('nope') }).ok
    ).toBe(false);
    expect(
      validateContract('crm.connections', { ...connection(), srcCreatedAt: new Date('2026-08-01') })
        .ok
    ).toBe(true);
  });

  it('validates nested objects and forbids extra keys inside them', () => {
    const ok = { raiseDate: null, finalDate: new Date('2026-08-01'), reasonSnippet: 'x' };
    expect(validateContract('crm.connections', { ...connection(), termination: ok }).ok).toBe(true);
    expect(
      validateContract('crm.connections', { ...connection(), termination: { ...ok, extra: 1 } }).ok
    ).toBe(false);
    expect(
      validateContract('crm.connections', { ...connection(), termination: { raiseDate: 'x' } }).ok
    ).toBe(false);
  });

  it('constrains the sales target month key', () => {
    const target = {
      _id: 'crm:t',
      employeeId: null,
      employeeSourceId: 'e1',
      monthKey: '2026-09',
      monthStart: new Date('2026-08-31T18:30:00.000Z'),
      targetMbps: 1500,
      setByEmployeeId: null,
      srcUpdatedAt: new Date('2026-08-01T00:00:00.000Z')
    };
    expect(validateContract('crm.sales_targets', target).ok).toBe(true);
    expect(validateContract('crm.sales_targets', { ...target, monthKey: '2026-13' }).ok).toBe(
      false
    );
    expect(validateContract('crm.sales_targets', { ...target, monthKey: 'Sept' }).ok).toBe(false);
  });

  it('requires a plausible employee email', () => {
    const employee = {
      _id: 'crm:u',
      sourceUserId: 'u',
      email: 'a@example.com',
      name: 'A',
      sourceRole: null,
      active: true,
      srcCreatedAt: null,
      srcUpdatedAt: new Date('2026-08-01T00:00:00.000Z')
    };
    expect(validateContract('crm.employees', employee).ok).toBe(true);
    expect(validateContract('crm.employees', { ...employee, email: 'nope' }).ok).toBe(false);
    expect(validateContract('crm.employees', { ...employee, name: '' }).ok).toBe(false);
  });
});
