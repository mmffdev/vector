// MMFFDev Devops console — standalone, read-only observability surface.
//
// Express serves the SPA and a compact read-only API. The API can query
// multiple configured Postgres databases, but every pool is read-only and every
// query helper refuses non-SELECT SQL.

import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDatabases, redactDsn } from './lib/env.js';
import { closePools, healthCheckAll, initPools } from './lib/db.js';
import { buildLogSources } from './lib/logSources.js';
import * as Q from './lib/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const PORT = process.env.PORT || config.port || 4002;
const MAX_LINES = Number(config.maxLinesInMemory) || 50000;
const REFRESH_MS = Number(config.refreshIntervalMs) || 1000;
const INITIAL = Number(config.tailInitialLines) || 500;

const databases = resolveDatabases(config);
initPools(databases);
const sources = buildLogSources(config, databases);

const app = express();
app.use(express.json({ limit: '12mb' }));
app.get('/vector-app/globals.css', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'app', 'globals.css'));
});
app.get('/vector-app/styles/primitives.css', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'app', 'styles', 'primitives.css'));
});
app.use(express.static(join(__dirname, 'public')));

function getSource(req, res) {
  const id = req.params.name || req.query.source || config.defaultSource;
  const source = sources.get(id);
  if (!source) {
    res.status(404).json({ error: `unknown log source: ${id}` });
    return null;
  }
  return source;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseFilters(query) {
  const parsed = parseJson(query.filters, null);
  if (Array.isArray(parsed)) return parsed;

  const raw = Array.isArray(query.filter) ? query.filter : query.filter ? [query.filter] : [];
  return raw
    .map((entry) => {
      const [field, op = 'eq', ...rest] = String(entry).split(':');
      const value = rest.join(':');
      return field ? { field, op, value } : null;
    })
    .filter(Boolean);
}

function parseQueryOptions(req) {
  return {
    q: String(req.query.q || '').trim(),
    regex: req.query.regex === '1' || req.query.regex === 'true',
    from: req.query.from || '',
    to: req.query.to || '',
    limit: req.query.limit || req.query.lines,
    levels: String(req.query.levels || '')
      .split(',')
      .map((level) => level.trim().toUpperCase())
      .filter(Boolean),
    filters: parseFilters(req.query),
    bucket: req.query.bucket || 'hour',
  };
}

function sourceList() {
  return [...sources.values()].map((source) => source.publicShape());
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[c]));
}

function linesToCsv(lines) {
  const head = ['source', 'id', 'ts', 'level', 'message'];
  const rows = lines.map((line) => head.map((key) => csvCell(line[key])).join(','));
  return [head.join(','), ...rows].join('\n');
}

function linesToText(lines) {
  return lines
    .map((line) => `${line.source ?? ''}\t${line.ts ?? ''}\t${line.level ?? ''}\t${line.message ?? ''}`)
    .join('\n');
}

function linesToHtml(lines, title) {
  const rows = lines
    .map((line) => `
      <tr class="lvl-${htmlEscape(String(line.level || '').toLowerCase())}">
        <td>${htmlEscape(line.source)}</td>
        <td>${htmlEscape(line.ts)}</td>
        <td>${htmlEscape(line.level)}</td>
        <td><pre>${htmlEscape(line.message)}</pre></td>
      </tr>`)
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${htmlEscape(title)}</title>
    <style>
      body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b1020;color:#d7deea;padding:16px}
      table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #263149;padding:5px 8px;vertical-align:top}
      pre{margin:0;white-space:pre-wrap}.lvl-error{background:#481718}.lvl-warn{background:#40320f}.lvl-success{background:#0e3324}
    </style>
    <h1>${htmlEscape(title)}</h1><table>${rows}</table>`;
}

app.get('/api/sources', (_req, res) => {
  res.json({
    sources: sourceList(),
    defaultSource: config.defaultSource,
    config: {
      refreshIntervalMs: REFRESH_MS,
      maxLinesInMemory: MAX_LINES,
      tailInitialLines: INITIAL,
    },
    databases: Object.fromEntries(
      Object.entries(databases).map(([key, db]) => [
        key,
        { label: db.label, source: db.source, dsn: redactDsn(db.url) },
      ])
    ),
  });
});

// Backwards-compatible alias used by the previous UI.
app.get('/api/logs', (_req, res) => {
  res.json({
    logs: sourceList(),
    config: { refreshIntervalMs: REFRESH_MS, maxLinesInMemory: MAX_LINES },
  });
});

app.get('/api/logs/:name/query', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  try {
    res.json(await Q.query(source, parseQueryOptions(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/query', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  try {
    res.json(await Q.query(source, parseQueryOptions(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:name/tail', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  try {
    const opts = parseQueryOptions(req);
    const lines = await Q.tail(source, opts.limit || INITIAL, opts);
    res.json({ source: source.id, total: await Q.count(source, opts), lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:name/facets', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  try {
    res.json({ source: source.id, facets: await Q.facets(source, parseQueryOptions(req)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:name/histogram', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  try {
    res.json({ source: source.id, histogram: await Q.histogram(source, parseQueryOptions(req)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:name/stats', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  try {
    res.json(await Q.stats(source));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await Promise.all([...sources.values()].map((source) => Q.stats(source)));
    res.json({ sources: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export', (req, res) => {
  const { format = 'txt', lines = [], source = 'logs' } = req.body || {};
  if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines must be an array' });
  const stamp = String(source).replace(/[^a-z0-9_-]/gi, '_') || 'logs';

  const writers = {
    json: () => [JSON.stringify(lines, null, 2), 'application/json', 'json'],
    csv: () => [linesToCsv(lines), 'text/csv', 'csv'],
    html: () => [linesToHtml(lines, `${stamp} export`), 'text/html', 'html'],
    txt: () => [linesToText(lines), 'text/plain', 'txt'],
  };
  const [body, mime, ext] = (writers[format] || writers.txt)();
  res.setHeader('Content-Type', `${mime}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${stamp}-export.${ext}"`);
  res.send(body);
});

app.get('/api/logs/:name/stream', async (req, res) => {
  const source = getSource(req, res);
  if (!source) return;
  const opts = parseQueryOptions(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let cursor = null;
  let alive = true;
  let busy = false;

  try {
    const seed = await Q.tail(source, INITIAL, opts);
    if (seed.length) {
      const last = seed[seed.length - 1];
      cursor = { orderValue: last.orderValue, id: last.id };
    }
    send('hello', { source: source.id, total: await Q.count(source, opts) });
    if (seed.length) send('lines', { lines: seed, reset: true });
  } catch (err) {
    send('error', { message: err.message });
  }

  const poll = async () => {
    if (!alive || busy) return;
    busy = true;
    try {
      const fresh = await Q.since(source, cursor, 2000, opts);
      if (fresh.length) {
        const last = fresh[fresh.length - 1];
        cursor = { orderValue: last.orderValue, id: last.id };
        send('lines', { lines: fresh, reset: false });
      } else {
        send('ping', { t: cursor?.orderValue || null });
      }
    } catch (err) {
      send('error', { message: err.message });
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(poll, REFRESH_MS);
  req.on('close', () => {
    alive = false;
    clearInterval(timer);
  });
});

app.get('/api/health', async (_req, res) => {
  const checks = await healthCheckAll();
  const ok = Object.values(checks).every((check) => check.ok);
  res.status(ok ? 200 : 503).json({
    ok,
    databases: Object.fromEntries(
      Object.entries(databases).map(([key, db]) => [
        key,
        { ...checks[key], label: db.label, dsn: redactDsn(db.url) },
      ])
    ),
  });
});

const server = app.listen(PORT, async () => {
  console.log(`\n  MMFFDev - Devops`);
  console.log(`  ─────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  for (const [key, db] of Object.entries(databases)) {
    console.log(`  DB ${key}: ${redactDsn(db.url)} (${db.source})`);
  }
  console.log(`  Sources: ${[...sources.keys()].join(', ')}`);
  const checks = await healthCheckAll();
  const failed = Object.entries(checks).filter(([, check]) => !check.ok);
  if (failed.length) {
    console.error(`  Status: ${failed.length} DB check(s) failed`);
    for (const [key, check] of failed) console.error(`    ${key}: ${check.error}`);
  } else {
    console.log(`  Status: connected ✓\n`);
  }
});

function shutdown() {
  console.log('\n  shutting down...');
  server.close(async () => {
    await closePools();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
