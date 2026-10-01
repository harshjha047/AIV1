const ALLOWED_ACTIONS = new Set(['find']);

export async function verifyMongo(client, source) {
  const exposed = new Set(source.exposedObjects ?? []);
  const result = await client.db('admin').command({ connectionStatus: 1, showPrivileges: true });
  const authInfo = result?.authInfo ?? {};
  const users = authInfo.authenticatedUsers ?? [];
  if (users.length === 0) {
    return {
      ok: true,
      status: 'warn',
      authEnforced: false,
      details: { engine: 'mongodb', reason: 'no authenticated user', user: null }
    };
  }
  const writeActions = new Set();
  const extraResources = [];
  const granted = new Set();
  for (const privilege of authInfo.authenticatedUserPrivileges ?? []) {
    const resource = privilege.resource ?? {};
    const label = resource.cluster
      ? '<cluster>'
      : resource.anyResource
        ? '<any>'
        : `${resource.db ?? ''}.${resource.collection ?? ''}`;
    for (const action of privilege.actions ?? []) {
      if (!ALLOWED_ACTIONS.has(action)) writeActions.add(action);
    }
    const isExposedView =
      !resource.cluster && !resource.anyResource && resource.collection && exposed.has(resource.collection);
    if (!isExposedView) extraResources.push(label);
    else if ((privilege.actions ?? []).includes('find')) granted.add(resource.collection);
  }
  const missingObjects = [...exposed].filter((name) => !granted.has(name));
  const failed = writeActions.size > 0 || extraResources.length > 0 || missingObjects.length > 0;
  return {
    ok: !failed,
    status: failed ? 'fail' : 'ok',
    authEnforced: true,
    details: {
      engine: 'mongodb',
      user: users[0].user,
      database: users[0].db,
      writeActions: [...writeActions].sort(),
      extraResources: [...new Set(extraResources)].sort(),
      missingObjects: missingObjects.sort(),
      grantedViews: [...granted].sort()
    }
  };
}
