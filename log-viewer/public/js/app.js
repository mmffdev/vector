// app.js — orchestrator for the Vector Log Viewer.
//
// Responsibilities:
//   * boot: fetch /api/logs, build panels, restore layout/prefs
//   * panels + layout: split-screen, resize handles, add/close, layout cycle
//   * global controls: tail play/pause, clear, export scope, global filter
//   * cross-references: [source:line] index by correlation key, jump + history
//   * dashboard: per-source stats + simple charts
//   * status bar: rate, totals, selection, memory
//   * notifications: toast + browser + flash on CRITICAL/ERROR

import { LogViewer } from './logViewer.js';
import { HighlightEngine } from './highlightEngine.js';
import { exportLines, copyText } from './exportManager.js';

const LS_PREFS = 'vlv.prefs.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  sources: [],
  panels: [], // LogViewer instances
  layout: 'auto', // auto | horizontal | vertical | single
  tailing: true,
  global: { text: '', regex: false, onlyHighlighted: false },
  refHistory: [], // {source, line}
  refIndex: -1,
  correlation: new Map(), // correlationValue -> [{source, line}]
  notify: { sound: false, browser: false },
};

const highlighter = new HighlightEngine();

// ── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  const res = await fetch('/api/logs');
  const data = await res.json();
  state.sources = data.sources = data.logs;
  state.maxLines = data.config.maxLinesInMemory;

  restorePrefs();
  buildPanelsForLayout();
  wireControls();
  wireHighlightDrawer();
  startStatusLoop();
  refreshHighlightSummary();
}

// ── panels + layout ──────────────────────────────────────────────────────────

function panelOpts() {
  return {
    sources: state.sources,
    maxLines: state.maxLines,
    highlighter,
    globalFilterState: () => state.global,
    onStatus: setConn,
    onClose: closePanel,
    onContext: openContextMenu,
    onSelectionChange: updateStatus,
    onLine: onIncomingLine,
    onPausedExternally: () => setTailing(false),
    toast,
  };
}

function makePanel(sourceId) {
  const tpl = $('#panel-tpl').content.firstElementChild.cloneNode(true);
  $('#tail-view').appendChild(tpl);
  const v = new LogViewer(tpl, panelOpts());
  v.connect(sourceId);
  state.panels.push(v);
  return v;
}

function buildPanelsForLayout() {
  // tear down
  state.panels.forEach((p) => p.destroy());
  state.panels = [];
  $('#tail-view').replaceChildren();

  const stage = $('#tail-view');
  stage.className = `stage stage--${effectiveLayout()}`;

  const ids = state.sources.map((s) => s.id);
  if (state.layout === 'single') {
    makePanel(ids[0]);
  } else {
    // one panel per source by default (2 sources → side-by-side)
    ids.forEach((id) => makePanel(id));
    insertResizers();
  }
  updateStatus();
}

function effectiveLayout() {
  if (state.layout !== 'auto') return state.layout;
  return state.sources.length <= 2 ? 'horizontal' : 'vertical';
}

function insertResizers() {
  const stage = $('#tail-view');
  const panels = $$('.panel', stage);
  for (let i = 0; i < panels.length - 1; i++) {
    const handle = document.createElement('div');
    handle.className = 'resizer';
    panels[i].after(handle);
    makeResizable(handle, panels[i], panels[i + 1]);
  }
}

function makeResizable(handle, a, b) {
  const horizontal = effectiveLayout() === 'horizontal';
  let startPos, startA, startB;
  const onDown = (e) => {
    startPos = horizontal ? e.clientX : e.clientY;
    startA = horizontal ? a.offsetWidth : a.offsetHeight;
    startB = horizontal ? b.offsetWidth : b.offsetHeight;
    document.body.classList.add('is-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  const onMove = (e) => {
    const delta = (horizontal ? e.clientX : e.clientY) - startPos;
    const aSize = startA + delta;
    const bSize = startB - delta;
    if (aSize < 120 || bSize < 120) return;
    a.style.flex = `0 0 ${aSize}px`;
    b.style.flex = `0 0 ${bSize}px`;
    state.panels.forEach((p) => p.render());
  };
  const onUp = () => {
    document.body.classList.remove('is-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  handle.addEventListener('mousedown', onDown);
}

function closePanel(viewer) {
  if (state.panels.length <= 1) {
    toast('At least one panel must stay open.', 'warn');
    return;
  }
  viewer.destroy();
  state.panels = state.panels.filter((p) => p !== viewer);
  $$('.resizer').forEach((r) => r.remove());
  insertResizers();
  updateStatus();
}

function cycleLayout() {
  const order = ['auto', 'horizontal', 'vertical', 'single'];
  state.layout = order[(order.indexOf(state.layout) + 1) % order.length];
  savePrefs();
  buildPanelsForLayout();
  toast(`Layout: ${state.layout}`, 'ok');
}

// ── global controls ──────────────────────────────────────────────────────────

function wireControls() {
  $('#btn-tail').addEventListener('click', () => setTailing(!state.tailing));
  $('#btn-clear').addEventListener('click', () => {
    state.panels.forEach((p) => p.clear());
    toast('Cleared all panels.', 'ok');
  });
  $('#btn-layout').addEventListener('click', cycleLayout);
  $('#btn-view').addEventListener('click', toggleDashboard);

  // export menu
  const menu = $('#export-menu');
  $('#btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    positionUnder(menu, e.currentTarget);
  });
  $$('#export-menu button').forEach((b) =>
    b.addEventListener('click', () => {
      menu.hidden = true;
      doExport(b.dataset.scope, b.dataset.format);
    })
  );
  document.addEventListener('click', () => (menu.hidden = true));

  // global filter
  const gf = $('#global-filter');
  gf.addEventListener('input', () => {
    let text = gf.value;
    let regex = $('#global-regex').checked;
    // /pattern/ shorthand toggles regex
    if (/^\/.*\/$/.test(text)) {
      regex = true;
      text = text.slice(1, -1);
    }
    state.global.text = text;
    state.global.regex = regex;
    refilterAll();
    updateStatus();
  });
  $('#global-regex').addEventListener('change', refilterAll);
  $('#only-highlighted').addEventListener('change', (e) => {
    state.global.onlyHighlighted = e.target.checked;
    refilterAll();
  });

  // reference history nav
  $('#ref-back').addEventListener('click', () => navRef(-1));
  $('#ref-fwd').addEventListener('click', () => navRef(1));

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      setTailing(!state.tailing);
    } else if (e.key === 'n') jumpHighlight(1);
    else if (e.key === 'p') jumpHighlight(-1);
  });
}

function setTailing(on) {
  state.tailing = on;
  $('#btn-tail').classList.toggle('is-active', on);
  $('#btn-tail').innerHTML = on
    ? '<span class="dot dot--live"></span> Tailing'
    : '<span class="dot"></span> Paused';
  $('#st-tail').textContent = on ? '● Active' : '⏸ Paused';
  state.panels.forEach((p) => p.setPaused(!on));
}

function refilterAll() {
  state.panels.forEach((p) => p.applyFilter(false));
  refreshHighlightSummary();
  updateStatus();
}

// ── export scope ─────────────────────────────────────────────────────────────

function doExport(scope, format) {
  // Operate on the focused panel if there's a selection anywhere; else merge.
  const withSel = state.panels.find((p) => p.selectionCount() > 0);
  const panel = scope === 'selected' && withSel ? withSel : state.panels[0];

  let lines;
  if (scope === 'selected') lines = state.panels.flatMap((p) => p.selectedLines());
  else if (scope === 'highlighted') lines = state.panels.flatMap((p) => p.highlightedLines());
  else lines = panel.visibleLines();

  exportLines({ lines, format, source: panel?.sourceId || 'logs', toast });
}

// ── cross-references ─────────────────────────────────────────────────────────

function onIncomingLine(viewer, ln) {
  // index by correlation value for cross-panel jump
  if (ln.correlation != null) {
    const key = String(ln.correlation);
    if (!state.correlation.has(key)) state.correlation.set(key, []);
    const arr = state.correlation.get(key);
    arr.push({ source: viewer.sourceId, line: ln.lineNumber });
    if (arr.length > 200) arr.shift();
  }
  maybeNotify(viewer, ln);
}

function pushRef(source, line) {
  // truncate forward history
  state.refHistory = state.refHistory.slice(0, state.refIndex + 1);
  state.refHistory.push({ source, line });
  state.refIndex = state.refHistory.length - 1;
  renderRefNav();
}

async function jumpToRef(source, line, record = true) {
  const panel =
    state.panels.find((p) => p.sourceId === source) || state.panels[0];
  if (panel.sourceId !== source) panel.connect(source);
  await panel.jumpToLine(line);
  if (record) pushRef(source, line);
  panel.el.scrollIntoView({ block: 'nearest' });
}

function navRef(dir) {
  const next = state.refIndex + dir;
  if (next < 0 || next >= state.refHistory.length) return;
  state.refIndex = next;
  const r = state.refHistory[next];
  jumpToRef(r.source, r.line, false);
  renderRefNav();
}

function renderRefNav() {
  const r = state.refHistory[state.refIndex];
  $('#ref-label').textContent = r ? `${r.source}:${r.line}` : 'no jumps';
  $('#ref-back').disabled = state.refIndex <= 0;
  $('#ref-fwd').disabled = state.refIndex >= state.refHistory.length - 1;
}

// ── context menu ─────────────────────────────────────────────────────────────

function openContextMenu({ viewer, line, value, x, y }) {
  const menu = $('#ctx-menu');
  const ref = `[${viewer.sourceId}:${line.lineNumber}]`;
  const header = `${line.lineNumber}\t${line.ts ?? ''}\t${line.level ?? ''}\t${line.message ?? ''}`;
  const json = line.raw != null ? JSON.stringify(line.raw, null, 2) : '(no raw payload)';
  const items = [
    { label: 'Copy line + JSON', fn: () => copyText(`${header}\n${json}`, toast, `line ${line.lineNumber} + JSON`) },
    { label: 'Copy line only', fn: () => copyText(header, toast, 'line') },
    { label: 'Copy raw JSON', fn: () => copyText(json, toast, 'raw row') },
    { label: `Copy reference ${ref}`, fn: () => copyText(ref, toast, 'reference') },
    { label: 'Copy with context (±5)', fn: () => copyWithContext(viewer, line) },
    { sep: true },
  ];
  if (value) {
    items.push({ label: `Filter by “${truncate(value)}”`, fn: () => applyGlobal(value) });
    items.push({ label: `Exclude “${truncate(value)}”`, fn: () => applyGlobal(`^(?!.*${escapeReg(value)}).*$`, true) });
    items.push({ label: `Highlight similar`, fn: () => { highlighter.addCustom(escapeReg(value), '#f472b6'); refilterAll(); } });
    items.push({ sep: true });
  }
  // correlated entries in other panels
  const corr = line.correlation != null ? state.correlation.get(String(line.correlation)) : null;
  if (corr && corr.length > 1) {
    const others = corr.filter((c) => !(c.source === viewer.sourceId && c.line === line.lineNumber));
    items.push({ label: `Correlated entries (${others.length})`, header: true });
    others.slice(-6).forEach((c) =>
      items.push({ label: `↪ ${c.source}:${c.line}`, fn: () => jumpToRef(c.source, c.line) })
    );
  }

  menu.replaceChildren();
  for (const it of items) {
    if (it.sep) { menu.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.header) { b.className = 'menu__header'; b.disabled = true; }
    else b.addEventListener('click', () => { menu.hidden = true; it.fn(); });
    menu.appendChild(b);
  }
  menu.hidden = false;
  menu.style.left = Math.min(x, innerWidth - 260) + 'px';
  menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 10) + 'px';
  const close = () => { menu.hidden = true; document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function copyWithContext(viewer, line) {
  const lo = line.lineNumber - 5;
  const hi = line.lineNumber + 5;
  try {
    const res = await fetch(`/api/logs/${viewer.sourceId}/range?start=${lo}&end=${hi}`);
    const d = await res.json();
    const text = d.lines.map((l) => `${l.lineNumber}\t${l.ts}\t${l.level}\t${l.message}`).join('\n');
    await copyText(text, toast, `${d.lines.length} lines with context`);
  } catch (err) {
    toast(`Context copy failed: ${err.message}`, 'err');
  }
}

function applyGlobal(text, regex = false) {
  state.global.text = text;
  state.global.regex = regex;
  $('#global-filter').value = regex ? `/${text}/` : text;
  $('#global-regex').checked = regex;
  refilterAll();
}

// ── highlight drawer ─────────────────────────────────────────────────────────

function wireHighlightDrawer() {
  const drawer = $('#highlights-drawer');
  $('#btn-highlights').addEventListener('click', () => { drawer.hidden = !drawer.hidden; renderHlList(); });
  $('#hl-close').addEventListener('click', () => (drawer.hidden = true));
  $('#hl-add').addEventListener('click', () => {
    const pat = $('#hl-pattern').value.trim();
    if (!pat) return;
    try {
      highlighter.addCustom(pat, $('#hl-color').value);
      $('#hl-pattern').value = '';
      refilterAll();
      renderHlList();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
  highlighter.onChange(() => { renderHlList(); refreshHighlightSummary(); });
}

function renderHlList() {
  const host = $('#hl-list');
  host.replaceChildren();
  for (const r of highlighter.rules()) {
    const row = document.createElement('div');
    row.className = 'hl-row';
    row.innerHTML = `
      <span class="hl-swatch" style="background:${r.color}"></span>
      <code class="hl-label">${escapeHtmlInline(r.label)}</code>
      <span class="hl-count muted">${highlighter.countFor(r.id)}</span>`;
    if (!r.builtin) {
      const del = document.createElement('button');
      del.className = 'linkbtn';
      del.textContent = '✕';
      del.addEventListener('click', () => { highlighter.removeCustom(r.id); refilterAll(); });
      row.appendChild(del);
    } else {
      const tag = document.createElement('span');
      tag.className = 'muted';
      tag.textContent = 'built-in';
      row.appendChild(tag);
    }
    host.appendChild(row);
  }
}

function refreshHighlightSummary() {
  highlighter.resetCounts();
  state.panels.forEach((p) => p.visibleLines().forEach((l) => highlighter.decorate(l.message)));
  const custom = highlighter.rules().filter((r) => !r.builtin);
  const parts = custom.map((r) => `${r.label}: ${highlighter.countFor(r.id)}`);
  $('#hl-summary').textContent = parts.length ? parts.join(' · ') : 'no custom matches';
}

function jumpHighlight(dir) {
  const panel = state.panels[0];
  if (!panel) return;
  const hits = panel.visibleLines().filter((l) => l._hit);
  if (!hits.length) { toast('No highlighted lines in view.', 'warn'); return; }
  panel._hlIdx = ((panel._hlIdx ?? -1) + dir + hits.length) % hits.length;
  panel.jumpToLine(hits[panel._hlIdx].lineNumber);
}

// ── dashboard ────────────────────────────────────────────────────────────────

async function toggleDashboard() {
  const dash = $('#dashboard-view');
  const tail = $('#tail-view');
  const showing = dash.hidden;
  dash.hidden = !showing;
  tail.hidden = showing;
  $('#btn-view').classList.toggle('is-active', showing);
  if (showing) {
    // Dashboard takes the screen — drop the live tail streams so the server
    // stops polling the DB for panels nobody is watching. Reconnect on return.
    state.panels.forEach((p) => p.disconnect());
    await renderDashboard();
  } else {
    // Back to the tail. Only re-open streams if we're actually tailing; if the
    // user paused, leave them closed (pause already stopped the poll loops).
    if (state.tailing) state.panels.forEach((p) => p.connect(p.sourceId));
  }
}

async function renderDashboard() {
  const dash = $('#dashboard-view');
  dash.innerHTML = '<div class="muted dash-loading">Loading stats…</div>';
  try {
    const res = await fetch('/api/stats');
    const { sources } = await res.json();
    dash.replaceChildren();
    for (const s of sources) dash.appendChild(statCard(s));
  } catch (err) {
    dash.innerHTML = `<div class="toast toast--err">Stats failed: ${escapeHtmlInline(err.message)}</div>`;
  }
}

function statCard(s) {
  const card = document.createElement('div');
  card.className = 'card';
  const maxVol = Math.max(1, ...s.volume.map((v) => v.n));
  const bars = s.volume
    .map((v) => `<div class="bar" style="height:${(v.n / maxVol) * 100}%" title="${new Date(v.bucket).toLocaleString()} — ${v.n}"></div>`)
    .join('');
  const top = s.topPatterns
    .map((p) => {
      const w = (p.n / s.topPatterns[0].n) * 100;
      return `<div class="toprow"><span class="toprow__bar" style="width:${w}%"></span><code>${escapeHtmlInline(p.pattern)}</code><b>${p.n.toLocaleString()}</b></div>`;
    })
    .join('');
  card.innerHTML = `
    <header class="card__head"><h3>${escapeHtmlInline(s.name)}</h3>
      <span class="muted">${s.total.toLocaleString()} rows · latest ${s.latest ? new Date(s.latest).toLocaleString() : '—'}</span>
    </header>
    <div class="card__chart"><div class="chart-label muted">volume / hour (24h)</div><div class="chart">${bars || '<span class="muted">no rows in last 24h</span>'}</div></div>
    <div class="card__top"><div class="chart-label muted">top patterns</div>${top || '<span class="muted">n/a</span>'}</div>`;
  return card;
}

// ── notifications ────────────────────────────────────────────────────────────

function maybeNotify(viewer, ln) {
  if (ln.level !== 'CRITICAL' && ln.level !== 'ERROR') return;
  toast(`${ln.level} in ${viewer.sourceId}: ${truncate(ln.message, 80)}`, ln.level === 'CRITICAL' ? 'err' : 'warn');
  if (state.notify.browser && Notification?.permission === 'granted') {
    new Notification(`Vector ${ln.level}`, { body: ln.message.slice(0, 120) });
  }
}

function toast(msg, kind = 'ok') {
  const host = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast toast--${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add('is-out'), 3200);
  setTimeout(() => t.remove(), 3600);
}

// ── status bar ───────────────────────────────────────────────────────────────

function startStatusLoop() {
  setInterval(() => {
    const rate = state.panels.reduce((a, p) => a + p.takeRate(), 0);
    $('#st-rate').textContent = `${rate.toFixed(1)} lines/s`;
    updateStatus();
  }, 1000);
}

function updateStatus() {
  const total = state.panels.reduce((a, p) => a + p.total, 0);
  const mem = state.panels.reduce((a, p) => a + p.lines.length, 0);
  const sel = state.panels.reduce((a, p) => a + p.selectionCount(), 0);
  const filters = (state.global.text ? 1 : 0) + (state.global.onlyHighlighted ? 1 : 0);
  $('#st-total').textContent = `${total.toLocaleString()} lines`;
  $('#st-mem').textContent = `${mem.toLocaleString()} in memory`;
  $('#st-selected').textContent = `${sel} selected`;
  $('#st-filter').textContent = `${filters} filter${filters === 1 ? '' : 's'}`;
  $('#last-update').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function setConn(status) {
  const el = $('#conn');
  const up = status === 'up';
  el.className = `conn ${up ? 'conn--up' : 'conn--down'}`;
  $('.conn__txt', el).textContent = up ? 'live' : 'reconnecting…';
}

// ── prefs ────────────────────────────────────────────────────────────────────

function savePrefs() {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify({ layout: state.layout, notify: state.notify }));
  } catch {}
}
function restorePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREFS) || '{}');
    if (p.layout) state.layout = p.layout;
    if (p.notify) state.notify = p.notify;
  } catch {}
  // ask for browser-notification permission lazily on first ERROR is nicer,
  // but offer it up-front if the user previously opted in.
  if (state.notify.browser && Notification?.permission === 'default') Notification.requestPermission();
}

// ── small utils ──────────────────────────────────────────────────────────────

function positionUnder(menu, btn) {
  const r = btn.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = r.bottom + 4 + 'px';
}
function truncate(s, n = 40) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeHtmlInline(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

boot().catch((err) => {
  document.body.innerHTML = `<pre style="color:#f87171;padding:24px;font:14px monospace">Boot failed: ${err.message}\n\nIs the server running and the DB tunnel up?</pre>`;
});
