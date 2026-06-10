// Query builders for validated LogSource definitions.
//
// Values are always bound. Identifiers are only from LogSource, which validates
// config.json at boot. The query surface intentionally stays small and
// read-only: list, live tail, facets, histogram, and stats.

import { readQuery } from './db.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, v));
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function fieldSql(field) {
  return `"${field}"`;
}

function castText(field) {
  return `${fieldSql(field)}::text`;
}

function buildOneFilter(source, params, filter) {
  if (!filter || !source.hasField(filter.field)) return null;
  const op = filter.op || 'eq';
  const field = filter.field;
  const value = filter.value;

  if (op === 'exists') return `${fieldSql(field)} IS NOT NULL AND ${castText(field)} <> ''`;
  if (op === 'missing') return `(${fieldSql(field)} IS NULL OR ${castText(field)} = '')`;

  if (op === 'eq') return `${castText(field)} = ${addParam(params, String(value ?? ''))}`;
  if (op === 'neq') return `${castText(field)} <> ${addParam(params, String(value ?? ''))}`;
  if (op === 'contains') return `${castText(field)} ILIKE ${addParam(params, `%${value ?? ''}%`)}`;
  if (op === 'not_contains') return `${castText(field)} NOT ILIKE ${addParam(params, `%${value ?? ''}%`)}`;
  if (op === 'regex') return `${castText(field)} ~* ${addParam(params, String(value ?? ''))}`;
  if (op === 'in' && Array.isArray(value) && value.length) {
    return `${castText(field)} = ANY(${addParam(params, value.map((v) => String(v)))})`;
  }
  return null;
}

function buildWhere(source, opts = {}) {
  const params = [];
  const clauses = [];

  if (opts.from) clauses.push(`${fieldSql(source.tsColumn)} >= ${addParam(params, opts.from)}`);
  if (opts.to) clauses.push(`${fieldSql(source.tsColumn)} <= ${addParam(params, opts.to)}`);

  if (opts.q) {
    const qClauses = source.searchColumns.map((field) => {
      if (opts.regex) return `${castText(field)} ~* ${addParam(params, opts.q)}`;
      return `${castText(field)} ILIKE ${addParam(params, `%${opts.q}%`)}`;
    });
    if (qClauses.length) clauses.push(`(${qClauses.join(' OR ')})`);
  }

  for (const filter of opts.filters || []) {
    const clause = buildOneFilter(source, params, filter);
    if (clause) clauses.push(clause);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function applyLevelFilter(lines, levels = []) {
  if (!levels.length) return lines;
  const wanted = new Set(levels.map((level) => String(level).toUpperCase()));
  return lines.filter((line) => wanted.has(String(line.level).toUpperCase()));
}

export async function query(source, opts = {}) {
  const limit = clamp(opts.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const { where, params } = buildWhere(source, opts);
  const sql = `
    SELECT ${source.selectList()}
    FROM "${source.table}"
    ${where}
    ORDER BY "${source.orderColumn}" DESC, "${source.idColumn}" DESC
    LIMIT ${addParam(params, limit * (opts.levels?.length ? 3 : 1))}
  `;
  const res = await readQuery(source.db, sql, params);
  const lines = applyLevelFilter(res.rows.map((row) => source.normalise(row)), opts.levels).slice(0, limit);
  return { source: source.id, lines, limit };
}

export async function tail(source, limit, opts = {}) {
  const capped = clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const { where, params } = buildWhere(source, opts);
  const sql = `
    SELECT * FROM (
      SELECT ${source.selectList()}
      FROM "${source.table}"
      ${where}
      ORDER BY "${source.orderColumn}" DESC, "${source.idColumn}" DESC
      LIMIT ${addParam(params, capped * (opts.levels?.length ? 3 : 1))}
    ) sub
    ORDER BY "${source.orderColumn}" ASC, "${source.idColumn}" ASC
  `;
  const res = await readQuery(source.db, sql, params);
  return applyLevelFilter(res.rows.map((row) => source.normalise(row)), opts.levels).slice(-capped);
}

export async function since(source, cursor, limit, opts = {}) {
  if (!cursor?.orderValue) return tail(source, limit, opts);
  const capped = clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const built = buildWhere(source, opts);
  const params = [...built.params];
  const cursorSql = `("${source.orderColumn}" > ${addParam(params, cursor.orderValue)}
    OR ("${source.orderColumn}" = ${addParam(params, cursor.orderValue)} AND "${source.idColumn}"::text > ${addParam(params, String(cursor.id ?? ''))}))`;
  const where = built.where ? `${built.where} AND ${cursorSql}` : `WHERE ${cursorSql}`;

  const sql = `
    SELECT ${source.selectList()}
    FROM "${source.table}"
    ${where}
    ORDER BY "${source.orderColumn}" ASC, "${source.idColumn}" ASC
    LIMIT ${addParam(params, capped * (opts.levels?.length ? 3 : 1))}
  `;
  const res = await readQuery(source.db, sql, params);
  return applyLevelFilter(res.rows.map((row) => source.normalise(row)), opts.levels).slice(0, capped);
}

export async function count(source, opts = {}) {
  const { where, params } = buildWhere(source, opts);
  const res = await readQuery(source.db, `SELECT count(*) AS n FROM "${source.table}" ${where}`, params);
  return res.rows[0]?.n || 0;
}

export async function latest(source) {
  const res = await readQuery(
    source.db,
    `SELECT max("${source.tsColumn}") AS latest FROM "${source.table}"`
  );
  return res.rows[0]?.latest || null;
}

export async function facets(source, opts = {}) {
  const output = {};
  for (const facet of source.facets) {
    const { where, params } = buildWhere(source, opts);
    const sql = `
      SELECT coalesce(nullif(${castText(facet.field)}, ''), '(empty)') AS value, count(*) AS n
      FROM "${source.table}"
      ${where}
      GROUP BY value
      ORDER BY n DESC, value ASC
      LIMIT 20
    `;
    output[facet.field] = {
      label: facet.label,
      values: (await readQuery(source.db, sql, params)).rows,
    };
  }
  return output;
}

export async function histogram(source, opts = {}) {
  const bucket = opts.bucket === 'day' ? 'day' : opts.bucket === 'minute' ? 'minute' : 'hour';
  const { where, params } = buildWhere(source, opts);
  const sql = `
    SELECT date_trunc('${bucket}', "${source.tsColumn}") AS bucket, count(*) AS n
    FROM "${source.table}"
    ${where}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  const res = await readQuery(source.db, sql, params);
  return res.rows.map((row) => ({ bucket: row.bucket, n: row.n }));
}

export async function stats(source) {
  const [total, latestAt, volume] = await Promise.all([
    count(source),
    latest(source),
    histogram(source, { bucket: 'hour' }),
  ]);

  let topPatterns = [];
  if (source.levelFrom && source.levelFrom !== '_derived' && source.hasField(source.levelFrom)) {
    const sql = `
      SELECT coalesce(nullif(${castText(source.levelFrom)}, ''), '(empty)') AS pattern, count(*) AS n
      FROM "${source.table}"
      GROUP BY pattern
      ORDER BY n DESC
      LIMIT 12
    `;
    topPatterns = (await readQuery(source.db, sql)).rows;
  }

  return {
    id: source.id,
    name: source.name,
    group: source.group,
    color: source.color,
    db: source.db,
    table: source.table,
    total,
    latest: latestAt,
    volume,
    topPatterns,
  };
}
