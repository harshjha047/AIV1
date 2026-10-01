function baseVisibility(source) {
  switch (source.state) {
    case 'active':
      return 'live';
    case 'paused':
      return 'stale';
    case 'disabled':
      return source.onDisable === 'keep' ? 'stale' : 'hidden';
    default:
      return 'hidden';
  }
}

export function sourceVisibility(source, all = []) {
  const base = baseVisibility(source);
  if (source.kind === 'synthetic') {
    const realActive = all.some(
      (other) =>
        other.kind !== 'synthetic' &&
        other.logicalSource === source.logicalSource &&
        other.state === 'active'
    );
    if (realActive) return 'hidden';
  }
  return base;
}

export function visibleSources(sources) {
  const byId = {};
  for (const source of sources) {
    const visibility = sourceVisibility(source, sources);
    if (visibility !== 'hidden') byId[source._id] = visibility;
  }
  return { ids: Object.keys(byId).sort(), byId };
}

export function visibilityFilter(sources, field = '_src') {
  return { [field]: { $in: visibleSources(sources).ids } };
}
