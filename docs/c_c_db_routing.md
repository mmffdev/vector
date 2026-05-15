# Database routing — service → pool → DB → tables

> **HARD RULE — NO ASSUMPTIONS:** before any psql query, schema lookup, or "the table is probably called X" claim, you MUST read this doc to confirm which pool serves the feature and which database that pool connects to. Memory: [`feedback_never_assume_database`](../.claude/memory/feedback_never_assume_database.md). Source-of-truth wiring: [`backend/cmd/server/main.go`](../backend/cmd/server/main.go).

The Vector backend connects to three Postgres databases via separate `pgxpool.Pool` variables in `main.go`. Every Go service in `backend/internal/<name>` takes one (or two) of these pools through `NewService(...)`. This doc maps every pool, every database, and every service that talks to it.

## Pools at a glance

| Pool variable | Database name | Env vars on `dev` | Purpose |
|---|---|---|---|
| `pool` | `mmff_vector` | `DB_HOST`, `DB_PORT=5435`, `DB_NAME=mmff_vector`, `DB_USER=mmff_dev` | Primary app DB. Auth, nav, users, roles, permissions, tenant settings (until M2 cutover), portfolio adoption, **legacy `obj_*` artefact substrate**. (audit moved to `vaPool` 2026-05-13 — PLA-0023 P1.) |
| `vaPool` | `vector_artefacts` | `VECTOR_ARTEFACTS_DB_URL` (full DSN) or `VA_DB_HOST` / `VA_DB_PORT=5435` / `VA_DB_NAME=vector_artefacts` / `VA_DB_USER=mmff_dev` | PoC cutover target. **Current production substrate for PLA-0023 onwards.** Artefact types, artefacts, flows, fields, sprints/releases, search, webhooks, topology nodes (post-M6.2.7). |
| `libPools.RO` / `libPools.RW` | `mmff_library` | `LIBRARY_DB_HOST`, `LIBRARY_DB_PORT=5435`, `LIBRARY_DB_NAME=mmff_library`, `LIBRARY_DB_USER=mmff_dev` | Read-only library spine + ack flow. Catalogue lookups for portfolio adoption and library releases. |

All three pools run through the SSH tunnel `localhost:5435 → remote :5432` on dev.

## Service → pool index

> Source: `backend/cmd/server/main.go` constructor calls. When a service is constructed with multiple pools, the first is the primary write target.

### Services on `pool` (mmff_vector)

| Service | Constructor line | Owns / writes |
|---|---|---|
| `auth` | `auth.NewService(pool, auditLog, mailer)` | `users`, `users_sessions`, `users_password_resets` (post RF1.4.2.users) |
| `apikeys` | `apikeys.New(pool)` | `admin_api_keys` (post RF1.4.2.admin) |
| `users` | `users.New(pool, auditLog, mailer)` | `users` (role + profile fields) |
| `roles` | `roles.New(pool, auditLog)` | `users_roles`, `users_permissions`, `users_roles_permissions` (post RF1.4.2.users) |
| `nav` | `nav.New(pool, navRegistry)` | `pages`, `pages_tags`, `users_roles_pages`, `users_nav_prefs`, `users_nav_groups`, `users_nav_profile_groups` (post RF1.4.2.pages + .users) |
| `custompages` | `custompages.New(pool)` | `pages` rows with `kind='user_custom'` + `users_custom_pages` views |
| `addressables` | `addressables.New(pool, ...)` | `pages_addressables`, `pages_help` (post RF1.4.2.pages) |
| `usertaborder` | `usertaborder.New(pool)` | `users_tab_order` (post RF1.4.2.users) |
| `workspaces` | `workspaces.New(pool, auditLog, permResolver)` | `master_record_workspaces`, `users_roles_workspaces` (master_record_workspaces → workspaces cross-DB move deferred per TD-NAME-001) |

### Services on `vaPool` (vector_artefacts) — **the cutover substrate**

| Service | Constructor line | Owns / writes |
|---|---|---|
| `artefacttypes` | `artefacttypes.NewService(vaPool)` | **`artefacts_types`** (post RF1.4.2.artefacts; the table the `/workspace-admin/artefact-types` page reads/writes) |
| `artefactitems` | `artefactitems.NewService(vaPool, pool, "work"\|"strategy")` | `artefacts`, `artefacts_fields_values` (post RF1.4.2.artefacts + RF1.4.4 column-prefix); `pool` for cross-DB tenant joins. v-suffix dropped 2026-05-14 (RF1.4.4) — v1 obj_* substrate retired. |
| `flows` | `flows.NewHandler(flows.New(vaPool, pool))` | `flows`, `flows_states`, `flows_transitions`, `flows_states_exit_rules`, `flows_defaults`, `flows_states_defaults`, `flows_transitions_defaults` (post RF1.4.2.flows) |
| `fields` | `fields.NewService(pool, vaPool)` — **vaPool is `artefactsPool`** | `artefacts_fields_library`, `artefacts_types_fields`, `workspaces_fields` (post RF1.4.2.artefacts) |
| `timeboxsprints` | `timeboxsprints.NewService(vaPool)` | `timeboxes_sprints` (post RF1.4.2.timeboxes — full column-prefix applied) |
| `timeboxreleases` | `timeboxreleases.NewService(vaPool)` | `timeboxes_releases` (post RF1.4.2.timeboxes — full column-prefix applied) |
| `ranking` | `ranking.New(vaPool)` | rank-listener channel + `position` columns on VA tables |
| `search` | `search.New(vaPool)` | search index + outbox |
| `searchworker` | `searchworker.New(vaPool, swCfg)` | indexer consumer; reads outbox, writes index |
| `webhooks` | `webhooks.New(vaPool)` | `webhooks_subscriptions`, `webhooks_deliveries` (post RF1.4.2.webhooks — full column-prefix applied) |
| `audit` | `audit.New(pool)` + `auditLog.SetPool(vaPool)` | `audit_logs` (post RF1.4.2.audit — full column-prefix applied); early-bound on `pool` so service constructors capture the reference; pool atomically swapped to `vaPool` after vaPool init |
| `errorsreport` (writes) | `errorsreport.NewService(libPools.RO, errorsReportPool)` — `errorsReportPool = vaPool` when available, else `pool` | `errors_events` (VA, post RF1.4.2.errors); `libPools.RO` still reads `errors_codes` from mmff_library |
| `libraryreleases` (acks) | `libraryreleases.NewService(libPools.RO, pool, pool)` + `libReleasesSvc.SetAcksPool(vaPool)` | `library_releases_acknowledgements` (post RF1.4.2.library — hierarchically re-anchored under releases per §2.2) |
| `topology` | `topology.New(pool, vaPool)` — **vaPool is the canonical write target** | `topology_nodes`, `topology_view_states`, `users_roles_topology_nodes`, `topology_commits` (post RF1.4.2.topology + RF1.4.1 orgdesign→topology rename) |
| `portfolio` (master record) | `portfolio.NewService(vaPool).WithVectorPool(pool)` | `master_record_portfolios`, `master_record_tenants` (post RF1.4.2.master_record) |
| `workspacemasterrecord` | `workspacemasterrecord.New(workspaceSettingsPool)` — **vaPool if available, else falls back to `pool`** | `master_record_workspaces` (renamed from `master_record_tenants` by mig 067 / PLA-0032 on 2026-05-15; workspace-tier settings sidecar keyed by `workspace_id`) |
| `tenantmasterrecord` | `tenantmasterrecord.New(tenantSettingsPool)` — **vaPool if available, else falls back to `pool`** | `master_record_tenants` (NEW table in vector_artefacts, mig 068 / PLA-0050 on 2026-05-15; subscription-tier defaults keyed by `subscription_id`; distinct from `master_record_workspaces` above) |

### Services on `libPools` (mmff_library)

| Service | Constructor line | Owns / reads |
|---|---|---|
| `librarydb` | `librarydb.New(ctx)` (L135) | Read-only bundle fetch: `library_strategy_layers`, `library_artefact_types`, `library_flows`, etc. |
| `librarydb` (releases helpers) | `librarydb.ListReleasesSinceAck/AckRelease/CountOutstandingForSubscription/loadAckedSet` (releases.go) | Reads `library_releases` from `libPools`; reads + writes `library_releases_acknowledgements` on `acksPool` (= vaPool post-PLA-0023 P1, fallback `pool`) (post RF1.4.2.library hierarchical re-anchor) |

### Services on more than one pool

| Service | Pools | Notes |
|---|---|---|
| `portfoliomodels` | `libPools.RO` + `pool` | Reads adoption catalogue from library; dual-writes adoption state to `mmff_vector` (with optional `vaPool` PLA-0026 mirror) |
| `errorsreport` | `libPools.RO` + `vaPool` (fallback `pool`) | Reads `errors_codes` catalogue from library (post RF1.4.2.errors); writes `errors_events` to `vector_artefacts` post-PLA-0023 P1 (2026-05-13); falls back to `pool` only when `vaPool` is unavailable |
| `libraryreleases` | `libPools.RO` + `pool` (subscriptions) + `acksPool` (= `vaPool` post-PLA-0023 P1, fallback `pool`) | 3-pool cross-DB workflow: read `library_releases` from library, look up `subscriptions.tier` on mmff_vector, write `library_releases_acknowledgements` on vector_artefacts (post RF1.4.2.library hierarchical re-anchor). `Service` + `Reconciler` both expose `SetAcksPool` for boot-time swap (audit.Logger pattern) |
| `portfoliomodels` (errors writer) | `vaPool` (fallback `vectorPool`) via `Orchestrator.ErrorsPool` | `appendErrorEvent` saga writes `errors_events` to vaPool (post RF1.4.2.errors); other saga writes (adoption_state, etc.) stay on `vectorPool` until their tables migrate |
| `portfoliomodels.NewDevResetHandler` | `pool` + `vaPool` (L397) | Cross-DB reset; tolerates `vaPool == nil` |

## How to verify a feature's DB before querying

1. **Find the handler.** `grep -rn '<route-or-table-name>' backend/internal/`.
2. **Find the constructor.** Inside `backend/cmd/server/main.go`, find `<service>.NewService(...)` and note the pool argument(s).
3. **Look up the pool here.** Match the pool variable name to the table above to get the DB name.
4. **Run psql with the matching `-d <dbname>` flag.** Connection string is always `host=localhost port=5435 user=mmff_dev` on dev; only the DB name changes.

## Common confusions to avoid

- `obj_*` tables (`obj_execution_types`, `obj_strategy_types`, `obj_work_items`, etc.) live in **`mmff_vector`** as the *legacy* substrate. They are being phased out by PLA-0023 cutover.
- `artefacts_types`, `artefacts`, `artefacts_fields_library`, `artefacts_fields_values`, `flows`, `flows_states`, `flows_transitions`, `timeboxes_*` live in **`vector_artefacts`** as the *current* substrate (post RF1.4.2.artefacts + RF1.4.2.flows + RF1.4.2.timeboxes).
- A feature with a "v2" suffix (e.g. `/api/v2/work-items`) almost certainly reads `vaPool`. A non-v2 route may still read `vaPool` post-cutover — always verify via main.go.
- `vector_icons` and `subscription_item_type_icons` live in **`mmff_vector`** — they predate the cutover and have not been migrated yet.

## Cross-references

- Schema golden source for `mmff_vector` → [`c_schema.md`](c_schema.md).
- vector_artefacts cutover plan → [`c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md).
- Library bundle fetch contract → [`c_c_librarydb_fetch.md`](c_c_librarydb_fetch.md).
- Tenant isolation invariants → [`c_schema.md`](c_schema.md) (tenant-id sections).
