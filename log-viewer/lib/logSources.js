// Turns config.json log definitions into validated, queryable "log sources",
// and turns raw DB rows into normalised log lines the frontend understands.
//
// A normalised line looks like:
//   { id, ts, level, message, raw, correlation }
// where `raw` is the full row (for expand / export / cross-reference) and
// `correlation` is the value the cross-referencing system joins on.

// Postgres identifier allowlist — table and column names from config are
// validated against this before being placed into SQL. Anything from a request
// is bound as a parameter and never reaches here.
const IDENT = /^[a-z_][a-z0-9_]*$/;

function assertIdent(name, what) {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw new Error(`Unsafe ${what} in config: ${JSON.stringify(name)}`);
  }
  return name;
}

export class LogSource {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.color = def.color || '#888888';
    this.table = assertIdent(def.table, 'table name');
    this.idColumn = assertIdent(def.idColumn, 'idColumn');
    this.tsColumn = assertIdent(def.tsColumn, 'tsColumn');
    this.orderColumn = assertIdent(def.orderColumn || def.tsColumn, 'orderColumn');
    this.columns = (def.columns || []).map((c) => assertIdent(c, 'column'));
    if (!this.columns.includes(this.idColumn)) this.columns.unshift(this.idColumn);
    this.messageTemplate = def.messageTemplate || '';
    this.levelFrom = def.levelFrom || '_derived';
    this.levelRules = def.levelRules || [];
    this.defaultLevel = def.defaultLevel || 'INFO';
    this.correlationKey = def.correlationKey
      ? assertIdent(def.correlationKey, 'correlationKey')
      : null;
  }

  /** Comma-separated, validated column list for SELECT. */
  selectList() {
    return this.columns.map((c) => `"${c}"`).join(', ');
  }

  /** Derive a level keyword used for matching when levelFrom === "_derived". */
  #derivedSubject(row) {
    // users_sessions has no level column; synthesise one from row state.
    // Distinguish *routine rotation* (revoked because a successor token was
    // issued — expected, not alarming) from a *bare revoke* (forced logout /
    // token reuse — a real anomaly worth surfacing).
    const revoked = row[`${this.table}_revoked`] === true || row.users_sessions_revoked === true;
    const rotated = !!(row[`${this.table}_rotated_at`] || row.users_sessions_rotated_at);
    if (revoked && rotated) return 'rotated'; // normal refresh chain → WARN
    if (revoked) return 'revoked'; // bare revoke, no successor → ERROR
    return 'active';
  }

  classifyLevel(row) {
    const subject =
      this.levelFrom === '_derived'
        ? this.#derivedSubject(row)
        : String(row[this.levelFrom] ?? '');
    for (const rule of this.levelRules) {
      let re;
      try {
        re = new RegExp(rule.match, 'i');
      } catch {
        continue;
      }
      if (re.test(subject)) return rule.level;
    }
    return this.defaultLevel;
  }

  #renderMessage(row) {
    // {col} substitution + a couple of computed helpers.
    let out = this.messageTemplate;
    out = out.replace('{resource_id_suffix}', () => {
      const rid = row[`${this.table}_resource_id`] ?? row.audit_logs_resource_id;
      return rid ? `#${rid}` : '';
    });
    out = out.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, key) => {
      const v = row[key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });
    // Collapse runs of whitespace left by empty substitutions.
    return out.replace(/\s{2,}/g, '  ').trim();
  }

  /** Normalise one DB row into a frontend log line. */
  normalise(row) {
    return {
      id: row[this.idColumn],
      ts: row[this.tsColumn],
      level: this.classifyLevel(row),
      message: this.messageTemplate ? this.#renderMessage(row) : JSON.stringify(row),
      raw: row,
      correlation: this.correlationKey ? row[this.correlationKey] : null,
    };
  }
}

export function buildLogSources(config) {
  const map = new Map();
  for (const def of config.logs || []) {
    const src = new LogSource(def);
    map.set(src.id, src);
  }
  return map;
}
