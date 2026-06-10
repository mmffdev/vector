// Multi-DB read-only Postgres layer for the standalone log viewer.
//
// Defence-in-depth:
//   * every connection sets default_transaction_read_only = on
//   * every public query helper rejects non-SELECT/WITH SQL
//   * request values are bound params; identifiers are validated in sources

import pg from 'pg';

const { Pool } = pg;

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const pools = new Map();

export function initPools(databases) {
  for (const [key, db] of Object.entries(databases)) {
    const pool = new Pool({
      connectionString: db.url,
      max: Number(db.maxPoolConnections) || 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: `vector-log-viewer:${key}`,
    });

    const timeoutMs = Number(db.statementTimeoutMs) || 8000;
    pool.on('connect', (client) => {
      client
        .query(`SET default_transaction_read_only = on; SET statement_timeout = ${timeoutMs};`)
        .catch(() => {});
    });
    pool.on('error', (err) => {
      console.error(`[db:${key}] idle client error:`, err.message);
    });

    pools.set(key, pool);
  }
  return pools;
}

export function getPool(dbKey) {
  const pool = pools.get(dbKey);
  if (!pool) throw new Error(`DB pool not initialised for ${dbKey}`);
  return pool;
}

function assertReadOnlySql(text) {
  const trimmed = String(text || '').trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    throw new Error('readQuery refuses non-SELECT statements');
  }
}

export async function readQuery(dbKey, text, params = []) {
  assertReadOnlySql(text);
  const client = await getPool(dbKey).connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function healthCheck(dbKey) {
  const res = await readQuery(dbKey, 'SELECT 1 AS ok, now() AS server_time');
  return res.rows[0];
}

export async function healthCheckAll() {
  const entries = await Promise.all(
    [...pools.keys()].map(async (key) => {
      try {
        const result = await healthCheck(key);
        return [key, { ok: true, server_time: result.server_time }];
      } catch (err) {
        return [key, { ok: false, error: err.message }];
      }
    })
  );
  return Object.fromEntries(entries);
}

export async function closePools() {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((pool) => pool.end()));
}
