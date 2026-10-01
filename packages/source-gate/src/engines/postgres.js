import pg from 'pg';
import { POOL_SIZES } from '../constants.js';

export function createPostgresEngine({ Pool = pg.Pool, onPoolError = () => {} } = {}) {
  return {
    kind: 'postgres',
    async connect(source, secret) {
      const pool = new Pool({
        connectionString: secret,
        max: POOL_SIZES.postgres,
        statement_timeout: source.limits?.maxTimeMs ?? 30000,
        options: '-c default_transaction_read_only=on',
        application_name: 'fab5-ai-gate',
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      });
      pool.on('error', onPoolError);
      try {
        await pool.query('SELECT 1');
      } catch (error) {
        await pool.end().catch(() => {});
        throw error;
      }
      return pool;
    },
    async close(pool) {
      await pool.end();
    },
    async ping(pool) {
      await pool.query('SELECT 1');
    },
    poolSize(pool) {
      return pool?.totalCount ?? POOL_SIZES.postgres;
    }
  };
}
