import { createServer } from './server.js';

const host = process.env.AI_HOST ?? '127.0.0.1';
const port = Number(process.env.AI_PORT ?? 4100);

const service = await createServer();
const listener = service.app.listen(port, host, () => {
  console.log(JSON.stringify({ msg: 'ai-service listening', host, port }));
});

async function shutdown() {
  listener.close();
  await service.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
