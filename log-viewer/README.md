# Vector Log Viewer

A standalone, real-time **tail console** for Vector's audit and session activity.
It runs independently of the main app, on its own Node server, and streams new
rows live into a multi-panel browser UI built for leaving open on a monitoring
screen.

> **Important — these are database tables, not files.**
> The original brief described tailing `.log` files. In Vector, `users_sessions`
> and `audit_logs` are **Postgres tables in `vector_artefacts`** (vaPool), not
> on-disk logs (the Go backend logs only to stdout / Loki). This tool therefore
> *streams new rows from Postgres* via keyset-cursor polling — there is no
> `chokidar`/file-watcher. See [Architecture](#architecture).

---

## Quick start

```bash
# 1. Make sure the dev DB tunnel is up (forwards localhost:5435 -> remote :5432)
ssh -fN vector-dev-pg

# 2. Launch
cd log-viewer
./start.sh                 # or:  npm install && npm start
```

Then open **http://localhost:3001**.

Port is configurable: `PORT=4002 ./start.sh`, or edit `config.json`.

---

## What it shows

Two log sources out of the box, defined in [`config.json`](./config.json):

| Source           | Table (in `vector_artefacts`) | Level derived from |
| ---------------- | ----------------------------- | ------------------ |
| **Audit Logs**   | `audit_logs`                  | `audit_logs_action` (e.g. `auth.login_failed` → ERROR) |
| **User Sessions**| `users_sessions`              | row state (revoked → ERROR, rotated → WARN, else active → SUCCESS) |

Add more by appending to `config.json > logs[]` — any table in the same DB,
with its column list, a message template, and level rules. No code change needed.

---

## Architecture

```
 browser  ── SSE (/api/logs/:name/stream) ──►  server.js (Express)
    ▲                                              │
    │  REST: /tail /range /stats /export           │  read-only pool (pg)
    │                                              ▼
 public/ (vanilla JS, no build)            vector_artefacts  (SELECT only)
   app.js            orchestrator: panels, layout, cross-ref, dashboard
   logViewer.js      one panel: virtual scroll, selection, filter, context menu
   highlightEngine.js level styling + built-in & custom regex highlights
   exportManager.js  txt / csv / json / html / clipboard
```

**Backend modules** (`lib/`):

- `env.js` — resolves the DB DSN (`LOG_VIEWER_DB_URL` env, else
  `VECTOR_ARTEFACTS_DB_URL` from `../backend/.env.dev`); redacts on log.
- `db.js` — **read-only** pool. Every connection sets
  `default_transaction_read_only = on` + a `statement_timeout`; the query helper
  refuses anything that isn't a `SELECT`/`WITH`.
- `logSources.js` — validates config identifiers against a strict allowlist,
  normalises rows into `{id, ts, level, message, raw, correlation}`.
- `queries.js` — keyset (cursor) tail, absolute range, count, dashboard stats.
  Values are always bound parameters; only config-validated identifiers are
  interpolated.

### Why no `ws` / `chokidar` / `tail` / `split.js`

The original brief listed those. They don't fit this build:

- **`chokidar` / `tail`** — file-watchers; our source is Postgres.
- **`ws`** — the tail is one-directional, so **SSE** is simpler and reconnects
  automatically. No WebSocket dependency.
- **`split.js`** — the resizable splits are ~40 lines of vanilla JS.
- **`marked`** — highlighting is custom (`highlightEngine.js`).

Backend deps are just **`express` + `pg`**. The frontend has **zero** runtime
dependencies and no build step.

---

## Security posture (Trust-No-One)

Vector targets defence/finance buyers, so the viewer is built read-only by design:

- Connections are forced `read-only` at the session level; the query layer
  rejects non-`SELECT` statements as a second guard.
- No request value is ever interpolated into SQL — only bound parameters. Table
  and column names come from `config.json` and are validated against
  `^[a-z_][a-z0-9_]*$` before reaching SQL.
- For a hardened deployment, point `LOG_VIEWER_DB_URL` at a dedicated Postgres
  role with `GRANT SELECT` only on the two tables. The viewer needs nothing more.
- The viewer reads `audit_logs` (which can contain IPs, user IDs, DPoP key
  thumbprints). Treat the port as sensitive — it is **not** authenticated and is
  intended for `localhost` / an operator screen, not public exposure.

---

## Features

- **Live tail** over SSE, play/pause (Space), auto-reconnect, connection pill.
- **Multi-panel splits** — horizontal / vertical / single, drag-to-resize,
  per-panel source selector. Layout persists (localStorage). `Layout` cycles.
- **Virtual scrolling** — only visible rows are in the DOM, so 50k in-memory
  lines stay smooth.
- **Level syntax highlighting** — ERROR / WARN / INFO / DEBUG / SUCCESS /
  CRITICAL (CRITICAL pulses) per the brief's palette.
- **Highlight engine** — built-in IP / UUID / timestamp patterns + your own
  regex→colour rules (persisted), match counts, `n`/`p` to jump between hits.
- **Filtering** — global filter across panels (plain or `/regex/`), per-panel
  filter, "only ★ highlighted" toggle.
- **Selection & copy** — click gutter to select, ⇧ range, ⌘/Ctrl multi.
  Right-click for copy line / reference / raw JSON / **copy with ±5 context**.
- **Cross-referencing** — every line is `[source:line]`. Right-click shows
  **correlated entries** (same user) in the other panel; click to jump.
  Back/◀ ▶/forward jump history in the status bar.
- **Export** — visible / selected / highlighted → TXT / CSV / JSON / HTML
  (HTML preserves level colours) or clipboard. Honours active filters exactly.
- **Dashboard** — per-source row totals, 24h volume-per-hour bars, top patterns.
- **Status bar** — tail state, lines/s, totals, in-memory count, filter count,
  selection count.
- **Notifications** — toast on ERROR/CRITICAL; opt-in browser notifications.

---

## API

| Method | Route | Purpose |
| ------ | ----- | ------- |
| GET  | `/api/logs` | list sources + display metadata |
| GET  | `/api/logs/:name/tail?lines=N` | most-recent N rows (oldest-first) |
| GET  | `/api/logs/:name/range?start=&end=` | absolute line range (1-based) |
| GET  | `/api/logs/:name/stream` | **SSE** live tail |
| GET  | `/api/logs/:name/stats` | one source's dashboard stats |
| GET  | `/api/stats` | all sources' stats |
| POST | `/api/export` | `{source, format, lines[]}` → file download |
| GET  | `/api/health` | DB reachability (redacted DSN) |

---

## Troubleshooting

- **"DB UNREACHABLE" on boot** → the SSH tunnel is down. `ssh -fN vector-dev-pg`.
- **Empty panels** → the table genuinely has no recent rows, or your filter
  hides everything. Check the dashboard for totals.
- **Connection pill stuck on "reconnecting…"** → EventSource auto-retries; if it
  persists, the server crashed — check its console.
- **Different DB / role** → set `LOG_VIEWER_DB_URL` before starting.

---

## Notes for maintainers

- This tool deliberately does **not** read the main app's code or share its
  build. It only reads `../backend/.env.dev` for the DSN.
- `config.json` is the extension point. Adding a third table = one config block,
  zero code. If a new table needs a derived (non-column) level, extend
  `LogSource.#derivedSubject` in `lib/logSources.js`.
