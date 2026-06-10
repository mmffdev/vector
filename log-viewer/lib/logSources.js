// Config -> validated source registry, plus DB row -> normalized log event.

const IDENT = /^[a-z_][a-z0-9_]*$/;
const SOURCE_ID = /^[a-z][a-z0-9_-]*$/;

function assertIdent(name, what) {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw new Error(`Unsafe ${what} in config: ${JSON.stringify(name)}`);
  }
  return name;
}

function assertSourceId(name) {
  if (typeof name !== 'string' || !SOURCE_ID.test(name)) {
    throw new Error(`Unsafe source id in config: ${JSON.stringify(name)}`);
  }
  return name;
}

function compact(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function asIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export class LogSource {
  constructor(def, databases) {
    this.id = assertSourceId(def.id);
    this.name = def.name || def.id;
    this.group = def.group || 'Logs';
    this.description = def.description || '';
    this.color = def.color || '#64748B';
    this.db = def.db || 'vector';
    if (!databases[this.db]) throw new Error(`Source ${this.id} references unknown DB ${this.db}`);

    this.table = assertIdent(def.table, `${this.id}.table`);
    this.idColumn = assertIdent(def.idColumn, `${this.id}.idColumn`);
    this.tsColumn = assertIdent(def.tsColumn, `${this.id}.tsColumn`);
    this.orderColumn = assertIdent(def.orderColumn || def.tsColumn, `${this.id}.orderColumn`);
    this.columns = compact([this.idColumn, this.tsColumn, ...(def.columns || [])]).map((column) =>
      assertIdent(column, `${this.id}.column`)
    );
    this.searchColumns = compact(def.searchColumns || this.columns).map((column) =>
      assertIdent(column, `${this.id}.searchColumn`)
    );
    this.messageTemplate = def.messageTemplate || '';
    this.levelFrom = def.levelFrom || '_derived';
    if (this.levelFrom !== '_derived') assertIdent(this.levelFrom, `${this.id}.levelFrom`);
    this.levelRules = Array.isArray(def.levelRules) ? def.levelRules : [];
    this.defaultLevel = def.defaultLevel || 'INFO';
    this.facets = (def.facets || []).map((facet) => ({
      field: assertIdent(facet.field, `${this.id}.facet`),
      label: facet.label || facet.field,
    }));
    this.correlationKeys = Object.fromEntries(
      Object.entries(def.correlationKeys || {}).map(([key, field]) => [
        key,
        assertIdent(field, `${this.id}.correlationKey.${key}`),
      ])
    );
    this.filterFields = compact([
      ...this.columns,
      ...this.searchColumns,
      ...this.facets.map((facet) => facet.field),
      ...Object.values(this.correlationKeys),
    ]);
  }

  selectList() {
    return this.columns.map((column) => `"${column}"`).join(', ');
  }

  hasField(field) {
    return this.filterFields.includes(field);
  }

  publicShape() {
    return {
      id: this.id,
      name: this.name,
      group: this.group,
      description: this.description,
      color: this.color,
      db: this.db,
      table: this.table,
      idColumn: this.idColumn,
      tsColumn: this.tsColumn,
      facets: this.facets,
      searchColumns: this.searchColumns,
      correlationKeys: this.correlationKeys,
    };
  }

  derivedSubject(row) {
    if (this.id === 'users_sessions') {
      const revoked = row.users_sessions_revoked === true;
      const rotated = Boolean(row.users_sessions_rotated_at);
      if (revoked && rotated) return 'rotated';
      if (revoked) return 'revoked';
      return 'active';
    }

    const lastError = Object.keys(row).find((key) => key.endsWith('_last_error'));
    if (lastError && row[lastError]) return 'error';
    const delivered = Object.keys(row).find((key) => key.endsWith('_delivered_at'));
    if (delivered && row[delivered]) return 'delivered';
    const attempts = Object.keys(row).find((key) => key.endsWith('_attempts'));
    if (attempts && Number(row[attempts]) > 0) return 'retry';
    return 'info';
  }

  classifyLevel(row) {
    const subject =
      this.levelFrom === '_derived'
        ? this.derivedSubject(row)
        : stringifyValue(row[this.levelFrom]);

    for (const rule of this.levelRules) {
      try {
        if (new RegExp(rule.match, 'i').test(subject)) return rule.level || this.defaultLevel;
      } catch {
        // Bad config regex: skip it rather than making the whole viewer unusable.
      }
    }
    return this.defaultLevel;
  }

  renderMessage(row) {
    if (!this.messageTemplate) return JSON.stringify(row);
    let out = this.messageTemplate;
    out = out.replace('{resource_id_suffix}', () => {
      const rid = row.audit_logs_resource_id;
      return rid ? `#${rid}` : '';
    });
    out = out.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, key) => stringifyValue(row[key]));
    return out.replace(/\s{2,}/g, '  ').trim();
  }

  correlations(row) {
    return Object.fromEntries(
      Object.entries(this.correlationKeys)
        .map(([key, field]) => [key, stringifyValue(row[field])])
        .filter(([, value]) => value !== '')
    );
  }

  normalise(row, lineNumber = null) {
    const ts = asIso(row[this.tsColumn]);
    const orderValue = asIso(row[this.orderColumn]) || ts;
    return {
      source: this.id,
      sourceName: this.name,
      color: this.color,
      id: stringifyValue(row[this.idColumn]),
      ts,
      orderValue,
      level: this.classifyLevel(row),
      message: this.renderMessage(row),
      raw: row,
      correlations: this.correlations(row),
      lineNumber,
    };
  }
}

export function buildLogSources(config, databases) {
  const map = new Map();
  const list = config.sources || config.logs || [];
  for (const def of list) {
    const source = new LogSource(def, databases);
    if (map.has(source.id)) throw new Error(`Duplicate log source id: ${source.id}`);
    map.set(source.id, source);
  }
  return map;
}
