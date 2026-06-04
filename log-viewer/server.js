// Vector Log Viewer — standalone, read-only tail console for the
// `users_sessions` and `audit_logs` Postgres tables in vector_artefacts.
//
// This server does three things:
//   1. Serves the static SPA from ./public
//   2. Exposes a small read-only REST API over the configured log sources
//   3. Streams new rows to the browser via Server-Sent Events (one poll loop
//      per connected stream, keyset-advanced so large tables stay cheap)
//
// It NEVER writes to the database. See lib/db.js for the read-only guards.

import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDatabaseUrl, redactDsn } from './lib/env.js';
import { initPool, healthCheck, closePool } from './lib/db.js';
import { buildLogSources } from './lib/logSources.js';
import * as Q from './lib/queries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- config + boot ---------------------------------------------------------

const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const PORT = process.env.PORT || config.port || 3001;
const MAX_LINES = config.maxLinesInMemory || 50000;
const REFRESH_MS = config.refreshIntervalMs || 1000;
const INITIAL = config.tailInitialLines || 500;

const sources = buildLogSources(config);

const { url: dbUrl, source: dbSource } = resolveDatabaseUrl(config);
initPool({
  url: dbUrl,
  statementTimeoutMs: config.db?.statementTimeoutMs,
  max: config.db?.maxPoolConnections,
});

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(join(__dirname, 'public')));

// ---- helpers ---------------------------------------------------------------

function getSourceOr404(req, res) {
  const src = sources.get(req.params.name);
  if (!src) {
    res.status(404).json({ error: `unknown log source: ${req.params.name}` });
    return null;
  }
  return src;
}

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, v));
}

// ---- REST API --------------------------------------------------------------

// List available log sources + their display metadata.
app.get('/api/logs', (_req, res) => {
  res.json({
    logs: [...sources.values()].map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      table: s.table,
      correlationKey: s.correlationKey,
    })),
    config: { refreshIntervalMs: REFRESH_MS, maxLinesInMemory: MAX_LINES },
  });
});

// Recent N lines (oldest-first). ?lines=100
app.get('/api/logs/:name/tail', async (req, res) => {
  const src = getSourceOr404(req, res);
  if (!src) return;
  try {
    const limit = clamp(req.query.lines, 1, 5000, INITIAL);
    const lines = await Q.tail(src, limit);
    const total = await Q.count(src);
    res.json({ source: src.id, total, lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Absolute line range. ?start=100&end=200  (1-based, inclusive)
app.get('/api/logs/:name/range', async (req, res) => {
  const src = getSourceOr404(req, res);
  if (!src) return;
  try {
    const start = clamp(req.query.start, 1, 1e9, 1);
    const end = clamp(req.query.end, start, start + 5000, start + 99);
    const lines = await Q.range(src, start, end);
    res.json({ source: src.id, start, end, lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-source dashboard stats.
app.get('/api/logs/:name/stats', async (req, res) => {
  const src = getSourceOr404(req, res);
  if (!src) return;
  try {
    res.json(await Q.stats(src));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggregate stats across all sources.
app.get('/api/stats', async (_req, res) => {
  try {
    const all = await Promise.all([...sources.values()].map((s) => Q.stats(s)));
    res.json({ sources: all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export. POST { source, format, lines:[...] } -> file download.
// The browser holds the (already filtered/selected) lines and posts them back,
// so export honours exactly what the operator sees. No re-query, no surprises.
app.post('/api/export', (req, res) => {
  const { format = 'txt', lines = [], source = 'logs' } = req.body || {};
  if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines must be an array' });
  const stamp = source.replace(/[^a-z0-9_-]/gi, '_');
  let body, mime, ext;
  switch (format) {
    case 'json':
      body = JSON.stringify(lines, null, 2);
      mime = 'application/json';
      ext = 'json';
      break;
    case 'csv':
      body = toCsv(lines);
      mime = 'text/csv';
      ext = 'csv';
      break;
    case 'html':
      body = toHtml(lines, stamp);
      mime = 'text/html';
      ext = 'html';
      break;
    default:
      body = lines.map((l) => `${l.lineNumber ?? ''}\t${l.ts ?? ''}\t${l.level ?? ''}\t${l.message ?? ''}`).join('\n');
      mime = 'text/plain';
      ext = 'txt';
  }
  res.setHeader('Content-Type', `${mime}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${stamp}-export.${ext}"`);
  res.send(body);
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(lines) {
  const head = ['lineNumber', 'id', 'ts', 'level', 'message'];
  const rows = lines.map((l) => head.map((h) => csvCell(l[h])).join(','));
  return [head.join(','), ...rows].join('\n');
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function toHtml(lines, title) {
  const colours = {
    ERROR: '#FEE2E2', WARN: '#FEF3C7', SUCCESS: '#D1FAE5', CRITICAL: '#991B1B', INFO: '', DEBUG: '', TRACE: '',
  };
  const rows = lines
    .map((l) => {
      const bg = colours[l.level] || '';
      const fg = l.level === 'CRITICAL' ? '#fff' : '#111';
      return `<tr style="background:${bg};color:${fg}"><td>${escHtml(l.lineNumber ?? '')}</td><td>${escHtml(l.ts ?? '')}</td><td><b>${escHtml(l.level ?? '')}</b></td><td><pre style="margin:0;white-space:pre-wrap">${escHtml(l.message ?? '')}</pre></td></tr>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${escHtml(title)} export</title><style>body{font:13px ui-monospace,monospace;background:#0b0f17;color:#cbd5e1;padding:16px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #1f2937;padding:3px 8px;vertical-align:top}</style><h2>${escHtml(title)} — ${lines.length} lines</h2><table>${rows}</table>`;
}

// ---- SSE live tail ---------------------------------------------------------

// GET /api/logs/:name/stream  -> text/event-stream of new lines.
// The client opens this with EventSource and gets:
//   event: hello   -> { total }
//   event: lines   -> { lines:[...] }   (only rows newer than last seen)
//   event: ping    -> keepalive
app.get('/api/logs/:name/stream', async (req, res) => {
  const src = getSourceOr404(req, res);
  if (!src) return;

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

  let cursor = null; // ISO ts of newest row seen
  let alive = true;
  let busy = false;

  try {
    const seed = await Q.tail(src, INITIAL);
    if (seed.length) cursor = seed[seed.length - 1].ts;
    const total = await Q.count(src);
    send('hello', { source: src.id, total });
    if (seed.length) send('lines', { lines: seed, reset: true });
  } catch (err) {
    send('error', { message: err.message });
  }

  const poll = async () => {
    if (!alive || busy) return;
    busy = true;
    try {
      const fresh = await Q.since(src, cursor, 2000);
      if (fresh.length) {
        cursor = fresh[fresh.length - 1].ts;
        send('lines', { lines: fresh, reset: false });
      } else {
        send('ping', { t: cursor });
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

// ---- health + boot ---------------------------------------------------------

app.get('/api/health', async (_req, res) => {
  try {
    const hc = await healthCheck();
    res.json({ ok: true, db: redactDsn(dbUrl), server_time: hc.server_time });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

const server = app.listen(PORT, async () => {
  console.log(`\n  Vector Log Viewer`);
  console.log(`  ─────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  DB:      ${redactDsn(dbUrl)}  (read-only)`);
  console.log(`  Source:  ${dbSource}`);
  console.log(`  Tables:  ${[...sources.values()].map((s) => s.table).join(', ')}`);
  try {
    await healthCheck();
    console.log(`  Status:  connected ✓\n`);
  } catch (err) {
    console.error(`  Status:  DB UNREACHABLE ✗ — ${err.message}`);
    console.error(`  (Is the SSH tunnel up?  ssh -fN vector-dev-pg  forwards :5435)\n`);
  }
});

function shutdown() {
  console.log('\n  shutting down…');
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
