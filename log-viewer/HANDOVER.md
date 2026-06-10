# MMFFDev - Devops Log Console Handover

Standalone, read-only DevOps observability surface for Vector product data. It
does not import the Next.js app or Go backend runtime; it only reads configured
Postgres sources and serves a vanilla browser UI from `log-viewer/public`.

## Current State

- URL: `http://localhost:4002`
- Browser title/header: `MMFFDev - Devops`
- Scope: only files under `log-viewer/`
- Data model: read-only SQL over three configured databases
- UI model: one active source, facets, search, level filters, timeline, row
  detail drawer, JSON/correlation view, export, local user row color rules
- Default window: `All time`, so sparse sources with older rows are visible on
  first selection; operators can narrow to 15m/1h/6h/24h/7d manually
- Styling model: loads Vector shared CSS from `/vector-app/globals.css`, which
  imports `/vector-app/styles/primitives.css`; local CSS owns only console
  layout, log rows, drawers, charts, and row color behaviour

## Files

```text
log-viewer/
|-- server.js                  Express static/API/SSE server
|-- config.json                DB/source registry and query metadata
|-- package.json               Node >= 20, express, pg
|-- lib/
|   |-- env.js                 multi-DB env/DSN resolver with redaction
|   |-- db.js                  read-only pg pools and SELECT guard
|   |-- logSources.js          source validation and row normalization
|   `-- queries.js             query/tail/facet/histogram/stats builders
`-- public/
    |-- index.html             app shell
    |-- css/styles.css         console-specific styling over Vector primitives
    `-- js/app.js              UI controller
```

`server.js` serves two app style files without exposing the whole app tree:

- `/vector-app/globals.css` -> `../app/globals.css`
- `/vector-app/styles/primitives.css` -> `../app/styles/primitives.css`

## Sources

Configured sources currently cover 13 tables:

- Security: `audit_logs`, `users_sessions`, `error_events`, `csp_reports`
- Queues: `search_outbox`, `notifications_outbox`, `webhook_deliveries`
- Product: `users_notifications`, `dependency_edge_events`
- Delivery: `task_burn_events`, `sprint_burn_events`
- DevOps: `dev_reports`
- Library: `library_release_logs`

`config.json` is the extension point. Add a source by defining its database key,
table, timestamp/id columns, selected columns, facets, search columns, and
correlation keys.

## Run

```bash
cd log-viewer
node server.js
```

Preconditions:

- dev DB tunnel is available on `localhost:5435`
- `../backend/.env.dev` contains the configured DSNs or DB parts

## Safety

- Every pool sets `default_transaction_read_only = on`
- `readQuery()` rejects non-`SELECT`/`WITH` SQL
- Request values are bound parameters
- Identifiers come from `config.json` and pass strict allowlist validation
- DSNs are redacted in logs and API responses
- No auth is built in; this is a localhost operator tool, not a public surface

## Verification Snapshot

Last verified on 2026-06-09:

- `/api/health` returned OK for `vector`, `dev`, and `library`
- `/api/sources` returned all 13 sources
- shared `globals.css` and `primitives.css` served as HTTP 200
- page title/header rendered as `MMFFDev - Devops`
- logo mark removed
- all rendered buttons had `.btn` plus a `btn--*` variant
- live SSE stream connected and rows rendered
- Error Events rendered rows under the default all-time window
- source switching to Error Events worked
- fresh browser console check reported 0 errors
