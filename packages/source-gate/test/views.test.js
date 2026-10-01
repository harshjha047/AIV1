import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { VIEW_ALLOW_LISTS, ViewSpecViolationError } from '@fab5/shared/pii';
import { viewsSpecs } from '@fab5/sources';
import {
  SampleCheckError,
  ViewsSpecError,
  buildMongoPipeline,
  compileExpr,
  defineViewsSpec,
  detectArtifactDrift,
  detectDrift,
  disableEnableCommands,
  fieldRef,
  generateSource,
  mongoIndexSpecs,
  pathExists,
  projectionIsInclusionOnly
} from '../src/views/index.js';

const crmSamples = {
  users: [{ _id: 1, name: 'a', email: 'a@x.in', role: 'admin', isActive: true, createdAt: 1, updatedAt: 1, password: 'x' }],
  customers: [
    {
      _id: 1,
      name: 'c',
      customerType: 'b2b',
      managedBy: 1,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
      billingProfile: [{ address: { state: 'DL' } }]
    }
  ],
  connections: [
    {
      _id: 1,
      opportunityId: 'o',
      customer: 1,
      createdBy: 1,
      approvedBy: 1,
      activatedBy: 1,
      serviceType: 'ILL',
      bandwidth: 10,
      status: 'active',
      acceptanceDate: 1,
      technicalDetails: { telcoProvider: 'p', aEnd: { btsId: 'a' }, bEnd: { btsId: 'b' } },
      commercials: { mrc: 1, otc: 1 },
      providerCost: { mrc: 1 },
      ips: { count: 1, cost: 1 },
      remarks: 'r',
      terminationDetails: { raiseDate: 1, finalDate: 2, reason: 'x' },
      rejectionDetails: { rejectedAt: 1, reason: 'y' },
      history: [{ _id: 1, action: 'a', date: 1, performedBy: 1, bandwidth: 1, commercials: { mrc: 1 }, note: 'n' }],
      createdAt: 1,
      updatedAt: 1
    }
  ],
  servicerequests: [
    {
      _id: 1,
      customer: 1,
      requestType: 't',
      status: 's',
      serviceType: 'x',
      bandwidthCurrent: 1,
      bandwidthRequested: 2,
      commercials: { mrc: 1 },
      createdBy: 1,
      approvedBy: 1,
      raiseDate: 1,
      finalDisconnectionDate: 1,
      disconnectionReason: 'z',
      createdAt: 1,
      updatedAt: 1
    }
  ],
  salestargets: [{ _id: 1, employee: 1, monthStart: 1, targetMbps: 1, setBy: 1, createdAt: 1, updatedAt: 1 }]
};

const crm = viewsSpecs.crm;

describe('expression compiler', () => {
  const root = fieldRef();
  it('compiles snippet, firstOf, size and ref', () => {
    expect(compileExpr({ op: 'snippet', field: 'remarks', length: 300 }, root)).toEqual({
      $substrCP: [{ $ifNull: ['$remarks', ''] }, 0, 300]
    });
    expect(compileExpr({ op: 'firstOf', field: 'a.b' }, root)).toEqual({ $arrayElemAt: ['$a.b', 0] });
    expect(compileExpr({ op: 'size', field: 'items' }, root)).toEqual({ $size: { $ifNull: ['$items', []] } });
    expect(compileExpr({ op: 'ref', field: 'x.y' }, fieldRef('h'))).toBe('$$h.x.y');
  });

  it('compiles pluck and domains without exposing full addresses', () => {
    const pluck = compileExpr({ op: 'pluck', field: 'items', key: 'sourceType' }, root);
    expect(pluck.$map.in).toBe('$$item.sourceType');
    const domains = compileExpr({ op: 'domains', field: 'recipients' }, root);
    expect(JSON.stringify(domains)).toContain('$split');
    expect(JSON.stringify(domains)).not.toContain('"$$recipient"]},"in"');
  });

  it('rejects unknown ops', () => {
    expect(() => compileExpr({ op: 'eval', field: 'x' }, root)).toThrow(ViewsSpecError);
  });
});

describe('mongo pipelines', () => {
  it('matches the schema pipeline for customers', () => {
    const view = crm.views.find((entry) => entry.name === 'ai_customers_v');
    expect(buildMongoPipeline(view.allowList)).toEqual([
      {
        $project: {
          name: 1,
          customerType: 1,
          managedBy: 1,
          isActive: 1,
          createdAt: 1,
          updatedAt: 1,
          state: { $arrayElemAt: ['$billingProfile.address.state', 0] }
        }
      }
    ]);
  });

  it('builds unwind events with root fields merged', () => {
    const view = crm.views.find((entry) => entry.name === 'ai_connection_events_v');
    const stages = buildMongoPipeline(view.allowList);
    expect(stages).toHaveLength(3);
    expect(stages[1]).toEqual({ $unwind: '$history' });
    expect(stages[2].$replaceRoot.newRoot.$mergeObjects[1]).toEqual({
      connectionId: '$_id',
      parentUpdatedAt: '$updatedAt'
    });
    expect(stages[0].$project.history.$map.in.mrc).toBe('$$h.commercials.mrc');
  });

  it('is inclusion-only for every mongo source', () => {
    for (const spec of Object.values(viewsSpecs).filter((entry) => entry.engine === 'mongodb')) {
      for (const view of spec.views) {
        expect(projectionIsInclusionOnly(buildMongoPipeline(view.allowList))).toEqual([]);
      }
    }
  });

  it('puts the email-type filter first for invoicing email logs', () => {
    const view = viewsSpecs.invoicing.views.find((entry) => entry.name === 'ai_email_logs_v');
    expect(buildMongoPipeline(view.allowList)[0]).toHaveProperty('$match.emailType.$in');
  });
});

describe('generation', () => {
  it('generates parseable scripts for every source without denied names', () => {
    for (const [id, spec] of Object.entries(viewsSpecs)) {
      const { files } = generateSource(spec, { allowUnverified: true });
      for (const [name, content] of Object.entries(files)) {
        if (name.endsWith('.js')) expect(() => new vm.Script(content, { filename: `${id}/${name}` })).not.toThrow();
      }
      const script = files['create-views.js'] ?? files['create-views.sql'];
      for (const word of ['adharNumber', 'panNumber', 'resetPasswordToken', 'refreshToken', 'bankInfo', 'gstNumber']) {
        expect(script).not.toContain(word);
      }
      expect(script).not.toMatch(/SELECT\s+\*/i);
    }
  });

  it('is deterministic', () => {
    const first = generateSource(crm, { samples: crmSamples });
    const second = generateSource(crm, { samples: crmSamples });
    expect(first.files).toEqual(second.files);
    expect(first.manifest.specHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('substitutes the database name everywhere', () => {
    const { files } = generateSource(crm, { database: 'crm_practice', samples: crmSamples });
    expect(files['create-views.js']).toContain("db.getSiblingDB('crm_practice')");
    expect(files['create-views.js']).toContain("db: 'crm_practice'");
    expect(files['create-views.js']).not.toContain('<crm_db>');
    expect(files['disable.js']).toBe("db.getSiblingDB('crm_practice').revokeRolesFromUser('ai_ro', ['ai_reader']);\n");
    expect(files['enable.js']).toBe("db.getSiblingDB('crm_practice').grantRolesToUser('ai_ro', ['ai_reader']);\n");
  });

  it('grants find on views only and never names a base collection in privileges', () => {
    const { files } = generateSource(crm, { samples: crmSamples });
    const script = files['create-views.js'];
    const privileges = script.slice(script.indexOf('const privileges'));
    expect(privileges).toContain("collection: 'ai_connections_v'");
    expect(privileges).not.toContain("collection: 'connections'");
    expect(privileges).toContain("actions: ['find']");
    expect(privileges).toContain('passwordPrompt()');
  });

  it('refuses deny-listed specs', () => {
    const base = VIEW_ALLOW_LISTS.crm.views.ai_users_v;
    const bad = { ...base, include: [...base.include, 'password'] };
    const spec = { ...crm, views: [{ name: 'ai_users_v', allowList: bad }] };
    expect(() => generateSource(spec, { allowUnverified: true })).toThrow(ViewSpecViolationError);
  });

  it('refuses nested deny-listed keys and raw reads of never-exported paths', () => {
    const base = VIEW_ALLOW_LISTS.crm.views.ai_connections_v;
    const spec = {
      ...crm,
      views: [{ name: 'ai_connections_v', allowList: { ...base, include: [...base.include, 'technicalDetails.bEnd.address'] } }]
    };
    expect(() => generateSource(spec, { allowUnverified: true })).toThrow(ViewSpecViolationError);
  });

  it('refuses a generated pipeline that is not inclusion-only', () => {
    const base = VIEW_ALLOW_LISTS.crm.views.ai_users_v;
    const spec = { ...crm, views: [{ name: 'ai_users_v', allowList: { ...base, include: ['name', '-email'] } }] };
    expect(() => generateSource(spec, { allowUnverified: true })).toThrow();
  });

  it('requires samples for a confirmed source', () => {
    expect(() => generateSource(crm, {})).toThrow(ViewsSpecError);
    expect(generateSource(crm, { allowUnverified: true }).manifest.verified).toBe(false);
  });

  it('allows drafts to generate unverified with a warning', () => {
    const result = generateSource(viewsSpecs.invoicing, {});
    expect(result.warnings[0].kind).toBe('unverified');
  });

  it('records verification in the manifest', () => {
    expect(generateSource(crm, { samples: crmSamples }).manifest.verified).toBe(true);
  });
});

describe('field existence check', () => {
  it('walks arrays and nested documents', () => {
    expect(pathExists({ a: [{ b: { c: 1 } }] }, 'a.b.c')).toBe(true);
    expect(pathExists({ a: [{ b: 1 }] }, 'a.c')).toBe(false);
    expect(pathExists({ a: null }, 'a.b')).toBe(false);
    expect(pathExists({ a: 1 }, 'a')).toBe(true);
  });

  it('fails when a view field is absent from every sample', () => {
    const samples = structuredClone(crmSamples);
    delete samples.connections[0].providerCost;
    try {
      generateSource(crm, { samples });
      throw new Error('should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(SampleCheckError);
      expect(error.problems).toContainEqual({
        view: 'ai_connections_v',
        kind: 'field_not_found',
        path: 'providerCost.mrc',
        collection: 'connections'
      });
    }
  });

  it('fails when a collection has no sample file', () => {
    const samples = { ...crmSamples };
    delete samples.salestargets;
    expect(() => generateSource(crm, { samples })).toThrow(SampleCheckError);
  });

  it('fails on empty samples', () => {
    expect(() => generateSource(crm, { samples: { ...crmSamples, users: [] } })).toThrow(SampleCheckError);
  });

  it('passes when the field exists in at least one document', () => {
    const samples = structuredClone(crmSamples);
    samples.connections.push({ _id: 2 });
    expect(() => generateSource(crm, { samples })).not.toThrow();
  });
});

describe('indexes and commands', () => {
  it('recommends updatedAt and _id for each viewed collection', () => {
    const indexes = mongoIndexSpecs(crm);
    expect(indexes.map((index) => index.collection)).toEqual([
      'connections',
      'customers',
      'salestargets',
      'servicerequests',
      'users'
    ]);
    expect(indexes[0].keys).toEqual({ updatedAt: 1, _id: 1 });
  });

  it('adds the invoicing indexes', () => {
    const names = mongoIndexSpecs(viewsSpecs.invoicing).map((index) => index.name);
    expect(names).toEqual(expect.arrayContaining(['ai_invoice_date', 'ai_status_due', 'ai_invoice_number']));
    const { files } = generateSource(viewsSpecs.invoicing, {});
    expect(files['indexes.js']).toContain("createIndex({\n  'dates.invoiceDate': 1\n}");
  });

  it('returns disable and enable commands per engine', () => {
    expect(disableEnableCommands(crm, 'crm')).toEqual({
      engine: 'mongodb',
      language: 'mongosh',
      disable: "db.getSiblingDB('crm').revokeRolesFromUser('ai_ro', ['ai_reader']);",
      enable: "db.getSiblingDB('crm').grantRolesToUser('ai_ro', ['ai_reader']);"
    });
    const pg = disableEnableCommands(viewsSpecs.samadhan);
    expect(pg.disable).toContain('ALTER ROLE ai_ro NOLOGIN;');
    expect(pg.disable).toContain('pg_terminate_backend');
    expect(pg.enable).toBe('ALTER ROLE ai_ro LOGIN;');
  });
});

describe('postgres generation', () => {
  const spec = viewsSpecs.samadhan;
  const { files, manifest } = generateSource(spec, {});

  it('creates views, a read-only role and grants on views only', () => {
    const sql = files['create-views.sql'];
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS ai_export;');
    expect(sql).toContain('ALTER ROLE ai_ro SET default_transaction_read_only = on;');
    expect(sql).toContain('GRANT SELECT ON ai_export.tickets_v TO ai_ro;');
    expect(sql).not.toMatch(/GRANT SELECT ON (public\.)?(users|tickets) /);
    expect(sql).not.toMatch(/SELECT\s+\*/);
    expect(sql).toContain('\\password ai_ro');
  });

  it('lists exactly the allow-listed columns', () => {
    expect(manifest.views).toEqual([
      'employees_v',
      'customers_v',
      'issue_categories_v',
      'tickets_v',
      'ticket_events_v',
      'email_logs_v'
    ]);
    expect(files['create-views.sql']).not.toContain('rca_images');
    expect(files['create-views.sql']).not.toContain('translations');
  });

  it('rejects column sets that differ from the allow-list', () => {
    expect(() =>
      defineViewsSpec({
        sourceId: 'samadhan',
        specVersion: 1,
        database: 'x',
        selects: { ...Object.fromEntries(spec.views.map((view) => [view.name, view.select])), email_logs_v: { from: 'automated_email_logs', columns: { id: 'id', recipient: 'recipient' } } }
      })
    ).toThrow(ViewsSpecError);
  });

  it('rejects a select that reads a never-exported column', () => {
    const tickets = spec.views.find((view) => view.name === 'tickets_v');
    const leaking = {
      ...spec,
      views: spec.views.map((view) =>
        view.name === 'tickets_v'
          ? { ...tickets, select: { ...tickets.select, columns: { ...tickets.select.columns, rca: 't.rca_images' } } }
          : view
      )
    };
    expect(() => generateSource(leaking, {})).toThrow(ViewsSpecError);
  });

  it('emits the index script', () => {
    expect(files['indexes.sql']).toContain('CREATE INDEX IF NOT EXISTS ai_tickets_updated_id ON tickets (updated_at, id);');
  });
});

describe('drift detection', () => {
  const live = () =>
    JSON.parse(
      JSON.stringify(
        crm.views.map((view) => ({
          name: view.name,
          viewOn: view.allowList.collection,
          pipeline: buildMongoPipeline(view.allowList)
        }))
      )
    );

  it('reports no drift when live matches', () => {
    expect(detectDrift(crm, live())).toEqual([]);
  });

  it('detects a changed pipeline', () => {
    const views = live();
    views[2].pipeline[0].$project['technicalDetails.aEnd.address'] = 1;
    expect(detectDrift(crm, views)).toEqual([{ view: 'ai_connections_v', kind: 'pipeline_changed' }]);
  });

  it('detects a missing view, a moved source and an unexpected view', () => {
    const views = live();
    views.splice(0, 1);
    views[0].viewOn = 'customers_old';
    views.push({ name: 'ai_extra_v', viewOn: 'users', pipeline: [] });
    views.push({ name: 'other_view', viewOn: 'users', pipeline: [] });
    const kinds = detectDrift(crm, views).map((entry) => `${entry.view}:${entry.kind}`);
    expect(kinds).toContain('ai_users_v:missing');
    expect(kinds).toContain('ai_customers_v:source_changed');
    expect(kinds).toContain('ai_extra_v:unexpected');
    expect(kinds).not.toContain('other_view:unexpected');
  });

  it('is insensitive to key order', () => {
    const views = live();
    views[0].pipeline[0].$project = Object.fromEntries(Object.entries(views[0].pipeline[0].$project).reverse());
    expect(detectDrift(crm, views)).toEqual([]);
  });

  it('detects postgres column drift', () => {
    const spec = viewsSpecs.samadhan;
    const liveViews = spec.views.map((view) => ({ name: view.name, columns: Object.keys(view.select.columns) }));
    expect(detectDrift(spec, liveViews)).toEqual([]);
    liveViews[3].columns = [...liveViews[3].columns, 'rca_images'];
    expect(detectDrift(spec, liveViews)).toMatchObject([{ view: 'tickets_v', kind: 'columns_changed' }]);
  });

  it('rejects unreadable live data', () => {
    expect(detectDrift(crm, null)).toEqual([{ view: '*', kind: 'live_unreadable' }]);
  });

  it('flags stale artifacts', () => {
    expect(detectArtifactDrift({ a: '1', b: '2', c: '3' }, { a: '1', b: 'x' })).toEqual([
      { view: 'b', kind: 'artifact_stale' },
      { view: 'c', kind: 'artifact_missing' }
    ]);
  });
});

describe('views cli', () => {
  const writes = {};
  const fs = {
    mkdirSync: () => {},
    writeFileSync: (path, content) => {
      writes[path] = content;
    }
  };
  const quiet = { log: () => {}, error: () => {} };

  it('parses arguments', async () => {
    const { parseArgs } = await import('../src/views/cli.js');
    expect(parseArgs(['--check', '--source', 'crm,bahikhata', '--db', 'crm=crm_practice,bahikhata=bk'])).toMatchObject({
      check: true,
      sources: ['crm', 'bahikhata'],
      databases: { crm: 'crm_practice', bahikhata: 'bk' }
    });
    expect(() => parseArgs(['--nope'])).toThrow(TypeError);
    expect(() => parseArgs(['--out'])).toThrow(TypeError);
  });

  it('fails a confirmed source without samples and writes nothing', async () => {
    const { runViewsCli } = await import('../src/views/cli.js');
    const report = runViewsCli(['--source', 'crm', '--samples', '/nonexistent'], { specs: viewsSpecs, io: quiet, fs });
    expect(report.code).toBe(1);
    expect(report.sources.crm.error.code).toBe('SAMPLES_REQUIRED');
    expect(Object.keys(writes)).toHaveLength(0);
  });

  it('writes files when unverified generation is allowed', async () => {
    const { runViewsCli } = await import('../src/views/cli.js');
    const report = runViewsCli(['--source', 'crm', '--allow-unverified', '--out', 'out'], { specs: viewsSpecs, io: quiet, fs });
    expect(report.code).toBe(0);
    expect(Object.keys(writes)).toContain('out/crm/create-views.js');
    expect(Object.keys(writes)).toContain('out/crm/manifest.json');
  });

  it('exits 2 on drift when live dump is missing', async () => {
    const { runViewsCli } = await import('../src/views/cli.js');
    const report = runViewsCli(['--check', '--source', 'invoicing', '--live', '/nonexistent', '--out', '/nonexistent'], {
      specs: viewsSpecs,
      io: quiet,
      fs
    });
    expect(report.code).toBe(2);
    expect(report.sources.invoicing.drift[0].kind).toBe('live_missing');
  });
});
