// Database adapter. The same Postgres SQL runs on either:
//  - embedded PGlite (default, zero install, stored in backend/data/pglite)
//  - a real PostgreSQL server when DATABASE_URL is set (e.g. Azure PostgreSQL later)
import fs from 'node:fs';
import { config } from '../config.js';

let impl = null;

const DATE_OID = 1082;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

async function createPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  if (!config.pgliteDir.startsWith('memory://')) fs.mkdirSync(config.pgliteDir, { recursive: true });
  const db = await PGlite.create(config.pgliteDir, {
    parsers: { [DATE_OID]: (v) => v, [INT8_OID]: (v) => Number(v), [NUMERIC_OID]: (v) => Number(v) },
  });
  const wrap = (q) => ({
    async query(sql, params = []) {
      const r = await q.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    kind: 'pglite (embedded)',
    ...wrap(db),
    exec: (sql) => db.exec(sql),
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  };
}

async function createPg() {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(DATE_OID, (v) => v);
  pg.types.setTypeParser(INT8_OID, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC_OID, (v) => Number(v));
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const wrap = (c) => ({
    async query(sql, params = []) {
      const r = await c.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
  });
  return {
    kind: 'postgres',
    ...wrap(pool),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function initDb() {
  if (impl) return impl;
  impl = config.databaseUrl ? await createPg() : await createPglite();
  return impl;
}

function get() {
  if (!impl) throw new Error('Database not initialised - call initDb() first');
  return impl;
}

/** Run a query. Returns { rows, rowCount }. */
export const query = (sql, params) => get().query(sql, params);
/** First row or null. */
export const one = async (sql, params) => (await get().query(sql, params)).rows[0] ?? null;
/** All rows. */
export const many = async (sql, params) => (await get().query(sql, params)).rows;
/** Run fn(q) inside a transaction; q has .query(sql, params). */
export const tx = (fn) => get().tx(fn);
export const exec = (sql) => get().exec(sql);
export const dbKind = () => get().kind;
export const closeDb = async () => {
  if (impl) await impl.close();
  impl = null;
};
