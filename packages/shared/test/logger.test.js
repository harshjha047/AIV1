import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, scrubUris } from '../src/index.js';

const capture = () => {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(
        ...chunk
          .toString()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
      callback();
    },
  });
  return { lines, destination };
};

describe('scrubUris', () => {
  it('removes credentials from connection strings', () => {
    expect(scrubUris('connect mongodb://admin:hunter2@db:27017/x failed')).toBe(
      'connect mongodb://***@db:27017/x failed',
    );
    expect(scrubUris('postgres://u:p@h/db')).toBe('postgres://***@h/db');
    expect(scrubUris('mongodb+srv://u:p@cluster.example.net/db')).toBe(
      'mongodb+srv://***@cluster.example.net/db',
    );
  });

  it('leaves clean strings and non-strings untouched', () => {
    expect(scrubUris('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    expect(scrubUris(42)).toBe(42);
  });
});

describe('createLogger', () => {
  it('redacts sensitive keys at top level and nested', () => {
    const { lines, destination } = capture();
    const log = createLogger({ name: 'test', destination });
    log.info(
      { password: 'p1', user: { token: 't1', name: 'ok' }, cfg: { uri: 'mongodb://a:b@h/d' } },
      'event',
    );
    const [line] = lines;
    expect(line.password).toBe('[REDACTED]');
    expect(line.user.token).toBe('[REDACTED]');
    expect(line.user.name).toBe('ok');
    expect(line.cfg.uri).toBe('[REDACTED]');
  });

  it('redacts request headers and bodies', () => {
    const { lines, destination } = capture();
    const log = createLogger({ name: 'test', destination });
    log.info(
      {
        req: {
          headers: { authorization: 'Bearer x', cookie: 'sid=1', 'x-ai-key': 'k', host: 'h' },
          body: { a: 1 },
        },
      },
      'req',
    );
    const [line] = lines;
    expect(line.req.headers.authorization).toBe('[REDACTED]');
    expect(line.req.headers.cookie).toBe('[REDACTED]');
    expect(line.req.headers['x-ai-key']).toBe('[REDACTED]');
    expect(line.req.headers.host).toBe('h');
    expect(line.req.body).toBe('[REDACTED]');
  });

  it('scrubs credentials inside messages and errors', () => {
    const { lines, destination } = capture();
    const log = createLogger({ name: 'test', destination });
    log.error('failed mongodb://root:pw123@10.0.0.5:27017');
    log.error({ err: new Error('bad postgres://u:secretpw@host/db') }, 'wrapped');
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain('pw123');
    expect(serialized).not.toContain('secretpw');
    expect(lines[0].msg).toBe('failed mongodb://***@10.0.0.5:27017');
  });

  it('honors level and emits level labels with the service name', () => {
    const { lines, destination } = capture();
    const log = createLogger({ name: 'ai-service', level: 'warn', destination });
    log.info('hidden');
    log.warn('shown');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'warn', name: 'ai-service', msg: 'shown' });
  });
});
