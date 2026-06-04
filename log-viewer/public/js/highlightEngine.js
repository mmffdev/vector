// Highlight engine.
//
// Two concerns:
//   1. LEVEL styling — every line has a level (ERROR/WARN/INFO/DEBUG/SUCCESS/
//      CRITICAL/TRACE); we map it to a CSS class. This is structural, not a
//      "rule" the user manages.
//   2. PATTERN highlights — built-in (IP, UUID, timestamp) plus user-defined
//      regex → colour. These wrap matched substrings in <mark> and feed the
//      highlight summary + jump-between navigation.
//
// Persisted to localStorage so rules survive reloads.

const LS_KEY = 'vlv.highlights.v1';

const LEVEL_CLASS = {
  ERROR: 'lvl-error',
  FATAL: 'lvl-error',
  WARN: 'lvl-warn',
  WARNING: 'lvl-warn',
  INFO: 'lvl-info',
  DEBUG: 'lvl-debug',
  TRACE: 'lvl-trace',
  SUCCESS: 'lvl-success',
  CRITICAL: 'lvl-critical',
};

// Built-in structural patterns. Always on; cannot be deleted.
const BUILTIN = [
  { id: 'ip', label: 'IP address', color: '#38bdf8', builtin: true, source: '\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b|\\b(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}\\b' },
  { id: 'uuid', label: 'UUID', color: '#a78bfa', builtin: true, source: '\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b' },
  { id: 'ts', label: 'Timestamp', color: '#34d399', builtin: true, source: '\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z?\\b' },
];

export function levelClass(level) {
  return LEVEL_CLASS[String(level || '').toUpperCase()] || 'lvl-info';
}

export class HighlightEngine {
  constructor() {
    this.custom = this.#load();
    this.counts = new Map(); // id -> match count this render pass
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  #emit() {
    this.#save();
    for (const fn of this.listeners) fn();
  }

  rules() {
    return [...BUILTIN, ...this.custom];
  }

  addCustom(source, color) {
    try {
      new RegExp(source); // validate
    } catch (err) {
      throw new Error(`Invalid regex: ${err.message}`);
    }
    const id = 'u' + Date.now().toString(36);
    this.custom.push({ id, label: source, color, source, builtin: false, enabled: true });
    this.#emit();
    return id;
  }

  removeCustom(id) {
    this.custom = this.custom.filter((r) => r.id !== id);
    this.#emit();
  }

  toggle(id) {
    const r = this.custom.find((x) => x.id === id);
    if (r) {
      r.enabled = !r.enabled;
      this.#emit();
    }
  }

  /** Build one combined matcher so we wrap in a single pass, preserving order. */
  #activeRules() {
    return this.rules().filter((r) => r.builtin || r.enabled !== false);
  }

  /**
   * Escape text and wrap every pattern match in a coloured <mark>.
   * Returns { html, hit } where `hit` is true if any custom rule matched
   * (used by the "only highlighted" filter and jump navigation).
   */
  decorate(text) {
    const safe = escapeHtml(text);
    const rules = this.#activeRules();
    if (!rules.length) return { html: safe, hit: false };

    // Collect non-overlapping match spans across all rules.
    const spans = [];
    for (const rule of rules) {
      let re;
      try {
        re = new RegExp(rule.source, 'gi');
      } catch {
        continue;
      }
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        spans.push({ start: m.index, end: m.index + m[0].length, rule });
        this.counts.set(rule.id, (this.counts.get(rule.id) || 0) + 1);
      }
    }
    if (!spans.length) return { html: safe, hit: false };

    spans.sort((a, b) => a.start - b.start || b.end - a.end);

    // Build output skipping overlaps (first/longest wins).
    let out = '';
    let cursor = 0;
    let hit = false;
    for (const s of spans) {
      if (s.start < cursor) continue;
      out += escapeHtml(text.slice(cursor, s.start));
      const frag = escapeHtml(text.slice(s.start, s.end));
      out += `<mark class="hl" data-rule="${s.rule.id}" style="--hl:${s.rule.color}">${frag}</mark>`;
      if (!s.rule.builtin) hit = true;
      cursor = s.end;
    }
    out += escapeHtml(text.slice(cursor));
    return { html: out, hit };
  }

  resetCounts() {
    this.counts.clear();
  }
  countFor(id) {
    return this.counts.get(id) || 0;
  }

  #load() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  #save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.custom));
    } catch {
      /* quota — ignore */
    }
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
