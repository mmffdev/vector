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
| `auth` | `auth.NewService(pool, auditLog, mailer)` (L145) | `users`, `sessions`, `password_resets` |
| `apikeys` | `apikeys.New(pool)` (L149) | `api_keys` |
| `users` | `users.New(pool, auditLog, mailer)` (L158) | `users` (role + profile fields) |
| `roles` | `roles.New(pool, auditLog)` (L163) | `roles`, `permissions`, `role_permissions` |
| `nav` | `nav.New(pool, navRegistry)` (L179) | `pages`, `page_tags`, `roles_pages`, `user_nav_prefs`, `user_nav_groups`, `user_profile_groups` |
| `custompages` | `custompages.New(pool)` (L181) | `pages` rows with `kind='user_custom'` + views |
| `addressables` | `addressables.New(pool, ...)` (L189) | `addressables`, `addressable_help` |
| `usertaborder` | `usertaborder.New(pool)` (L201) | `user_tab_order` |
| `workspaces` | `workspaces.New(pool, auditLog, permResolver)` (L263) | `workspaces`, `workspace_roles` |

### Services on `vaPool` (vector_artefacts) — **the cutover substrate**

| Service | Constructor line | Owns / writes |
|---|---|---|
| `artefacttypes` | `artefacttypes.NewService(vaPool)` (L477) | **`artefact_types`** (the table the user-facing `/workspace-admin/artefact-types` page reads/writes) |
| `artefactitemsv2` | `artefactitemsv2.NewService(vaPool, pool, "work"\|"strategy")` (L320, L323) | `artefacts`, `artefact_field_values` (read-write); `pool` for cross-DB tenant joins |
| `flows` | `flows.NewHandler(flows.New(vaPool, pool))` (L457) | `flows`, `flow_states`, `flow_transitions` |
| `fields` | `fields.NewService(pool, vaPool)` (L427) — **vaPool is `artefactsPool`** | `field_library`, `artefact_type_fields` (on VA); reads `workspaces` / role grants from `pool` |
| `timeboxsprints` | `timeboxsprints.NewService(vaPool)` (L444) | `timebox_sprints` |
| `timeboxreleases` | `timeboxreleases.NewService(vaPool)` (L452) | `timebox_releases` |
| `ranking` | `ranking.New(vaPool)` (L472) | rank-listener channel + `*_rank` columns on VA tables |
| `search` | `search.New(vaPool)` (L483) | search index + outbox |
| `searchworker` | `searchworker.New(vaPool, swCfg)` (L1522) | indexer consumer; reads outbox, writes index |
| `webhooks` | `webhooks.New(vaPool)` (L318) | `webhook_subscriptions`, `webhook_deliveries` |
| `audit` | `audit.New(pool)` (L146) + `auditLog.SetPool(vaPool)` (L316) | `audit_log` — early-bound on `pool` so service constructors capture the reference; pool atomically swapped to `vaPool` after vaPool init (PLA-0023 P1, 2026-05-13) |
| `errorsreport` (writes) | `errorsreport.NewService(libPools.RO, errorsReportPool)` (L505) — `errorsReportPool = vaPool` when available, else `pool` | `error_events` — moved to vaPool 2026-05-13 (PLA-0023 P1); `libPools.RO` still reads `error_codes` from mmff_library |
| `orgdesign` | `orgdesign.New(pool, vaPool)` (L360) — **vaPool is the canonical write target post-M6.2.7** | `org_nodes`, `topology_role_grants`, `topology_view_state` (all moved to VA) |
| `portfolio` (master record) | `portfolio.NewService(vaPool).WithVectorPool(pool)` (L383) | `master_record_*` tables |
| `tenantsettings` | `tenantsettings.New(tenantSettingsPool)` (L405) — **vaPool if available, else falls back to `pool`** | `master_record_tenant` (mig 036 lives on VA) |

### Services on `libPools` (mmff_library)

| Service | Constructor line | Owns / reads |
|---|---|---|
| `librarydb` | `librarydb.New(ctx)` (L135) | Read-only bundle fetch: `library_strategy_layers`, `library_artefact_types`, `library_flows`, etc. |
| `libraryreleases` | `libraryreleases.NewService(libPools.RO, pool)` (L232) | Reads release channel from `libPools`; writes ack rows to `pool` (mmff_vector) |

### Services on more than one pool

| Service | Pools | Notes |
|---|---|---|
| `portfoliomodels` | `libPools.RO` + `pool` | Reads adoption catalogue from library; dual-writes adoption state to `mmff_vector` (with optional `vaPool` PLA-0026 mirror) |
| `errorsreport` | `libPools.RO` + `vaPool` (fallback `pool`) | Reads error catalogue from library; writes `error_events` to `vector_artefacts` post-PLA-0023 P1 (2026-05-13); falls back to `pool` only when `vaPool` is unavailable |
| `portfoliomodels` (errors writer) | `vaPool` (fallback `vectorPool`) via `Orchestrator.ErrorsPool` | `appendErrorEvent` saga writes `error_events` to vaPool; other saga writes (adoption_state, etc.) stay on `vectorPool` until their tables migrate |
| `portfoliomodels.NewDevResetHandler` | `pool` + `vaPool` (L397) | Cross-DB reset; tolerates `vaPool == nil` |

## How to verify a feature's DB before querying

1. **Find the handler.** `grep -rn '<route-or-table-name>' backend/internal/`.
2. **Find the constructor.** Inside `backend/cmd/server/main.go`, find `<service>.NewService(...)` and note the pool argument(s).
3. **Look up the pool here.** Match the pool variable name to the table above to get the DB name.
4. **Run psql with the matching `-d <dbname>` flag.** Connection string is always `host=localhost port=5435 user=mmff_dev` on dev; only the DB name changes.

## Common confusions to avoid

- `obj_*` tables (`obj_execution_types`, `obj_strategy_types`, `obj_work_items`, etc.) live in **`mmff_vector`** as the *legacy* substrate. They are being phased out by PLA-0023 cutover.
- `artefact_types`, `artefacts`, `flows`, `flow_states`, `flow_transitions`, `field_library`, `timebox_*` live in **`vector_artefacts`** as the *current* substrate.
- A feature with a "v2" suffix (e.g. `/api/v2/work-items`) almost certainly reads `vaPool`. A non-v2 route may still read `vaPool` post-cutover — always verify via main.go.
- `vector_icons` and `subscription_item_type_icons` live in **`mmff_vector`** — they predate the cutover and have not been migrated yet.

## Cross-references

- Schema golden source for `mmff_vector` → [`c_schema.md`](c_schema.md).
- vector_artefacts cutover plan → [`c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md).
- Library bundle fetch contract → [`c_c_librarydb_fetch.md`](c_c_librarydb_fetch.md).
- Tenant isolation invariants → [`c_schema.md`](c_schema.md) (tenant-id sections).
