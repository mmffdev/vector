// LogViewer — one panel bound to one log source.
//
// Owns: the SSE stream for its source, an in-memory ring of lines (capped),
// virtual scrolling (only visible rows are in the DOM), per-panel filtering,
// line selection, expand/collapse, and the right-click context menu.
//
// It is intentionally self-contained: app.js wires panels together for
// cross-panel concerns (global filter, export scope, cross-references) via the
// public methods and the callbacks passed in `opts`.

import { levelClass } from './highlightEngine.js';
import { copyText } from './exportManager.js';

const ROW_H = 22; // px, must match .row height in CSS
const OVERSCAN = 8; // rows rendered above/below the viewport

export class LogViewer {
  /**
   * @param {HTMLElement} el  the .panel element (cloned from template)
   * @param {object} opts { sources, maxLines, highlighter, onStatus, onContext,
   *                        onCrossRef, onSelectionChange, globalFilterState }
   */
  constructor(el, opts) {
    this.el = el;
    this.opts = opts;
    this.highlighter = opts.highlighter;
    this.maxLines = opts.maxLines || 50000;

    this.lines = []; // full ring of {id, ts, level, message, raw, correlation, lineNumber}
    this.filtered = []; // indices into this.lines that pass the active filter
    this.selected = new Set(); // selected lineNumbers
    this.expanded = new Set(); // expanded lineNumbers
    this.lastClickIdx = null; // for shift-range selection (index into filtered)

    this.total = 0; // absolute rows in the table
    this.baseLine = 0; // absolute line number of lines[0]
    this.paused = false;
    this.rate = { count: 0, ts: performance.now() };

    this.localFilter = '';
    this.es = null;
    this.sourceId = null;

    this.#bindDom();
  }

  // ---- DOM wiring ----------------------------------------------------------

  #bindDom() {
    const $ = (s) => this.el.querySelector(s);
    this.dom = {
      select: $('.panel__select'),
      swatch: $('.panel__swatch'),
      count: $('.panel__count'),
      latest: $('.panel__latest'),
      filter: $('.panel__filter'),
      viewport: $('.panel__viewport'),
      rows: $('.panel__rows'),
      top: $('.panel__spacer-top'),
      bottom: $('.panel__spacer-bottom'),
      jump: $('.panel__jump'),
      close: $('.panel__close'),
    };

    // Populate source selector.
    for (const s of this.opts.sources) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      this.dom.select.appendChild(o);
    }
    this.dom.select.addEventListener('change', () => this.connect(this.dom.select.value));

    this.dom.filter.addEventListener('input', (e) => {
      this.localFilter = e.target.value;
      this.applyFilter();
    });

    this.dom.viewport.addEventListener('scroll', () => this.render());
    this.dom.rows.addEventListener('click', (e) => this.#onRowClick(e));
    this.dom.rows.addEventListener('contextmenu', (e) => this.#onRowContext(e));

    this.dom.jump.addEventListener('click', () => this.#promptJump());
    this.dom.close.addEventListener('click', () => this.opts.onClose?.(this));

    new ResizeObserver(() => this.render()).observe(this.dom.viewport);
  }

  // ---- stream lifecycle ----------------------------------------------------

  connect(sourceId) {
    if (this.es) this.es.close();
    this.sourceId = sourceId;
    this.dom.select.value = sourceId;
    const src = this.opts.sources.find((s) => s.id === sourceId);
    this.dom.swatch.style.background = src?.color || '#888';

    this.lines = [];
    this.filtered = [];
    this.selected.clear();
    this.expanded.clear();
    this.baseLine = 0;

    this.es = new EventSource(`/api/logs/${encodeURIComponent(sourceId)}/stream`);
    this.es.addEventListener('hello', (e) => {
      const d = JSON.parse(e.data);
      this.total = d.total;
      this.baseLine = Math.max(0, d.total - 0); // refined on first batch
      this.opts.onStatus?.('up');
    });
    this.es.addEventListener('lines', (e) => {
      const d = JSON.parse(e.data);
      this.#ingest(d.lines, d.reset);
    });
    this.es.addEventListener('ping', () => this.opts.onStatus?.('up'));
    this.es.addEventListener('error', () => this.opts.onStatus?.('down'));
    this.es.onerror = () => this.opts.onStatus?.('down');
  }

  setPaused(p) {
    this.paused = p;
    // We keep the EventSource open but stop appending while paused, buffering
    // nothing (next reconnect re-seeds). Simpler + matches "freeze the view".
    if (!p) this.connect(this.sourceId); // re-seed to catch up
  }

  disconnect() {
    if (this.es) this.es.close();
    this.es = null;
  }

  // ---- ingest --------------------------------------------------------------

  #ingest(incoming, reset) {
    if (this.paused) return;
    if (reset) {
      this.lines = [];
      // Absolute line number of the first seeded row = total - seeded + 1.
      this.baseLine = Math.max(1, this.total - incoming.length + 1);
    }
    const stickToBottom = this.#isNearBottom();

    for (const ln of incoming) {
      ln.lineNumber = this.baseLine + this.lines.length;
      this.lines.push(ln);
      this.total = Math.max(this.total, ln.lineNumber);
      this.rate.count++;
      // notify app for cross-panel concerns (notifications, correlation index)
      if (!reset) this.opts.onLine?.(this, ln);
    }

    // Cap memory: drop oldest, keep lineNumbers absolute.
    if (this.lines.length > this.maxLines) {
      const drop = this.lines.length - this.maxLines;
      this.lines.splice(0, drop);
      this.baseLine += drop;
    }

    this.dom.count.textContent = this.total.toLocaleString();
    const last = this.lines[this.lines.length - 1];
    if (last) this.dom.latest.textContent = fmtTime(last.ts);

    this.applyFilter(stickToBottom);
  }

  // ---- filtering -----------------------------------------------------------

  setLocalFilter(v) {
    this.localFilter = v;
    this.dom.filter.value = v;
    this.applyFilter();
  }

  #matches(ln) {
    const g = this.opts.globalFilterState?.();
    // global filter
    if (g && g.text) {
      if (!testFilter(ln, g.text, g.regex)) return false;
    }
    if (g && g.onlyHighlighted && !ln._hit) return false;
    // local filter (always plain-contains, case-insensitive)
    if (this.localFilter) {
      const hay = (ln.message + ' ' + ln.level).toLowerCase();
      if (!hay.includes(this.localFilter.toLowerCase())) return false;
    }
    return true;
  }

  applyFilter(stick = true) {
    // Pre-compute highlight hits so "only highlighted" + summary work.
    for (const ln of this.lines) {
      const dec = this.highlighter.decorate(ln.message);
      ln._html = dec.html;
      ln._hit = dec.hit;
    }
    this.filtered = [];
    for (let i = 0; i < this.lines.length; i++) {
      if (this.#matches(this.lines[i])) this.filtered.push(i);
    }
    this.render(stick);
    this.opts.onStatus?.('up');
  }

  // ---- virtual scroll render ----------------------------------------------

  #isNearBottom() {
    const v = this.dom.viewport;
    return v.scrollTop + v.clientHeight >= v.scrollHeight - ROW_H * 3;
  }

  render(stick = false) {
    const v = this.dom.viewport;
    const n = this.filtered.length;
    const totalH = n * ROW_H;

    if (stick) {
      // defer scroll to bottom until after spacer sizing
      this.dom.bottom.style.height = '0px';
      this.dom.top.style.height = totalH + 'px';
    }

    const scrollTop = stick ? totalH : v.scrollTop;
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const visibleCount = Math.ceil(v.clientHeight / ROW_H) + OVERSCAN * 2;
    const last = Math.min(n, first + visibleCount);

    this.dom.top.style.height = first * ROW_H + 'px';
    this.dom.bottom.style.height = Math.max(0, (n - last) * ROW_H) + 'px';

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      frag.appendChild(this.#rowEl(this.lines[this.filtered[i]], i));
    }
    this.dom.rows.replaceChildren(frag);

    if (stick) v.scrollTop = v.scrollHeight;
  }

  #rowEl(ln, filteredIdx) {
    const row = document.createElement('div');
    row.className = `row ${levelClass(ln.level)}`;
    if (this.selected.has(ln.lineNumber)) row.classList.add('is-selected');
    if (this.expanded.has(ln.lineNumber)) row.classList.add('is-expanded');
    row.dataset.line = ln.lineNumber;
    row.dataset.fidx = filteredIdx;

    const gutter = document.createElement('span');
    gutter.className = 'row__gutter';
    gutter.textContent = ln.lineNumber;
    gutter.title = 'Click to select · ⇧ range · ⌘/Ctrl multi';

    const time = document.createElement('span');
    time.className = 'row__time';
    time.textContent = fmtTime(ln.ts);
    time.title = ln.ts;

    const lvl = document.createElement('span');
    lvl.className = 'row__lvl';
    lvl.textContent = ln.level;

    const msg = document.createElement('span');
    msg.className = 'row__msg';
    msg.innerHTML = ln._html ?? ln.message;

    row.append(gutter, time, lvl, msg);

    if (this.expanded.has(ln.lineNumber)) {
      const pre = document.createElement('pre');
      pre.className = 'row__raw';
      pre.textContent = JSON.stringify(ln.raw, null, 2);
      row.appendChild(pre);
    }
    return row;
  }

  // ---- interactions --------------------------------------------------------

  #onRowClick(e) {
    const row = e.target.closest('.row');
    if (!row) return;
    const line = Number(row.dataset.line);
    const fidx = Number(row.dataset.fidx);

    if (e.target.closest('.row__gutter')) {
      this.#select(line, fidx, e);
      return;
    }
    // body click toggles expand
    if (this.expanded.has(line)) this.expanded.delete(line);
    else this.expanded.add(line);
    this.render();
  }

  #select(line, fidx, e) {
    if (e.shiftKey && this.lastClickIdx != null) {
      const [a, b] = [this.lastClickIdx, fidx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) this.selected.add(this.lines[this.filtered[i]].lineNumber);
    } else if (e.metaKey || e.ctrlKey) {
      this.selected.has(line) ? this.selected.delete(line) : this.selected.add(line);
      this.lastClickIdx = fidx;
    } else {
      this.selected.clear();
      this.selected.add(line);
      this.lastClickIdx = fidx;
    }
    this.opts.onSelectionChange?.();
    this.render();
  }

  #onRowContext(e) {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    const line = Number(row.dataset.line);
    const ln = this.lines.find((l) => l.lineNumber === line);
    if (!ln) return;
    // selected token under cursor (a highlighted mark) for filter-by-value
    const mark = e.target.closest('.hl');
    const value = mark ? mark.textContent : null;
    this.opts.onContext?.({ viewer: this, line: ln, value, x: e.clientX, y: e.clientY });
  }

  async #promptJump() {
    const max = this.total;
    const input = prompt(`Jump to absolute line # (1–${max}):`);
    if (!input) return;
    const target = parseInt(input, 10);
    if (!Number.isFinite(target)) return;
    await this.jumpToLine(target);
  }

  /** Load a window around an absolute line number and scroll to it. */
  async jumpToLine(target) {
    const half = 250;
    const start = Math.max(1, target - half);
    const end = target + half;
    try {
      const res = await fetch(
        `/api/logs/${encodeURIComponent(this.sourceId)}/range?start=${start}&end=${end}`
      );
      const d = await res.json();
      this.paused = true;
      this.opts.onPausedExternally?.();
      this.lines = d.lines.map((l) => ({ ...l }));
      this.baseLine = d.lines[0]?.lineNumber || start;
      this.applyFilter(false);
      // scroll so target row sits mid-viewport
      const fidx = this.filtered.findIndex(
        (i) => this.lines[i].lineNumber === target
      );
      if (fidx >= 0) {
        this.dom.viewport.scrollTop = Math.max(0, fidx * ROW_H - this.dom.viewport.clientHeight / 2);
        this.render();
        this.#flash(target);
      }
    } catch (err) {
      this.opts.toast?.(`Jump failed: ${err.message}`, 'err');
    }
  }

  #flash(line) {
    requestAnimationFrame(() => {
      const row = this.dom.rows.querySelector(`.row[data-line="${line}"]`);
      if (row) {
        row.classList.add('is-flash');
        setTimeout(() => row.classList.remove('is-flash'), 1500);
      }
    });
  }

  // ---- accessors for app.js -----------------------------------------------

  visibleLines() {
    return this.filtered.map((i) => this.lines[i]);
  }
  selectedLines() {
    return this.lines.filter((l) => this.selected.has(l.lineNumber));
  }
  highlightedLines() {
    return this.lines.filter((l) => l._hit);
  }
  selectionCount() {
    return this.selected.size;
  }
  clear() {
    this.lines = [];
    this.filtered = [];
    this.selected.clear();
    this.expanded.clear();
    this.render();
    this.dom.count.textContent = '0';
  }
  takeRate() {
    const now = performance.now();
    const dt = (now - this.rate.ts) / 1000;
    const r = dt > 0 ? this.rate.count / dt : 0;
    this.rate = { count: 0, ts: now };
    return r;
  }
  destroy() {
    this.disconnect();
    this.el.remove();
  }
}

// ---- helpers ---------------------------------------------------------------

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function testFilter(ln, text, isRegex) {
  const hay = `${ln.message} ${ln.level} ${ln.lineNumber}`;
  if (isRegex) {
    try {
      return new RegExp(text, 'i').test(hay);
    } catch {
      return true; // invalid regex — don't hide everything
    }
  }
  return hay.toLowerCase().includes(text.toLowerCase());
}
