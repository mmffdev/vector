# MMFFDev - Devops

Standalone, read-only DevOps log console for Vector and supporting MMFFDev
databases. It runs independently of the main app and exposes a local browser UI
for security, queue, product, delivery, DevOps, and library events.

## Quick Start

```bash
cd log-viewer
node server.js
```

Open `http://localhost:4002`.

The dev Postgres tunnel must be reachable at `localhost:5435`. Database
connection details are resolved from `../backend/.env.dev`, with safe DSN
redaction in logs and API responses.

## What It Shows

Sources are configured in `config.json` and currently include:

- `audit_logs`
- `users_sessions`
- `error_events`
- `csp_reports`
- `search_outbox`
- `notifications_outbox`
- `users_notifications`
- `webhook_deliveries`
- `task_burn_events`
- `sprint_burn_events`
- `dependency_edge_events`
- `dev_reports`
- `library_release_logs`

## Features

- Live SSE tail with pause/resume
- Source groups and per-source stats
- Search, regex mode, all-time default window, row limit, level filters
- Facet filters generated from each source definition
- Timeline histogram
- Event detail drawer with summary, JSON, and correlation tabs
- Local browser row color rules for ink and row background
- JSON export of visible rows
- Multi-database health checks

## Styling Contract

The viewer uses Vector's primary design system:

- `/vector-app/globals.css`
- `/vector-app/styles/primitives.css`

Buttons compose from `.btn` plus one `btn--*` variant. Inputs and selects compose
from `.form__input` / `.form__select`. `public/css/styles.css` should stay
limited to console layout, log-row rendering, drawers, charts, and runtime row
color behaviour.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/sources` | source metadata, DB labels, default source |
| GET | `/api/logs` | backwards-compatible source list alias |
| GET | `/api/logs/:name/query` | filtered rows |
| GET | `/api/query?source=...` | filtered rows alias |
| GET | `/api/logs/:name/tail` | recent rows |
| GET | `/api/logs/:name/facets` | configured facet counts |
| GET | `/api/logs/:name/histogram` | time bucket counts |
| GET | `/api/logs/:name/stats` | one-source totals/latest |
| GET | `/api/stats` | all-source totals/latest |
| GET | `/api/logs/:name/stream` | SSE live stream |
| POST | `/api/export` | export provided rows |
| GET | `/api/health` | read-only DB health |

## Security Posture

This tool is read-only by design:

- pooled DB connections set `default_transaction_read_only = on`
- query helper rejects non-read SQL
- values are parameterized
- table and column names are config-only and identifier-validated

It is not authenticated. Keep it on localhost unless an auth gate and a
dedicated least-privilege DB role are added.
