const filled = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  !(Array.isArray(value) && value.length === 0);

const entry = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

const rotationDone = (item) => filled(item.rotatedAt) && filled(item.oldRevokedAt);

export const evaluateDecisions = (decisions, config, facts) => {
  const results = [];
  const { secrets, resend, kpi, hosting, access } = decisions;

  const rotated = secrets.rotated.filter(rotationDone).length;
  results.push(
    entry(
      'G0-01.rotated',
      rotated === secrets.rotated.length,
      `${rotated}/${secrets.rotated.length}`,
    ),
  );

  for (const repo of config.repos) {
    const fact = facts.repos?.[repo.name] ?? {};
    results.push(
      entry(`G0-02.private.${repo.name}`, fact.private === true, fact.privateDetail ?? 'unknown'),
    );
    results.push(
      entry(`G0-02.history.${repo.name}`, fact.findings === 0, fact.findingsDetail ?? 'unknown'),
    );
  }
  results.push(
    entry(
      'G0-02.collaborators',
      filled(secrets.collaboratorsReviewedAt),
      String(secrets.collaboratorsReviewedAt),
    ),
  );

  const resendDecided =
    filled(resend.plan) &&
    ['events_only', 'body_pull'].includes(resend.decision) &&
    filled(resend.exportedAt);
  results.push(entry('G0-03.resend', resendDecided, `decision=${resend.decision}`));
  results.push(
    entry('G0-03.resendExport', facts.resendExportExists === true, 'ops/resend-export.json'),
  );
  results.push(
    entry(
      'G0-03.mailingRepo',
      filled(resend.mailingServiceRepo),
      String(resend.mailingServiceRepo),
    ),
  );

  const kpiValid =
    ['createdBy', 'managedBy'].includes(kpi.salesAttribution) &&
    typeof kpi.netLostMbps === 'boolean' &&
    ['resolver', 'assignee'].includes(kpi.supportAttribution) &&
    ['keep', 'hide', 'purge'].includes(kpi.onDisableDefault);
  const signedOff =
    kpi.acceptedDefaults === true || (kpi.acceptedDefaults === false && filled(kpi.signedOffBy));
  results.push(
    entry(
      'G0-04.kpi',
      kpiValid && signedOff && filled(kpi.signedOffAt),
      `acceptedDefaults=${kpi.acceptedDefaults} onDisable=${kpi.onDisableDefault}`,
    ),
  );

  const reachabilityBySource = new Map(
    (hosting.reachability ?? []).map((item) => [item.source, item]),
  );
  const reachabilityOk = config.requiredSources.every((source) => {
    const item = reachabilityBySource.get(source);
    return (
      item !== undefined &&
      item.reachable === true &&
      typeof item.tls === 'boolean' &&
      typeof item.allowListNeeded === 'boolean'
    );
  });
  const servicesOk = hosting.services.every((s) => filled(s.api) && filled(s.db));
  results.push(
    entry('G0-05.topology', ['A', 'B'].includes(hosting.topology), `topology=${hosting.topology}`),
  );
  results.push(
    entry(
      'G0-05.redis',
      filled(hosting.redis.host) && hosting.redis.noevictionPossible === true,
      `host=${hosting.redis.host}`,
    ),
  );
  results.push(
    entry(
      'G0-05.services',
      servicesOk,
      `${hosting.services.filter((s) => filled(s.api) && filled(s.db)).length}/${hosting.services.length}`,
    ),
  );
  results.push(
    entry('G0-05.ports', filled(hosting.openPorts), `${hosting.openPorts.length} ports`),
  );
  results.push(
    entry(
      'G0-05.reachability',
      reachabilityOk,
      `${reachabilityBySource.size}/${config.requiredSources.length} sources`,
    ),
  );

  const b = facts.baseline;
  const baselineOk =
    b !== null &&
    b !== undefined &&
    filled(b.versions?.node) &&
    filled(b.versions?.mongod) &&
    filled(b.versions?.redis) &&
    typeof b.cpu?.avx2 === 'boolean' &&
    filled(b.memory?.totalGb);
  results.push(
    entry(
      'G0-06.baseline',
      baselineOk,
      b
        ? `avx2=${b.cpu?.avx2} totalGb=${b.memory?.totalGb} loadAvg=${b.cpu?.loadAvgPct}`
        : 'ops/baseline.json missing',
    ),
  );

  const practice = access.practiceData ?? {};
  const accessOk =
    filled(access.mailingServiceRepo) &&
    typeof access.accountingApplicationInScope === 'boolean' &&
    typeof access.bharatRadiusInScope === 'boolean' &&
    ['dump', 'remote'].includes(practice.crm) &&
    ['dump', 'remote'].includes(practice.bahikhata) &&
    typeof access.localMongoAuthEnabled === 'boolean' &&
    filled(access.productionDbAdmin);
  results.push(entry('G0-07.access', accessOk, JSON.stringify(access)));

  return results;
};

export const summarize = (results) => {
  const failed = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed,
    ok: failed.length === 0,
  };
};
