# Database routing — service → pool → DB → tables

> **HARD RULE — NO ASSUMPTIONS:** before any psql query, schema lookup, or "the table is probably called X" claim, you MUST read this doc to confirm which pool serves the feature and which database that pool connects to. Memory: [`feedback_never_assume_database`](../.claude/memory/feedback_never_assume_database.md). Source-of-truth wiring: [`backend/cmd/server/main.go`](../backend/cmd/server/main.go).

> **POST-CUTOVER STATUS (Pillar 3 step 1, 2026-05-26):** `vector_artefacts` is now the PRIMARY tenant DB and absorbs every former `mmff_vector` table. `mmff_vector` is a write-mute zombie — its `pool` variable is still wired into `main.go` so the DB stays connect-able for emergency reads, but NO backend service issues SQL against it. Pillar 3 step 2 drops the 16 FDW foreign tables in vector_artefacts; Pillar 3 step 3 drops the `mmff_vector` database itself.

The Vector backend connects to two tenant Postgres databases via separate `pgxpool.Pool` variables in `main.go`. Every Go service in `backend/internal/<name>` takes `servicePool` (vaPool when available, mmff_vector fallback for legacy envs) through `NewService(...)`. This doc maps every pool, every database, and every service that talks to it.

## Pools at a glance

| Pool variable | Database name | Env vars on `dev` | Purpose |
|---|---|---|---|
| `vaPool` (alias `servicePool` when wired) | `vector_artefacts` | `VECTOR_ARTEFACTS_DB_URL` (full DSN) or `VA_DB_HOST` / `VA_DB_PORT=5435` / `VA_DB_NAME=vector_artefacts` / `VA_DB_USER=mmff_dev` | **PRIMARY tenant DB.** All 71 tables: artefact substrate (artefacts, artefacts_types, artefacts_fields_*, flows, timeboxes_*, search outbox, webhooks, topology_nodes, audit_logs, errors_events, library_releases_acknowledgements, master_record_*) AND the 37 ex-mmff_v tables merged in Pillar 2 (users, users_sessions, users_password_resets, users_roles*, users_permissions, users_nav_*, users_notifications*, users_mentions, users_tab_order, users_reauth_nonces, dpop_jti_cache, admin_api_keys, pages, pages_tags, pages_addressables, pages_help, pages_access_version, users_roles_pages, users_custom_pages, users_custom_page_views, master_record_workspaces, users_roles_workspaces, subscriptions, subscriptions_sequence, subscriptions_stakeholders, cost_centres, csp_reports, notifications_outbox, vector_icons, library_help_defaults, page_entity_refs). |
| `pool` | `mmff_vector` | `DB_HOST`, `DB_PORT=5435`, `DB_NAME=mmff_vector`, `DB_USER=mmff_dev` | **ZOMBIE — will be dropped in Pillar 3 step 3.** Connect-able but NO ACTIVE BACKEND CODE issues SQL against this DB. The pool variable is still declared + deferred-close in `main.go` so the connection stays warm (defensive against partial rollback scenarios) but no `*NewService(pool, …)*` call in main.go consumes it after the Pillar 3 step 1 repoint. |
| `libPools.RO` / `libPools.RW` | `mmff_library` | `LIBRARY_DB_HOST`, `LIBRARY_DB_PORT=5435`, `LIBRARY_DB_NAME=mmff_library`, `LIBRARY_DB_USER=mmff_dev` | Read-only library spine + ack flow. Catalogue lookups for portfolio adoption and library releases. Unchanged by Pillar 3. |
| `devPool` | `mmff_dev` | `MMFF_DEV_DB_URL` | `dev_reports` — every `<report>` output: SY003 (substrate inventory), PLA### (plans), COD### (audits), RES### (research), RET### (retros), SEC### (security). Sole accessor: `backend/internal/devreports/`. Wired in `backend/cmd/server/main.go`. Unchanged by Pillar 3. |

All four pools run through the SSH tunnel `localhost:5435 → remote :5432` on dev.

### Snapshot DBs (created 2026-05-25 pre-wipe-and-reseed; ALSO 2026-05-26 pre-rewind)

Parallel queryable snapshots of all four live DBs. **The running app does NOT connect to these — they are inspection-only.** Drop with `DROP DATABASE <name>_snapshot_20260525;` when no longer needed. See handover `handovers/refactorDB.md` for full snapshot inventory.

## Service → pool index (post Pillar 3 step 1)

> Source: `backend/cmd/server/main.go` constructor calls. The internal struct fields are still named `pool` for back-compat (`s.pool`, `c.pool`, etc.); the VALUE injected is `servicePool` (= vaPool when configured), so every SQL statement lands on vector_artefacts.

### Services on `servicePool` / `vaPool` (vector_artefacts) — the entire tenant surface

| Service | Constructor line | Owns / writes |
|---|---|---|
| `auth` | `auth.NewService(servicePool, auditLog, mailer)` | `users`, `users_sessions`, `users_password_resets`, `users_reauth_nonces`, `dpop_jti_cache` |
| `apikeys` | `apikeys.New(servicePool)` | `admin_api_keys` |
| `users` | `users.New(servicePool, auditLog, mailer)` | `users` |
| `roles` | `roles.New(servicePool, auditLog)` | `users_roles`, `users_permissions`, `users_roles_permissions` |
| `nav` | `nav.New(servicePool, navRegistry)` | `pages`, `pages_tags`, `users_roles_pages`, `users_nav_prefs`, `users_nav_groups`, `users_nav_profiles`, `users_nav_profile_groups` |
| `nav.NewCachedRegistry` | `nav.NewCachedRegistry(servicePool, ...)` | reads `pages`, `pages_tags`, `users_roles_pages` |
| `nav.NewPageBookmarks` | `nav.NewPageBookmarks(servicePool, ...)` | `users_nav_prefs` (bookmark rows) |
| `nav.NewGrantsAdminHandler` | `nav.NewGrantsAdminHandler(servicePool, ...)` | `users_roles_pages`, `pages` |
| `custompages` | `custompages.New(servicePool)` | `users_custom_pages`, `users_custom_page_views`, `pages` (kind='user_custom') |
| `addressables` | `addressables.New(servicePool, ...)` | `pages_addressables`, `pages_help` |
| `usertaborder` | `usertaborder.New(servicePool)` | `users_tab_order` |
| `cspreport` | `cspreport.NewService(servicePool)` | `csp_reports` (columns now prefixed per `csp_reports_<col>` rule) |
| `costcentres` | `costcentres.NewService(servicePool)` | `cost_centres` |
| `lookups` | `lookups.NewService(servicePool)` | reads `users` |
| `pageaccess` | `pageaccess.New(servicePool, ...)` | `pages_access_version`, `pages`, `users_roles_pages` |
| `permissions.NewResolver` | `permissions.NewResolver(servicePool, ...)` | `users`, `users_permissions`, `users_roles_permissions` |
| `workspaces` | `workspaces.New(servicePool, auditLog, permResolver)` | `master_record_workspaces`, `users_roles_workspaces` (+ optional VAPool guard for cross-DB orphan checks against artefact tables) |
| `workspacemasterrecord` | `workspacemasterrecord.New(servicePool)` | `master_record_workspaces` (settings sidecar — FDW indirection retired, reads/writes the local table directly). The `FDWSubscriptionResolver` / `FDWActiveWorkspaceResolver` types keep the legacy name but their SQL now hits the local table. |
| `tenantmasterrecord` | `tenantmasterrecord.New(servicePool)` | `master_record_tenants` (subscription-tier defaults). |
| `audit` | `audit.New(servicePool)` + `auditLog.SetPool(vaPool)` | `audit_logs` |
| `notifications.NewPrefs` | `notifications.NewPrefs(servicePool)` | `users_notifications_prefs` |
| `notifications.NewService` | `notifications.NewService(servicePool, ...)` | `users_notifications`, `notifications_outbox` |
| `notifications.NewDBNotifier` | `notifications.NewDBNotifier(servicePool)` | `notifications_outbox` (transactional enqueue) |
| `notifications.NewRelay` | `notifications.NewRelay(servicePool, ...)` | outbox relay claim/mark loop |
| `dispatchers.NewInApp` | `dispatchers.NewInApp(servicePool, ...)` | `users_notifications` writes |
| `dispatchers.NewEmail` | `dispatchers.NewEmail(servicePool, ...)` | reads `users` for recipient address; writes `notifications_outbox` (delivery state) |
| `notifrules.NewService` | `notifrules.NewService(servicePool)` | `users_notification_rules` |
| `notifrules.NewEvaluator` | `notifrules.NewEvaluator(servicePool, ...)` | reads `users_notification_rules` |
| `notifrules.NewSchema` | `notifrules.NewSchema(vaPool)` | reads `artefacts_types` + `artefacts_types_fields` |
| `mentions` | `mentions.NewService(servicePool, vaPool, notifier)` | `users_mentions` (1st arg); also reads `artefacts*` via 2nd arg for context resolution. Both args point at vaPool post step 1. |
| `realtime.StartRankListener` | `realtime.StartRankListener(ctx, servicePool, hub)` | `LISTEN rank_changed` on `artefacts` trigger (vector_artefacts) |
| `realtime.StartSessionSweeper` | `realtime.StartSessionSweeper(ctx, servicePool, registry)` | reads `users_sessions` |
| `auth.OnLogin` (closure) | `servicePool.QueryRow(ctx, "SELECT subscriptions_tier FROM subscriptions WHERE subscriptions_id = $1", ...)` | reads `subscriptions` |
| `artefacttypes` | `artefacttypes.NewService(vaPool)` | `artefacts_types` |
| `artefactitems` | `artefactitems.NewService(vaPool, servicePool, "work"\|"strategy")` | `artefacts`, `artefacts_fields_values`. 2nd arg historically read mmff_vector for cross-DB joins; post step 1 both arguments target vector_artefacts. |
| `flows` | `flows.NewHandler(flows.New(vaPool, servicePool))` | `flows`, `flows_states`, `flows_transitions`, `flows_states_exit_rules`, `flows_defaults`, `flows_states_defaults`, `flows_transitions_defaults` |
| `fields` | `fields.NewService(servicePool, vaPool)` | `artefacts_fields_library`, `artefacts_types_fields`, `workspaces_fields` |
| `timeboxsprints` | `timeboxsprints.NewService(vaPool)` | `timeboxes_sprints` |
| `timeboxreleases` | `timeboxreleases.NewService(vaPool)` | `timeboxes_releases` |
| `timeboxmilestones` | `timeboxmilestones.NewService(vaPool)` | `timeboxes_milestones` |
| `ranking` | `ranking.New(vaPool)` | rank-listener channel + `position` columns on VA tables |
| `search` | `search.New(vaPool)` | search index + outbox reads |
| `searchworker` | `searchworker.New(vaPool, swCfg)` | indexer consumer; reads outbox, writes index |
| `webhooks` | `webhooks.New(vaPool)` | `webhooks_subscriptions`, `webhooks_deliveries` |
| `topology` | `topology.New(servicePool, vaPool).WithNotifier(...)` | `topology_nodes`, `topology_view_states`, `users_roles_topology_nodes`, `topology_commits`. The legacy "membership/auth" pool slot also targets vector_artefacts post step 1. |
| `portfolio` (master record) | `portfolio.NewService(vaPool).WithVectorPool(servicePool)` | `master_record_portfolios`, `master_record_tenants` |
| `portfoliomodels.NewService` | `portfoliomodels.NewService(libPools.RO, servicePool, nil)` | adoption-state reads (vaPool wired later via `WithVAPool`) |
| `portfoliomodels.NewAdoptHandler` | `portfoliomodels.NewAdoptHandler(libPools.RO, servicePool, vaPool, masterRecordSvc)` | adopt saga |
| `portfoliomodels.NewResyncHandler` | `portfoliomodels.NewResyncHandler(libPools.RO, servicePool, vaPool)` | re-sync from adopted bundle |
| `portfoliomodels.NewAdoptionStateHandler` | `portfoliomodels.NewAdoptionStateHandler(servicePool, vaPool)` | read-side state for `/dev` adoption |
| `portfoliomodels.NewDevResetHandler` | `portfoliomodels.NewDevResetHandler(servicePool, vaPool, orgDesignSvc)` | dev reset for both pools |
| `sentinel.NewPoolResolver` | `sentinel.NewPoolResolver(servicePool, servicePool)` | reads `topology_nodes`, `master_record_workspaces`, `users_roles_workspaces`, `users` (all in vaPool post step 1) |
| `workspaceresolver.NewPoolResolver` | `workspaceresolver.NewPoolResolver(vaPool, vaPool)` | reads `topology_nodes`, `users_roles_workspaces`, `master_record_workspaces` |
| `errorsreport` | `errorsreport.NewService(libPools.RO, servicePool)` | reads `errors_codes` from mmff_library; writes `errors_events` to vector_artefacts |
| `libraryreleases` | `libraryreleases.NewService(libPools.RO, servicePool, servicePool)` + `SetAcksPool(vaPool)` | reads `subscriptions.subscriptions_tier`; writes `library_releases_acknowledgements`. All three pool slots target vector_artefacts post step 1. |
| `libraryreleases.NewReconciler` | `libraryreleases.NewReconciler(libPools.RO, servicePool)` + `SetAcksPool(vaPool)` | refresh-time recounts |

### Services on `libPools` (mmff_library)

Unchanged by Pillar 3.

| Service | Constructor line | Owns / reads |
|---|---|---|
| `librarydb` | `librarydb.New(ctx)` | Read-only bundle fetch: `library_strategy_layers`, `library_artefact_types`, `library_flows`, etc. |
| `librarydb` (releases helpers) | `ListReleasesSinceAck/AckRelease/CountOutstandingForSubscription/loadAckedSet` | Reads `library_releases` from `libPools`; reads + writes `library_releases_acknowledgements` on `acksPool` (= vaPool). |

## How to verify a feature's DB before querying

1. **Find the handler.** `grep -rn '<route-or-table-name>' backend/internal/`.
2. **Find the constructor.** Inside `backend/cmd/server/main.go`, find `<service>.New*(...)` and note the pool argument(s).
3. **Look up the pool here.** After Pillar 3 step 1 the answer is almost always `vector_artefacts`. The only exceptions are `mmff_library` (read-only library spine) and `mmff_dev` (dev_reports).
4. **Run psql with the matching `-d <dbname>` flag.** Connection string is always `host=localhost port=5435 user=mmff_dev` on dev; only the DB name changes.

## Common confusions to avoid

- The legacy `obj_*` tables are GONE — they never existed in vector_artefacts and the mmff_vector copies were retired pre-Pillar 2.
- The internal struct field is still named `pool` (e.g. `s.pool` in `Service`); the VALUE it holds is `servicePool` = vaPool. Don't rename the fields in this wave — it's mechanical churn for no behaviour change.
- `subscriptions` and `master_record_workspaces` lived in mmff_vector pre-Pillar-2; they are now natively in vector_artefacts (no FDW indirection). The `workspacemasterrecord.FDWSubscriptionResolver` type name is a misnomer post step 1 — the underlying SQL is a local-table read.
- `mmff_dev` is the cutover's institutional memory and is NEVER part of the tenant-pool repoint. Wipe-and-reseed plans MUST NOT touch this DB.

## Cross-references

- Schema golden source for `mmff_vector` (zombie) → [`c_schema.md`](c_schema.md).
- vector_artefacts cutover plan → [`c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md).
- Library bundle fetch contract → [`c_c_librarydb_fetch.md`](c_c_librarydb_fetch.md).
- Tenant isolation invariants → [`c_schema.md`](c_schema.md) (tenant-id sections).
- Pillar 3 handover → [`../handovers/refactorDB.md`](../handovers/refactorDB.md).
