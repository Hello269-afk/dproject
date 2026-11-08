import { config } from '../config.js';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function pgliteDb(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir !== 'memory://') {
    // PGlite's mkdir isn't recursive; make sure parent folders exist on a fresh checkout.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
  }
  const pg = dir === 'memory://' ? new PGlite() : new PGlite(dir);
  await pg.waitReady;
  return {
    async query(sql, params) {
      return (await pg.query<any>(sql, params ?? [])).rows;
    },
    tx(fn) {
      return pg.transaction((t) => fn({ query: async (sql, params) => (await t.query<any>(sql, params ?? [])).rows }));
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
}

async function postgresDb(url: string): Promise<Db> {
  const { default: pgmod } = await import('pg');
  // Return int8 (bigserial ids, counts) as JS numbers; they stay well inside 2^53 here.
  pgmod.types.setTypeParser(20, (v) => Number(v));
  const pool = new pgmod.Pool({ connectionString: url, max: 10 });
  return {
    async query(sql, params) {
      return (await pool.query(sql, params as any[])).rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: async (sql, params) => (await client.query(sql, params as any[])).rows });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

export async function openDb(url = config.databaseUrl, pgliteDir = config.pgliteDir): Promise<Db> {
  return /^postgres(ql)?:\/\//.test(url) ? postgresDb(url) : pgliteDb(pgliteDir);
}
