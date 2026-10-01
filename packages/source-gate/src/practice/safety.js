const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class RemoteTargetError extends Error {
  constructor(hosts) {
    super(`Refusing non-local MongoDB target: ${hosts.join(', ')}`);
    this.name = 'RemoteTargetError';
    this.code = 'REMOTE_TARGET';
  }
}

export function hostsOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  if (!match) throw new TypeError('Invalid MongoDB URI');
  return match[1].split(',').map((entry) => {
    const trimmed = entry.trim();
    if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1);
    return trimmed.split(':')[0];
  });
}

export function assertLocalUri(uri, { allowRemote = false } = {}) {
  if (uri.startsWith('mongodb+srv://')) throw new RemoteTargetError(['mongodb+srv']);
  const hosts = hostsOf(uri);
  const remote = hosts.filter((host) => !LOCAL_HOSTS.has(host));
  if (remote.length > 0 && !allowRemote) throw new RemoteTargetError(remote);
  return hosts;
}
