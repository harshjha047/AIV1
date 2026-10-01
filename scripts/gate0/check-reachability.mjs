import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

const targets = JSON.parse(
  readFileSync(process.argv[2] ?? 'scripts/gate0/reachability.targets.json', 'utf8'),
);
const TIMEOUT_MS = 5000;

const probe = (target) =>
  new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const finish = (extra) =>
      resolve({
        source: target.source,
        host: target.host,
        port: target.port,
        tlsRequested: Boolean(target.tls),
        latencyMs: Number((process.hrtime.bigint() - started) / 1000000n),
        ...extra,
      });
    const onError = (error) =>
      finish({ reachable: false, tlsOk: null, detail: error.code ?? error.message });
    const socket = target.tls
      ? tls.connect(
          { host: target.host, port: target.port, servername: target.host, timeout: TIMEOUT_MS },
          () => {
            const authorized = socket.authorized;
            const detail = authorized ? 'ok' : String(socket.authorizationError);
            socket.destroy();
            finish({ reachable: true, tlsOk: authorized, detail });
          },
        )
      : net.connect({ host: target.host, port: target.port, timeout: TIMEOUT_MS }, () => {
          socket.destroy();
          finish({ reachable: true, tlsOk: null, detail: 'ok' });
        });
    socket.on('timeout', () => {
      socket.destroy();
      finish({ reachable: false, tlsOk: null, detail: 'timeout' });
    });
    socket.on('error', onError);
  });

const results = await Promise.all(targets.map(probe));
mkdirSync('ops', { recursive: true });
writeFileSync(
  'ops/reachability.json',
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
);
for (const r of results) {
  console.log(
    `${r.reachable ? 'PASS' : 'FAIL'}  ${r.source}  ${r.host}:${r.port}  tls=${r.tlsRequested ? r.tlsOk : 'off'}  ${r.latencyMs}ms  ${r.detail}`,
  );
}
process.exit(results.every((r) => r.reachable) ? 0 : 1);
