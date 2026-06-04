// SQL builders for a LogSource. Every value is bound ($1, $2, ...); only
// config-validated identifiers are interpolated. Keyset (cursor) pagination on
// the order column keeps tailing cheap on large tables — no OFFSET scans.

import { readQuery } from './db.js';

/**
 * Most-recent N rows, returned oldest-first so the viewer can append
 * downward like a real tail.
 */
export async function tail(source, limit) {
  const sql = `
    SELECT * FROM (
      SELECT ${source.selectList()}
      FROM "${source.table}"
      ORDER BY "${source.orderColumn}" DESC, "${source.idColumn}" DESC
      LIMIT $1
    ) sub
    ORDER BY "${source.orderColumn}" ASC, "${source.idColumn}" ASC
  `;
  const res = await readQuery(sql, [limit]);
  return res.rows.map((r) => source.normalise(r));
}

/**
 * Incremental tail: rows strictly newer than the given cursor timestamp.
 * Used by the SSE poll loop. `sinceTs` is an ISO string or null.
 */
export async function since(source, sinceTs, limit) {
  if (!sinceTs) return tail(source, limit);
  const sql = `
    SELECT ${source.selectList()}
    FROM "${source.table}"
    WHERE "${source.orderColumn}" > $1
    ORDER BY "${source.orderColumn}" ASC, "${source.idColumn}" ASC
    LIMIT $2
  `;
  const res = await readQuery(sql, [sinceTs, limit]);
  return res.rows.map((r) => source.normalise(r));
}

/**
 * A bounded historical range by absolute row offset (line numbers). 1-based,
 * inclusive. Used by "jump to line X" and range export.
 */
export async function range(source, start, end) {
  const from = Math.max(1, Number(start) || 1);
  const to = Math.max(from, Number(end) || from);
  const limit = to - from + 1;
  const offset = from - 1;
  const sql = `
    SELECT ${source.selectList()}
    FROM "${source.table}"
    ORDER BY "${source.orderColumn}" ASC, "${source.idColumn}" ASC
    LIMIT $1 OFFSET $2
  `;
  const res = await readQuery(sql, [limit, offset]);
  return res.rows.map((r, i) => ({ ...source.normalise(r), lineNumber: from + i }));
}

/** Total row count — the absolute line-number ceiling for a source. */
export async function count(source) {
  const res = await readQuery(`SELECT count(*) AS n FROM "${source.table}"`);
  return res.rows[0].n;
}

/**
 * Dashboard stats for one source: total, last 24h volume bucketed per hour,
 * and the top "actions" (or derived states) by frequency.
 */
export async function stats(source) {
  const total = await count(source);

  const volumeSql = `
    SELECT date_trunc('hour', "${source.tsColumn}") AS bucket, count(*) AS n
    FROM "${source.table}"
    WHERE "${source.tsColumn}" > now() - interval '24 hours'
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  const volume = (await readQuery(volumeSql)).rows.map((r) => ({
    bucket: r.bucket,
    n: r.n,
  }));

  let topPatterns = [];
  if (source.levelFrom && source.levelFrom !== '_derived') {
    const topSql = `
      SELECT "${source.levelFrom}" AS pattern, count(*) AS n
      FROM "${source.table}"
      GROUP BY pattern
      ORDER BY n DESC
      LIMIT 12
    `;
    topPatterns = (await readQuery(topSql)).rows.map((r) => ({
      pattern: r.pattern,
      n: r.n,
    }));
  }

  const latest = (
    await readQuery(
      `SELECT max("${source.tsColumn}") AS latest FROM "${source.table}"`
    )
  ).rows[0].latest;

  return { id: source.id, name: source.name, total, latest, volume, topPatterns };
}
