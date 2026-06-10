const STYLE_KEY = 'vector-log-console-style-rules-v1';
const ALL_LEVELS = ['ERROR', 'WARN', 'SUCCESS', 'INFO', 'DEBUG'];

const state = {
  sources: [],
  sourceMap: new Map(),
  activeSource: '',
  stats: new Map(),
  lines: [],
  facets: {},
  histogram: [],
  filters: [],
  activeLevels: new Set(ALL_LEVELS),
  live: true,
  eventSource: null,
  reloadVersion: 0,
  streamVersion: 0,
  selected: null,
  detailTab: 'summary',
  styleRules: [],
};

const $ = (id) => document.getElementById(id);

const dom = {
  healthSummary: $('health-summary'),
  sourceCount: $('source-count'),
  sourceList: $('source-list'),
  facetList: $('facet-list'),
  activeGroup: $('active-source-group'),
  activeName: $('active-source-name'),
  activeDescription: $('active-source-description'),
  statTotal: $('stat-total'),
  statShown: $('stat-shown'),
  statLatest: $('stat-latest'),
  queryInput: $('query-input'),
  regexToggle: $('regex-toggle'),
  timeRange: $('time-range'),
  limitSelect: $('limit-select'),
  filterChips: $('filter-chips'),
  timelineChart: $('timeline-chart'),
  rows: $('log-rows'),
  liveToggle: $('live-toggle'),
  refreshButton: $('refresh-button'),
  clearFilters: $('clear-filters'),
  exportButton: $('export-button'),
  styleButton: $('style-button'),
  detailDrawer: $('detail-drawer'),
  detailTitle: $('detail-title'),
  detailBody: $('detail-body'),
  detailClose: $('detail-close'),
  styleDrawer: $('style-drawer'),
  styleClose: $('style-close'),
  styleForm: $('style-form'),
  ruleSource: $('rule-source'),
  ruleField: $('rule-field'),
  ruleName: $('rule-name'),
  ruleOp: $('rule-op'),
  ruleValue: $('rule-value'),
  ruleInk: $('rule-ink'),
  ruleBg: $('rule-bg'),
  styleRules: $('style-rules'),
  toastHost: $('toast-host'),
};

function fmtNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function fmtTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function timeRangeStart(value) {
  if (!value) return '';
  const match = /^(\d+)(m|h|d)$/.exec(value);
  if (!match) return '';
  const amount = Number(match[1]);
  const unit = match[2];
  const ms = unit === 'm' ? amount * 60_000 : unit === 'h' ? amount * 3_600_000 : amount * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'log-console__toast';
  el.textContent = message;
  if (kind === 'error') el.style.borderColor = 'var(--console-red)';
  if (kind === 'ok') el.style.borderColor = 'var(--console-green)';
  dom.toastHost.append(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return res.json();
}

function source() {
  return state.sourceMap.get(state.activeSource);
}

function selectedLevelsParam() {
  if (state.activeLevels.size === ALL_LEVELS.length) return '';
  return [...state.activeLevels].join(',');
}

function queryParams(extra = {}) {
  const params = new URLSearchParams();
  params.set('limit', dom.limitSelect.value || '500');
  if (dom.queryInput.value.trim()) params.set('q', dom.queryInput.value.trim());
  if (dom.regexToggle.checked) params.set('regex', '1');
  const from = timeRangeStart(dom.timeRange.value);
  if (from) params.set('from', from);
  const levels = selectedLevelsParam();
  if (levels) params.set('levels', levels);
  if (state.filters.length) params.set('filters', JSON.stringify(state.filters));
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  return params;
}

function lineKey(line) {
  return `${line.source || state.activeSource}:${line.id || line.orderValue || line.ts || line.message}`;
}

function uniqueLines(lines) {
  const seen = new Set();
  return (lines || []).filter((line) => {
    const key = lineKey(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function saveStyleRules() {
  localStorage.setItem(STYLE_KEY, JSON.stringify(state.styleRules));
}

function loadStyleRules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STYLE_KEY) || '[]');
    state.styleRules = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.styleRules = [];
  }
}

function matchRule(line, rule) {
  if (!rule.enabled) return false;
  if (rule.source !== '*' && rule.source !== line.source) return false;

  const value =
    rule.field === 'message'
      ? line.message
      : line.raw?.[rule.field] ?? line.correlations?.[rule.field] ?? '';
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (rule.op === 'exists') return text !== '';
  if (rule.op === 'eq') return text === rule.value;
  if (rule.op === 'regex') {
    try {
      return new RegExp(rule.value, 'i').test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(String(rule.value || '').toLowerCase());
}

function styleForLine(line) {
  return state.styleRules.find((rule) => matchRule(line, rule)) || null;
}

function renderSources() {
  const groups = new Map();
  for (const src of state.sources) {
    if (!groups.has(src.group)) groups.set(src.group, []);
    groups.get(src.group).push(src);
  }

  dom.sourceList.replaceChildren();
  for (const [group, sources] of groups.entries()) {
    const head = document.createElement('div');
    head.className = 'log-console__section-head';
    head.textContent = group;
    dom.sourceList.append(head);

    for (const src of sources) {
      const stat = state.stats.get(src.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn btn--ghost log-console__source${src.id === state.activeSource ? ' is-active' : ''}`;
      button.style.setProperty('--source-color', src.color);
      button.addEventListener('click', () => {
        state.activeSource = src.id;
        state.filters = [];
        state.selected = null;
        renderSourceHeader();
        renderSources();
        renderDetail();
        syncRuleForm();
        reload();
      });

      const swatch = document.createElement('span');
      swatch.className = 'log-console__source-swatch';
      const name = document.createElement('span');
      name.className = 'log-console__source-name';
      name.textContent = src.name;
      const meta = document.createElement('span');
      meta.className = 'log-console__source-meta';
      meta.textContent = stat ? fmtNumber(stat.total) : '-';
      button.append(swatch, name, meta);
      dom.sourceList.append(button);
    }
  }
  dom.sourceCount.textContent = String(state.sources.length);
}

function renderSourceHeader() {
  const src = source();
  if (!src) return;
  const stat = state.stats.get(src.id);
  dom.activeGroup.textContent = src.group;
  dom.activeName.textContent = src.name;
  dom.activeDescription.textContent = src.description || `${src.db}.${src.table}`;
  dom.statTotal.textContent = stat ? fmtNumber(stat.total) : '-';
  dom.statShown.textContent = fmtNumber(state.lines.length);
  dom.statLatest.textContent = stat?.latest ? fmtTime(stat.latest) : '-';
}

function renderFilterChips() {
  dom.filterChips.replaceChildren();
  if (!state.filters.length) {
    const empty = document.createElement('span');
    empty.className = 'log-console__subtle';
    empty.textContent = 'No facet filters';
    dom.filterChips.append(empty);
    return;
  }

  state.filters.forEach((filter, index) => {
    const chip = document.createElement('span');
    chip.className = 'log-console__chip';
    const strong = document.createElement('strong');
    strong.textContent = `${filter.field} ${filter.op} ${filter.value ?? ''}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--icon btn--micro btn--ghost';
    remove.textContent = 'x';
    remove.addEventListener('click', () => {
      state.filters.splice(index, 1);
      reload();
    });
    chip.append(strong, remove);
    dom.filterChips.append(chip);
  });
}

function renderTimeline() {
  dom.timelineChart.replaceChildren();
  const max = Math.max(1, ...state.histogram.map((row) => Number(row.n || 0)));
  if (!state.histogram.length) {
    const empty = document.createElement('div');
    empty.className = 'log-console__empty';
    empty.textContent = 'No timeline buckets';
    dom.timelineChart.append(empty);
    return;
  }
  for (const bucket of state.histogram.slice(-80)) {
    const bar = document.createElement('div');
    bar.className = 'log-console__bar';
    bar.style.height = `${Math.max(4, (Number(bucket.n || 0) / max) * 100)}%`;
    bar.title = `${fmtTime(bucket.bucket)}: ${bucket.n}`;
    dom.timelineChart.append(bar);
  }
}

function renderFacets() {
  dom.facetList.replaceChildren();
  const entries = Object.entries(state.facets || {});
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'log-console__empty';
    empty.textContent = 'No facets for this source';
    dom.facetList.append(empty);
    return;
  }

  for (const [field, facet] of entries) {
    const box = document.createElement('section');
    box.className = 'log-console__facet';
    const title = document.createElement('div');
    title.className = 'log-console__facet-title';
    title.textContent = facet.label || field;
    box.append(title);

    for (const item of (facet.values || []).slice(0, 8)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost log-console__facet-option';
      button.addEventListener('click', () => {
        state.filters.push({ field, op: 'eq', value: String(item.value) });
        reload();
      });
      const value = document.createElement('span');
      value.textContent = String(item.value);
      const count = document.createElement('strong');
      count.textContent = fmtNumber(item.n);
      button.append(value, count);
      box.append(button);
    }
    dom.facetList.append(box);
  }
}

function renderRows() {
  dom.rows.replaceChildren();
  dom.statShown.textContent = fmtNumber(state.lines.length);
  if (!state.lines.length) {
    const stat = state.stats.get(state.activeSource);
    const hasAnyRows = Number(stat?.total || 0) > 0;
    const hasTimeWindow = Boolean(dom.timeRange.value);
    const hasSearchOrFacet = Boolean(dom.queryInput.value.trim() || state.filters.length);
    const empty = document.createElement('div');
    empty.className = 'log-console__empty';
    const message = document.createElement('span');
    message.textContent =
      hasAnyRows && hasTimeWindow
        ? 'No rows in the selected time window'
        : hasAnyRows && hasSearchOrFacet
          ? 'No rows match the current filters'
          : 'No rows available for this source';
    empty.append(message);

    if (hasAnyRows && hasTimeWindow) {
      const showAll = document.createElement('button');
      showAll.className = 'btn btn--primary btn--sm';
      showAll.type = 'button';
      showAll.setAttribute('aria-label', 'Show rows from all time');
      showAll.textContent = 'Show all time';
      showAll.addEventListener('click', () => {
        dom.timeRange.value = '';
        reload();
      });
      empty.append(showAll);
    } else if (hasAnyRows && hasSearchOrFacet) {
      const clear = document.createElement('button');
      clear.className = 'btn btn--ghost btn--sm';
      clear.type = 'button';
      clear.setAttribute('aria-label', 'Clear search and facet filters');
      clear.textContent = 'Clear filters';
      clear.addEventListener('click', () => {
        state.filters = [];
        dom.queryInput.value = '';
        reload();
      });
      empty.append(clear);
    }

    dom.rows.append(empty);
    return;
  }

  for (const line of state.lines) {
    const row = document.createElement('article');
    const level = String(line.level || 'INFO').toLowerCase();
    row.className = `log-row log-row--${level}${state.selected?.id === line.id ? ' is-selected' : ''}`;
    row.role = 'listitem';
    const rule = styleForLine(line);
    if (rule) {
      row.style.setProperty('--row-ink', rule.ink);
      row.style.setProperty('--row-bg', rule.bg);
      row.title = `Styled by rule: ${rule.name}`;
    }
    row.addEventListener('click', () => selectLine(line));

    const time = document.createElement('span');
    time.className = 'log-row__time';
    time.textContent = fmtTime(line.ts);
    const lvl = document.createElement('span');
    lvl.className = 'log-row__level';
    lvl.textContent = line.level || 'INFO';
    const message = document.createElement('span');
    message.className = 'log-row__message';
    message.textContent = line.message;
    const src = document.createElement('span');
    src.className = 'log-row__source';
    src.textContent = line.sourceName || line.source;

    row.append(time, lvl, message, src);
    dom.rows.append(row);
  }
}

function renderDetail() {
  const line = state.selected;
  if (!line) {
    dom.detailDrawer.hidden = true;
    return;
  }
  dom.detailDrawer.hidden = false;
  dom.detailTitle.textContent = `${line.sourceName} · ${fmtTime(line.ts)}`;
  dom.detailBody.replaceChildren();

  if (state.detailTab === 'json') {
    const pre = document.createElement('pre');
    pre.className = 'log-console__json';
    pre.textContent = JSON.stringify(line.raw, null, 2);
    dom.detailBody.append(pre);
    return;
  }

  if (state.detailTab === 'correlate') {
    const dl = document.createElement('dl');
    for (const [key, value] of Object.entries(line.correlations || {})) {
      const row = document.createElement('div');
      row.className = 'log-console__kv';
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      const button = document.createElement('button');
      button.className = 'btn btn--ghost btn--sm';
      button.type = 'button';
      button.textContent = value;
      button.addEventListener('click', () => {
        const src = source();
        const field = src?.correlationKeys?.[key];
        if (field) state.filters.push({ field, op: 'eq', value });
        else dom.queryInput.value = value;
        reload();
      });
      dd.append(button);
      row.append(dt, dd);
      dl.append(row);
    }
    if (!dl.children.length) {
      const empty = document.createElement('div');
      empty.className = 'log-console__empty';
      empty.textContent = 'No correlation keys on this row';
      dom.detailBody.append(empty);
    } else {
      dom.detailBody.append(dl);
    }
    return;
  }

  const pairs = [
    ['source', line.sourceName || line.source],
    ['id', line.id],
    ['time', line.ts],
    ['level', line.level],
    ['message', line.message],
  ];
  for (const [key, value] of pairs) {
    const row = document.createElement('div');
    row.className = 'log-console__kv';
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value || '-';
    row.append(dt, dd);
    dom.detailBody.append(row);
  }
}

function selectLine(line) {
  state.selected = line;
  renderRows();
  renderDetail();
}

function renderStyleRules() {
  dom.styleRules.replaceChildren();
  if (!state.styleRules.length) {
    const empty = document.createElement('div');
    empty.className = 'log-console__empty';
    empty.textContent = 'No user color rules yet';
    dom.styleRules.append(empty);
    return;
  }

  state.styleRules.forEach((rule) => {
    const row = document.createElement('section');
    row.className = 'log-console__rule';
    const swatch = document.createElement('span');
    swatch.className = 'log-console__rule-swatch';
    swatch.style.setProperty('--rule-ink', rule.ink);
    swatch.style.setProperty('--rule-bg', rule.bg);
    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'log-console__rule-name';
    name.textContent = rule.name;
    const meta = document.createElement('div');
    meta.className = 'log-console__rule-meta';
    meta.textContent = `${rule.source} · ${rule.field} ${rule.op} ${rule.value || ''}`;
    body.append(name, meta);
    const remove = document.createElement('button');
    remove.className = 'btn btn--ghost btn--sm';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      state.styleRules = state.styleRules.filter((candidate) => candidate.id !== rule.id);
      saveStyleRules();
      renderStyleRules();
      renderRows();
    });
    row.append(swatch, body, remove);
    dom.styleRules.append(row);
  });
}

function renderLiveButton() {
  dom.liveToggle.replaceChildren();
  if (state.live) {
    const pulse = document.createElement('span');
    pulse.className = 'log-console__pulse';
    dom.liveToggle.append(pulse, document.createTextNode('Live'));
  } else {
    dom.liveToggle.append(document.createTextNode('Paused'));
  }
  dom.liveToggle.classList.toggle('is-active', state.live);
  dom.liveToggle.setAttribute('aria-pressed', String(state.live));
}

function syncRuleForm() {
  dom.ruleSource.replaceChildren();
  const all = document.createElement('option');
  all.value = '*';
  all.textContent = 'All sources';
  dom.ruleSource.append(all);
  for (const src of state.sources) {
    const option = document.createElement('option');
    option.value = src.id;
    option.textContent = src.name;
    dom.ruleSource.append(option);
  }
  dom.ruleSource.value = state.activeSource;
  syncRuleFields();
}

function syncRuleFields() {
  const src = state.sourceMap.get(dom.ruleSource.value) || source();
  const fields = ['message', ...(src?.searchColumns || []), ...(src?.facets || []).map((facet) => facet.field)];
  dom.ruleField.replaceChildren();
  for (const field of [...new Set(fields)]) {
    const option = document.createElement('option');
    option.value = field;
    option.textContent = field;
    dom.ruleField.append(option);
  }
}

async function reloadStats() {
  const data = await api('/api/stats');
  state.stats = new Map((data.sources || []).map((stat) => [stat.id, stat]));
  renderSources();
  renderSourceHeader();
}

async function reload() {
  if (!state.activeSource) return;
  const version = ++state.reloadVersion;
  stopStream();
  renderFilterChips();
  const params = queryParams();
  const sourceId = state.activeSource;

  try {
    const [query, facetData, histogramData, statData] = await Promise.all([
      api(`/api/logs/${sourceId}/query?${params}`),
      api(`/api/logs/${sourceId}/facets?${params}`),
      api(`/api/logs/${sourceId}/histogram?${params}`),
      api(`/api/logs/${sourceId}/stats`),
    ]);
    if (version !== state.reloadVersion || sourceId !== state.activeSource) return;
    state.lines = uniqueLines(query.lines);
    state.facets = facetData.facets || {};
    state.histogram = histogramData.histogram || [];
    state.stats.set(sourceId, statData);
    renderSourceHeader();
    renderFacets();
    renderTimeline();
    renderRows();
    if (state.selected) renderDetail();
    if (state.live) startStream();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function stopStream() {
  state.streamVersion += 1;
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function startStream() {
  stopStream();
  if (!state.live || !state.activeSource) return;
  const version = ++state.streamVersion;
  const sourceId = state.activeSource;
  const params = queryParams();
  state.eventSource = new EventSource(`/api/logs/${sourceId}/stream?${params}`);
  state.eventSource.addEventListener('hello', () => {
    if (version !== state.streamVersion || sourceId !== state.activeSource) return;
    dom.healthSummary.textContent = 'live stream connected';
  });
  state.eventSource.addEventListener('lines', (event) => {
    if (version !== state.streamVersion || sourceId !== state.activeSource) return;
    const payload = JSON.parse(event.data);
    if (payload.reset) state.lines = uniqueLines(payload.lines);
    else state.lines = uniqueLines([...state.lines, ...(payload.lines || [])]).slice(-Number(dom.limitSelect.value || 500));
    renderSourceHeader();
    renderRows();
  });
  state.eventSource.addEventListener('error', () => {
    if (version !== state.streamVersion || sourceId !== state.activeSource) return;
    dom.healthSummary.textContent = 'stream reconnecting';
  });
}

async function exportLines() {
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: state.activeSource, format: 'json', lines: state.lines }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.activeSource}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported visible rows', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function bindEvents() {
  const debouncedReload = debounce(reload, 300);
  dom.queryInput.addEventListener('input', debouncedReload);
  dom.regexToggle.addEventListener('change', reload);
  dom.timeRange.addEventListener('change', reload);
  dom.limitSelect.addEventListener('change', reload);
  dom.refreshButton.addEventListener('click', reload);
  dom.clearFilters.addEventListener('click', () => {
    state.filters = [];
    dom.queryInput.value = '';
    reload();
  });
  dom.exportButton.addEventListener('click', exportLines);
  dom.liveToggle.addEventListener('click', () => {
    state.live = !state.live;
    renderLiveButton();
    if (state.live) startStream();
    else stopStream();
  });

  document.querySelectorAll('.log-console__level').forEach((button) => {
    button.addEventListener('click', () => {
      const level = button.dataset.level;
      if (state.activeLevels.has(level)) state.activeLevels.delete(level);
      else state.activeLevels.add(level);
      button.classList.toggle('is-active', state.activeLevels.has(level));
      button.setAttribute('aria-pressed', String(state.activeLevels.has(level)));
      reload();
    });
  });

  dom.detailClose.addEventListener('click', () => {
    state.selected = null;
    renderRows();
    renderDetail();
  });
  document.querySelectorAll('[data-detail-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.detailTab = button.dataset.detailTab;
      document.querySelectorAll('[data-detail-tab]').forEach((tab) => tab.classList.toggle('is-active', tab === button));
      renderDetail();
    });
  });

  dom.styleButton.addEventListener('click', () => {
    dom.styleDrawer.hidden = false;
    syncRuleForm();
    renderStyleRules();
  });
  dom.styleClose.addEventListener('click', () => {
    dom.styleDrawer.hidden = true;
  });
  dom.ruleSource.addEventListener('change', syncRuleFields);
  dom.styleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.styleRules.push({
      id: crypto.randomUUID(),
      enabled: true,
      name: dom.ruleName.value.trim() || 'Row color rule',
      source: dom.ruleSource.value,
      field: dom.ruleField.value,
      op: dom.ruleOp.value,
      value: dom.ruleValue.value,
      ink: dom.ruleInk.value,
      bg: dom.ruleBg.value,
    });
    saveStyleRules();
    renderStyleRules();
    renderRows();
    toast('Row color rule added', 'ok');
  });
}

async function boot() {
  bindEvents();
  loadStyleRules();
  renderLiveButton();
  try {
    const [sourcesData, health] = await Promise.all([api('/api/sources'), api('/api/health')]);
    state.sources = sourcesData.sources || [];
    state.sourceMap = new Map(state.sources.map((src) => [src.id, src]));
    if (!state.activeSource) {
      state.activeSource = sourcesData.defaultSource || state.sources[0]?.id || '';
    }
    const failed = Object.entries(health.databases || {}).filter(([, check]) => !check.ok);
    dom.healthSummary.textContent = failed.length ? `${failed.length} DB check failed` : 'all DBs connected';
    syncRuleForm();
    await reloadStats();
    renderSourceHeader();
    renderStyleRules();
    await reload();
  } catch (err) {
    toast(err.message, 'error');
    dom.healthSummary.textContent = err.message;
  }
}

boot();
