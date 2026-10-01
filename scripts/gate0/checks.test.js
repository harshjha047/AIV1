import { describe, expect, it } from 'vitest';
import { evaluateDecisions, summarize } from './checks.js';

const config = {
  owner: 'o',
  repos: [{ name: 'A', path: '../A' }],
  requiredSources: ['CRM', 'BahiKhata', 'Invoicing', 'Samadhan'],
};

const baseDecisions = () => ({
  secrets: {
    rotated: [{ name: 'x', rotatedAt: '2026-10-01', oldRevokedAt: '2026-10-01' }],
    collaboratorsReviewedAt: '2026-10-01',
  },
  resend: {
    plan: 'free',
    decision: 'events_only',
    exportedAt: '2026-10-01',
    mailingServiceRepo: 'mailer',
  },
  kpi: {
    salesAttribution: 'createdBy',
    netLostMbps: false,
    supportAttribution: 'resolver',
    onDisableDefault: 'hide',
    acceptedDefaults: true,
    signedOffBy: null,
    signedOffAt: '2026-10-01',
  },
  hosting: {
    topology: 'A',
    redis: { host: '127.0.0.1', noevictionPossible: true },
    services: [{ name: 'CRM', api: 'vps', db: 'atlas' }],
    reachability: ['CRM', 'BahiKhata', 'Invoicing', 'Samadhan'].map((source) => ({
      source,
      reachable: true,
      tls: true,
      allowListNeeded: false,
    })),
    openPorts: [443],
  },
  access: {
    mailingServiceRepo: 'mailer',
    accountingApplicationInScope: false,
    bharatRadiusInScope: true,
    practiceData: { crm: 'dump', bahikhata: 'remote' },
    localMongoAuthEnabled: true,
    productionDbAdmin: 'Ravi',
  },
});

const baseFacts = () => ({
  repos: {
    A: { private: true, privateDetail: 'private=true', findings: 0, findingsDetail: 'findings=0' },
  },
  resendExportExists: true,
  baseline: {
    versions: { node: 'v22', mongod: '7', redis: '7' },
    cpu: { avx2: true, loadAvgPct: 10 },
    memory: { totalGb: 16 },
  },
});

const failedIds = (decisions, facts) =>
  summarize(evaluateDecisions(decisions, config, facts)).failed.map((r) => r.id);

describe('evaluateDecisions', () => {
  it('passes when everything is recorded', () => {
    const summary = summarize(evaluateDecisions(baseDecisions(), config, baseFacts()));
    expect(summary.failed).toEqual([]);
    expect(summary.ok).toBe(true);
  });

  it('fails every item on the empty template', () => {
    const empty = {
      secrets: {
        rotated: [{ rotatedAt: null, oldRevokedAt: null }],
        collaboratorsReviewedAt: null,
      },
      resend: { plan: null, decision: null, exportedAt: null, mailingServiceRepo: null },
      kpi: {
        salesAttribution: 'createdBy',
        netLostMbps: false,
        supportAttribution: 'resolver',
        onDisableDefault: 'hide',
        acceptedDefaults: null,
        signedOffBy: null,
        signedOffAt: null,
      },
      hosting: {
        topology: null,
        redis: { host: null, noevictionPossible: null },
        services: [{ api: null, db: null }],
        reachability: [],
        openPorts: [],
      },
      access: {
        mailingServiceRepo: null,
        accountingApplicationInScope: null,
        bharatRadiusInScope: null,
        practiceData: {},
        localMongoAuthEnabled: null,
        productionDbAdmin: null,
      },
    };
    const summary = summarize(
      evaluateDecisions(empty, config, { repos: {}, resendExportExists: false, baseline: null }),
    );
    expect(summary.passed).toBe(0);
  });

  it('requires signed-off date even when defaults are accepted', () => {
    const d = baseDecisions();
    d.kpi.signedOffAt = null;
    expect(failedIds(d, baseFacts())).toEqual(['G0-04.kpi']);
  });

  it('requires a named approver when defaults are rejected', () => {
    const d = baseDecisions();
    d.kpi.acceptedDefaults = false;
    d.kpi.signedOffBy = null;
    expect(failedIds(d, baseFacts())).toEqual(['G0-04.kpi']);
    d.kpi.signedOffBy = 'Owner';
    expect(failedIds(d, baseFacts())).toEqual([]);
  });

  it('rejects an unset acceptance flag', () => {
    const d = baseDecisions();
    d.kpi.acceptedDefaults = null;
    d.kpi.signedOffBy = 'Owner';
    expect(failedIds(d, baseFacts())).toEqual(['G0-04.kpi']);
  });

  it('rejects an invalid on-disable policy', () => {
    const d = baseDecisions();
    d.kpi.onDisableDefault = 'delete';
    expect(failedIds(d, baseFacts())).toEqual(['G0-04.kpi']);
  });

  it('fails a public or unverifiable repository and leaked history', () => {
    const facts = baseFacts();
    facts.repos.A = { private: false, findings: 3 };
    expect(failedIds(baseDecisions(), facts)).toEqual(['G0-02.private.A', 'G0-02.history.A']);
    facts.repos.A = { private: null, findings: null };
    expect(failedIds(baseDecisions(), facts)).toEqual(['G0-02.private.A', 'G0-02.history.A']);
  });

  it('requires every source to be reachable with TLS and allow-list answers', () => {
    const d = baseDecisions();
    d.hosting.reachability = d.hosting.reachability.filter((r) => r.source !== 'Samadhan');
    expect(failedIds(d, baseFacts())).toEqual(['G0-05.reachability']);
    d.hosting.reachability.push({
      source: 'Samadhan',
      reachable: false,
      tls: true,
      allowListNeeded: false,
    });
    expect(failedIds(d, baseFacts())).toEqual(['G0-05.reachability']);
    d.hosting.reachability[3] = {
      source: 'Samadhan',
      reachable: true,
      tls: null,
      allowListNeeded: false,
    };
    expect(failedIds(d, baseFacts())).toEqual(['G0-05.reachability']);
  });

  it('requires redis noeviction support', () => {
    const d = baseDecisions();
    d.hosting.redis.noevictionPossible = false;
    expect(failedIds(d, baseFacts())).toEqual(['G0-05.redis']);
  });

  it('requires practice-data, local auth and DB admin answers', () => {
    const d = baseDecisions();
    d.access.practiceData.crm = 'maybe';
    expect(failedIds(d, baseFacts())).toEqual(['G0-07.access']);
    const e = baseDecisions();
    e.access.localMongoAuthEnabled = null;
    expect(failedIds(e, baseFacts())).toEqual(['G0-07.access']);
    const f = baseDecisions();
    f.access.productionDbAdmin = '';
    expect(failedIds(f, baseFacts())).toEqual(['G0-07.access']);
  });

  it('fails the baseline when versions or AVX2 are missing', () => {
    const facts = baseFacts();
    facts.baseline.cpu.avx2 = null;
    expect(failedIds(baseDecisions(), facts)).toEqual(['G0-06.baseline']);
    facts.baseline = null;
    expect(failedIds(baseDecisions(), facts)).toEqual(['G0-06.baseline']);
  });

  it('requires the resend decision to be one of the two options', () => {
    const d = baseDecisions();
    d.resend.decision = 'later';
    expect(failedIds(d, baseFacts())).toEqual(['G0-03.resend']);
  });
});
