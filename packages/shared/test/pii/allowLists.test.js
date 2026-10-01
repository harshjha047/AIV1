import { describe, expect, it } from 'vitest';
import {
  VIEW_ALLOW_LISTS,
  ViewSpecViolationError,
  allowedOutputFields,
  assertEntityOutputFields,
  assertViewSpecClean,
  getViewAllowList,
  listSources,
  listViews,
  sourcePathsToVerify,
  validateAllViewSpecs,
  validateViewSpec
} from '../../src/pii/allowLists.js';

describe('shipped allow-lists', () => {
  it('cover crm, bahikhata, invoicing and samadhan', () => {
    expect(listSources()).toEqual(['crm', 'bahikhata', 'invoicing', 'samadhan']);
  });

  it('contain every view named in BACKEND_SCHEMA 7.1 to 7.3', () => {
    expect(listViews('crm')).toEqual([
      'ai_users_v',
      'ai_customers_v',
      'ai_connections_v',
      'ai_connection_events_v',
      'ai_service_requests_v',
      'ai_sales_targets_v'
    ]);
    expect(listViews('bahikhata')).toEqual(['ai_users_v', 'ai_customers_v', 'ai_ledger_v']);
    expect(listViews('invoicing')).toEqual([
      'ai_users_v',
      'ai_invoices_v',
      'ai_credit_notes_v',
      'ai_email_logs_v'
    ]);
  });

  it('have no violations', () => {
    expect(validateAllViewSpecs()).toEqual([]);
  });

  it('never include a never-exported CRM user field', () => {
    const fields = allowedOutputFields(getViewAllowList('crm', 'ai_users_v'));
    for (const hidden of ['password', 'dob', 'phone', 'adharNumber', 'panNumber', 'refreshToken']) {
      expect(fields).not.toContain(hidden);
    }
  });

  it('are deeply frozen', () => {
    expect(() => VIEW_ALLOW_LISTS.crm.views.ai_users_v.include.push('password')).toThrow();
  });

  it('expose the paths used for field-existence checks', () => {
    const paths = sourcePathsToVerify(getViewAllowList('crm', 'ai_connection_events_v'));
    expect(paths).toContain('history.action');
    expect(paths).toContain('history.commercials.mrc');
    expect(paths).toContain('updatedAt');
  });

  it('flags drops in entity output', () => {
    const extras = assertEntityOutputFields('crm', 'ai_users_v', {
      _id: 'x',
      name: 'a',
      email: 'b',
      phone: '1'
    });
    expect(extras).toEqual(['phone']);
  });
});

describe('seeded violations are caught', () => {
  const base = () => ({
    entity: 'employees',
    collection: 'users',
    include: ['name', 'email'],
    computed: [],
    neverExported: ['password']
  });

  it('deny-listed key in include', () => {
    const spec = { ...base(), include: ['name', 'adharNumber'] };
    expect(validateViewSpec(spec)).toContainEqual(
      expect.objectContaining({ rule: 'deny_listed_key', path: 'adharNumber' })
    );
  });

  it('deny-listed nested segment', () => {
    const spec = { ...base(), include: ['profile.panNumber'] };
    expect(validateViewSpec(spec).map((v) => v.rule)).toContain('deny_listed_key');
  });

  it('deny-listed key read by a computed field', () => {
    const spec = {
      ...base(),
      computed: [{ name: 'safe', reads: ['refreshToken'], expr: { op: 'ref', field: 'refreshToken' } }]
    };
    expect(validateViewSpec(spec).map((v) => v.rule)).toContain('deny_listed_key');
  });

  it('deny-listed key in the unwind block', () => {
    const spec = {
      ...base(),
      unwind: { path: 'history', include: ['otp'], computed: [], rootAs: {} }
    };
    expect(validateViewSpec(spec).map((v) => v.rule)).toContain('deny_listed_key');
  });

  it('exclusion style paths and wildcards', () => {
    expect(validateViewSpec({ ...base(), include: ['-password'] }).map((v) => v.rule)).toContain(
      'non_inclusion_path'
    );
    expect(validateViewSpec({ ...base(), include: ['$$ROOT'] }).map((v) => v.rule)).toContain(
      'non_inclusion_path'
    );
    expect(validateViewSpec({ ...base(), include: ['documents.*'] }).map((v) => v.rule)).toContain(
      'non_inclusion_path'
    );
  });

  it('overlap with never-exported', () => {
    const spec = { ...base(), include: ['name', 'documents.url'], neverExported: ['documents'] };
    expect(validateViewSpec(spec).map((v) => v.rule)).toContain('never_exported_overlap');
  });

  it('raw computed pass-through of a never-exported field', () => {
    const spec = {
      ...base(),
      neverExported: ['remarks'],
      computed: [{ name: 'copy', reads: ['remarks'], expr: { op: 'ref', field: 'remarks' } }]
    };
    expect(validateViewSpec(spec).map((v) => v.rule)).toContain('never_exported_overlap');
    const snippetSpec = {
      ...spec,
      computed: [
        { name: 'copy', reads: ['remarks'], expr: { op: 'snippet', field: 'remarks', length: 10 } }
      ]
    };
    expect(validateViewSpec(snippetSpec)).toEqual([]);
  });

  it('duplicates and computed without reads', () => {
    const spec = {
      ...base(),
      include: ['name', 'name'],
      computed: [{ name: 'x', reads: [], expr: { op: 'ref', field: 'a' } }]
    };
    const rules = validateViewSpec(spec).map((v) => v.rule);
    expect(rules).toContain('duplicate_field');
    expect(rules).toContain('computed_without_reads');
  });

  it('assertViewSpecClean throws with violations', () => {
    const spec = { ...base(), include: ['password'] };
    try {
      assertViewSpecClean(spec);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ViewSpecViolationError);
      expect(error.violations.length).toBeGreaterThan(0);
    }
  });
});
