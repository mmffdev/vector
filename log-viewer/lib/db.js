// Read-only Postgres access layer for the log viewer.
//
// Trust-No-One posture (Vector is a defence/finance product):
//   * Every connection sets `default_transaction_read_only = on` and a
//     statement_timeout, so even a bug in this tool cannot mutate or hang the DB.
//   * The viewer issues ONLY parameterised SELECTs. Identifiers (table/column
//     names) come from config.json — never from a request — and are validated
//     against a strict identifier allowlist before ever reaching SQL.
//   * No request value is ever string-interpolated into SQL; values are bound.

import pg from 'pg';

const { Pool } = pg;

// Postgres returns BIGINT/COUNT as strings by default (pg type 20). We read
// only modest counts here, so parse them to JS numbers for the stats API.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

let pool = null;

export function initPool({ url, statementTimeoutMs = 8000, max = 4 }) {
  pool = new Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'vector-log-viewer',
  });

  // Belt-and-braces: force every checked-out connection read-only.
  // Combined into a single round-trip so we never overlap queries on one client.
  const timeoutMs = Number(statementTimeoutMs) || 8000;
  pool.on('connect', (client) => {
    client
      .query(`SET default_transaction_read_only = on; SET statement_timeout = ${timeoutMs};`)
      .catch(() => {});
  });

  pool.on('error', (err) => {
    // Idle client error — log and let the pool recycle it. Never crash the server.
    console.error('[db] idle client error:', err.message);
  });

  return pool;
}

export function getPool() {
  if (!pool) throw new Error('DB pool not initialised — call initPool() first.');
  return pool;
}

/**
 * Run a read-only parameterised query. Rejects anything that isn't a SELECT/WITH
 * as a defensive guard — this layer must never carry a write to the DB.
 */
export async function readQuery(text, params = []) {
  const head = text.trim().slice(0, 6).toUpperCase();
  if (head !== 'SELECT' && head !== 'WITH (' && !text.trim().toUpperCase().startsWith('WITH')) {
    throw new Error('readQuery refuses non-SELECT statements');
  }
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function healthCheck() {
  const res = await readQuery('SELECT 1 AS ok, now() AS server_time');
  return res.rows[0];
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
