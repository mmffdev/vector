---
name: reference-db-routing-doc
description: Canonical map of every Go service → pgx pool → database → tables it owns; load before any DB query
metadata:
  type: reference
---

**Source of truth:** [`docs/c_c_db_routing.md`](../../../docs/c_c_db_routing.md). Read this before any psql query or "which DB does X live in?" question.

The doc maps every `backend/internal/<service>` to its pool variable in `backend/cmd/server/main.go`, the env var that supplies the URL, the database name on that connection, and the tables that service owns / reads. It is the answer to "where does proc X live and what does it point to?"

Three databases are in play on every env:

- **`mmff_vector`** — primary app DB. Pool var: `pool`. Env: `DB_NAME`.
- **`vector_artefacts`** — PoC cutover target. Pool var: `vaPool`. Env: `VECTOR_ARTEFACTS_DB_URL` / `VA_DB_NAME`. Hosts `artefact_types`, `artefacts`, `flow_*`, `field_library`, `timebox_*`, `org_nodes` (PLA-0006 cutover), `webhook_*`.
- **`mmff_library`** — read-only library spine. Pool var: `libPool`. Env: `LIBRARY_DB_NAME`. Hosts catalogue/library bundle reads.

Linked: [[feedback-never-assume-database]]
