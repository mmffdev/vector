# Vector — Product Scope & Feature Tracker

**Created:** 2026-05-08
**Last updated:** 2026-05-09 (B21 added — Artefact-items substrate, PLA-0037; rename `workitemsv2` → `artefactitemsv2`, scope-parameterised; B15.2.5 sidecar wizard JSON pattern)
**Doc version:** 2.0

---

## Table of Contents

**M — v2 Migration** *(build order: easiest → hardest)*

- [M1. Flows](#m1-flows)
- [M2. Tenant Settings](#m2-tenant-settings)
- [M3. Defects](#m3-defects)
- [M4. User Stories](#m4-user-stories)
- [M5. Portfolio Items](#m5-portfolio-items)
- [M6. Topology](#m6-topology)

**B — Product Features**

- [B1. Core Work Item Engine](#b1-core-work-item-engine)
- [B2. Sprint &amp; Timebox Management](#b2-sprint--timebox-management)
- [B3. Portfolio &amp; Master Record](#b3-portfolio--master-record)
- [B4. Custom Fields](#b4-custom-fields)
- [B5. Roles &amp; Permissions (RBAC)](#b5-roles--permissions-rbac)
- [B6. Workspace &amp; Topology](#b6-workspace--topology)
- [B7. Search](#b7-search)
- [B8. Public API &amp; Integrations](#b8-public-api--integrations)
- [B9. Webhooks](#b9-webhooks)
- [B10. Async Jobs &amp; Reporting](#b10-async-jobs--reporting)
- [B11. Real-Time &amp; Async Push](#b11-real-time--async-push)
- [B12. n8n Integration](#b12-n8n-integration)
- [B13. Library &amp; Portfolio Models](#b13-library--portfolio-models)
- [B14. Addressables &amp; Page Help](#b14-addressables--page-help)
- [B15. UI Primitives &amp; Design System](#b15-ui-primitives--design-system)
- [B16. Security &amp; Auth](#b16-security--auth)
- [B17. Infrastructure &amp; DevOps](#b17-infrastructure--devops)
- [B18. Developer Experience](#b18-developer-experience)
- [B19. Work Item Relations Graph](#b19-work-item-relations-graph)
- [B20. User Access Rights &amp; Navigation Control](#b20-user-access-rights--navigation-control)
- [B21. Artefact-Items Substrate (PLA-0037)](#b21-artefact-items-substrate-pla-0037)

---

## M1. Flows

Workflow definitions and states for work items. Currently reads from `obj_flow_tenant` in the old database (`mmff_vector`). The new database already has the correct tables (`flows`, `flow_states`, `flow_transitions`) — the data needs copying across and the handler switching over. Plan: [PLA-0031](dev/plans/PLA-0031.json)

### ✅ ~~M1.1 API — Register `/flows` on v2~~

- ✅ **M1.1.1** Register `GET /flows` under `/samantha/v2` in `main.go` `[P2]`
  `[✓] M1.2.3 Service rewritten → [✓] M1.2.4 Query rewritten → [ ] M1.3.3 ETL verified (pending dev run)`
- ✅ **M1.1.2** Remove `GET /flows` from `/samantha/v1` block `[P2]`
  `[✓] M1.1.1 v2 route registered`
- ✅ **M1.1.3** Update `openapi-v2.yaml` with `/flows` path spec `[P2]`
  `[✓] M1.1.1 v2 route live`
- ✅ **M1.1.4** Switch frontend caller (`workspace-settings/work-items/page.tsx`) from `api('/flows/')` to `apiV2('/flows/')` `[P2]`
  `[✓] M1.1.1 v2 route live → [✓] M1.1.3 spec updated`

### ✅ ~~M1.2 New Database — `vector_artefacts`~~

- ✅ **M1.2.1** `flows` table already exists — verify `artefact_type_id`, `name`, `is_default`, `archived_at` columns are sufficient `[P2]`
  `[✓] 004_flows.sql applied — all required columns confirmed`
- ✅ **M1.2.2** `flow_states` table already exists — verify `flow_id`, `name`, `kind`, `sort_order`, `is_initial` columns are sufficient `[P2]`
  `[✓] 004_flows.sql applied — all required columns confirmed`
- ✅ **M1.2.3** Rewrite `flows.Service` constructor to accept `vectorArtefactsPool` instead of `pool` `[P2]`
  `[✓] M1.2.1 flows table verified → [✓] M1.2.2 flow_states table verified`
- ✅ **M1.2.4** Rewrite `ListBySubscription` query to read from `flows JOIN artefact_types` scoped by `workspace_id` `[P2]`
  `[✓] M1.2.3 Service constructor rewritten → [ ] M1.3.3 ETL run and verified (pending dev run)`

### M1.3 Old Database — `mmff_vector`

- ✅ **M1.3.1** Map `obj_flow_tenant` columns to `flows`/`flow_states` — document the `subscription_id → workspace_id` translation and the three polymorphic FK variants (system / tenant / portfolio) `[P2]`
  *(captured in etl_flows.sql column map header)*
- ✅ **M1.3.2** Write ETL script: read `obj_flow_tenant` rows, resolve `artefact_type_id` via `artefact_types`, insert into `flows` + `flow_states` in `vector_artefacts` `[P2]`
  `[✓] M1.3.1 Column map complete → [✓] M1.2.1 flows table verified → [✓] M1.2.2 flow_states table verified`
- ✅ ~~**M1.3.3** Run ETL on dev DB; verify row counts and spot-check data `[P2]`~~
  > Run 2026-05-08 via FDW (both DBs on same server). 21 total flow_states in VA: Defect/Epic/Story/Task have seeded 4-state flows (To Do→In Progress→Done→Cancelled) kept as-is; Feature populated with 5 legacy states (Backlog→Ready→Doing→Completed→Accepted). Strategy types empty — no legacy data. 4 source type_labels (Defect State, Portfolio Item, Test Case, Work Item) had no VA artefact_types match and were skipped. ETL script updated: `backlog`/`doing` canonical codes added, "empty flows only" guard added. FDW tables `fdw_obj_flow_tenant_full`, `fdw_obj_execution_types`, `fdw_obj_strategy_types`, `fdw_obj_execution_types_tenant` created in vector_artefacts.
  > Last checked: 2026-05-08
  >
- ✅ **M1.3.4** Retain `mmff_vector` pool in handler for tenancy gate only (membership check) — do not remove pool reference entirely `[P2]`
  `[✓] M1.2.3 Service rewritten → [✓] M1.2.4 Query rewritten`

---

## M2. Tenant Settings

Org-level configuration — name, branding, timezone. `master_record_tenant` now exists in both `mmff_vector` (source) and `vector_artefacts` (target). Service rewired. Pending: ETL run on dev DB. Plan: [PLA-0032](dev/plans/PLA-0032.json)

### M2.1 API — `/tenant-settings` route

- ✅ **M2.1.1** Route already at `/api/tenant-settings` — not under `/samantha/v1`; no v2 registration needed `[P2]`
  > Mounted independently in `main.go`; outside the deprecation path
  >
- ❌ NFA **M2.1.2** Remove from `/samantha/v1` — N/A, was never under v1
- ❌ NFA **M2.1.3** `openapi-v2.yaml` spec update — N/A, route is outside v2 block
- ❌ NFA **M2.1.4** Switch `api()` → `apiV2()` — N/A, route path unchanged

### ✅ ~~M2.2 New Database — `vector_artefacts`~~

- ✅ **M2.2.1** Design `master_record_tenant` in `vector_artefacts` — `workspace_id` PK (bare UUID, same pattern as `artefacts`) `[P2]`
  > 17 columns from mmff_vector post-mig-127/128; 3 feature-flag cols dropped (not in service model)
  >
- ✅ **M2.2.2** Write migration `036_master_record_tenant.sql` `[P2]`
  `[✓] M2.2.1 Table designed` — `db/artefacts_schema/036_master_record_tenant.sql`
- ✅ **M2.2.3** Rewrite `tenantsettings.Service` to use `vaPool` `[P2]`
  `[✓] M2.2.2 Migration written` — queries updated to `workspace_id` PK; cross-DB owner-user existence check removed (trust-caller)
- ✅ **M2.2.4** All queries rewritten for `vector_artefacts.master_record_tenant` `[P2]`
  `[✓] M2.2.3 Service rewritten` — `main.go` passes `vaPool` (falls back to `pool` until mig 036 applied on dev)

### M2.3 Old Database — `mmff_vector`

- ✅ **M2.3.1** Audit `master_record_tenant` columns — 17 columns map 1:1; only rename is `tenant_id → workspace_id` `[P2]`
  > Column map in `dev/scripts/etl_tenant_settings.sql` header
  >
- ✅ **M2.3.2** Write ETL script `[P2]`
  `[✓] M2.3.1 Audit complete → [✓] M2.2.2 Migration written` — `dev/scripts/etl_tenant_settings.sql`; idempotent `ON CONFLICT DO UPDATE`
- ✅ ~~**M2.3.3** Run ETL on dev DB; verify row counts `[P2]`~~
  > Run 2026-05-08 via FDW. Migration 036 applied. 1 row upserted (workspace_id `000...001`, tenant "MMFFDev New Schema", tz Europe/London, workdays {mon–fri}). `fdw_master_record_tenant` created in vector_artefacts.
  > Last checked: 2026-05-08
  > `[✓] M2.3.2 ETL script written`
  >
- ✅ **M2.3.4** `mmff_vector` pool retained for auth/membership; tenant settings now on `vaPool` `[P2]`
  `[✓] M2.2.3 Service rewritten → [✓] M2.2.4 Queries rewritten`

---

## M3. Defects

Bug/defect work items. Currently a standalone table (`defects`) in the old database. Rather than migrating like-for-like, defects consolidate into the unified `artefacts` table as a typed artefact — then served through `/work-items` filtered by type. The `/defects` endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### M3.1 API — Retire `/defects`, serve via `/work-items`

- **M3.1.1** Verify `GET /work-items?artefact_type=<defect-type-id>` returns defects post-ETL `[P2]`
  `[ ] M3.2.1 Defect type seeded → [ ] M3.3.3 ETL verified → [ ] M3.2.3 /work-items returns defects`
- ✅ **M3.1.2** Remove `GET/POST/PUT/DELETE /defects` from `/samantha/v1` block in `main.go` `[P2]`
  > Done 2026-05-09 — route block removed; `defectsSvc`/`defectsH` constructors removed; `defects` package import removed; `go build` clean.
- ✅ **M3.1.3** Mark `/defects` as `deprecated: true` in `openapi.yaml` `[P2]`
  > Done 2026-05-09 — `deprecated: true` added to POST `/defects`, GET/PATCH/DELETE `/defects/{id}`.
- ✅ **M3.1.4** Update any frontend callers of `api('/defects')` — switch to `apiV2('/work-items')` with type filter `[P2]`
  `[✓] Audit complete — zero frontend callers of api('/defects') found; no switch needed`

### M3.2 New Database — `vector_artefacts`

- ✅ **M3.2.1** Seed `artefact_types` row for `Defect` (name, description, workspace scope) `[P2]`
  `[✓] M3.3.1 Column audit complete` — Defect type (prefix=DE, scope=work, source=system) already seeded by seed_system_artefact_types() (migration 010); migration 027 ensures field bindings
- ✅ **M3.2.2** Seed `artefact_field_library` entries for any defect-specific columns that have no native artefact equivalent `[P2]`
  `[✓] M3.3.1 Column audit complete → [✓] M3.2.1 Defect type seeded` — 17 fields seeded in db/artefacts_schema/027_seed_defect_field_library.sql with artefact_type_fields bindings
- **M3.2.3** Verify `/work-items` handler returns defect artefacts with correct field values `[P2]`
  `[✓] M3.2.1 Type seeded → [✓] M3.2.2 Field library seeded → [✓] M3.3.3 ETL run and verified`

### M3.3 Old Database — `mmff_vector`

- ✅ **M3.3.1** Audit `defects` table columns — map each to `artefacts` native columns or `artefact_field_values` `[P2]`
  > Audit complete — column map documented in db/artefacts_schema/027_seed_defect_field_library.sql and dev/scripts/etl_defects.sql headers
  >
- ✅ **M3.3.2** Write ETL script: insert `defects` rows into `artefacts` (type=Defect) + `artefact_field_values` `[P2]`
  `[✓] M3.3.1 Column audit complete → [✓] M3.2.1 Type seeded → [✓] M3.2.2 Field library seeded` — script at dev/scripts/etl_defects.sql
- ✅ **M3.3.3** Run ETL on dev DB; compare row counts and spot-check field values `[P2]`
  Migration 027 applied (17 defect fields seeded); `timebox_sprint_id` column name fix applied to ETL script; FDW (`fdw_defects`) created in vector_artefacts; ETL ran cleanly — 0 source rows in dev DB (schema validated), 2 pre-existing DE artefacts unchanged.
- ✅ **M3.3.4** Delete `backend/internal/defects/` package once endpoint is removed `[P3]`
  > Done 2026-05-09 — package directory removed; `go build ./...` clean; no remaining package references in backend.

---

## M4. User Stories

User story work items. Same consolidation pattern as defects — `user_stories` table in old DB collapses into `artefacts`, endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### M4.1 API — Retire `/user-stories`, serve via `/work-items`

- ✅ **M4.1.1** Verify `GET /work-items?artefact_type=<user-story-type-id>` returns user stories post-ETL `[P2]`
  Verified 2026-05-08: `GET /samantha/v2/work-items?item_type=story` → total=5705, item_type=story, flow_state attached. Filter param is `item_type` (not `artefact_type`). All correct.
- ✅ **M4.1.2** Remove `/user-stories` from `/samantha/v1` block in `main.go` `[P2]`
  Route block, handler init, and `userstories` import all removed. Build clean.
- ✅ **M4.1.3** Mark `/user-stories` as `deprecated: true` in `openapi.yaml` `[P2]`
  All 4 operations (POST, GET, PATCH, DELETE) marked `deprecated: true` in openapi.yaml.
- ✅ **M4.1.4** Update any frontend callers of `api('/user-stories')` `[P2]`
  > Frontend audit (2026-05-08): no direct `api('/user-stories')` calls found in `app/`. The string `execution_user_stories` appears only as a TypeScript type discriminator in `app/lib/samantha.ts` (not an API call). No frontend changes required.
  >

### M4.2 New Database — `vector_artefacts`

- ✅ **M4.2.1** Seed `artefact_types` row for `User Story` `[P2]`
  `[✓] M4.3.1 Column audit complete` — US type already present as "Story"/prefix=US from seed_system_artefact_types(); mig 034 WHERE NOT EXISTS guard skipped insert correctly.
- ✅ **M4.2.2** Seed `artefact_field_library` entries for user-story-specific columns `[P2]`
  23 `us_*` fields seeded (mig 034 field-library section, run 2026-05-08); options_json set for schedule_state, risk_impact, risk_probability.
- ✅ **M4.2.3** Verify `/work-items` returns user story artefacts with correct field values `[P2]`
  Verified 2026-05-08: 5705 stories returned with correct item_type, flow_state_id/name/code, parent linkage, and owner fields. EAV field values (us_* fields) not yet spot-checked — seeded data has none but schema is correct.

### M4.3 Old Database — `mmff_vector`

- ✅ **M4.3.1** Audit `user_stories` table columns — map each to `artefacts` or `artefact_field_values` `[P2]`
  > Audit complete — 13 native columns, 23 EAV fields. See `db/artefacts_schema/034_seed_user_story_type.sql` column-map comment block.
  >
- ✅ **M4.3.2** Write ETL script: insert `user_stories` rows into `artefacts` (type=User Story) `[P2]`
  `[✓] M4.3.1 Column audit complete → [✓] M4.2.1 Type seeded → [✓] M4.2.2 Field library seeded`
- ✅ **M4.3.3** Run ETL on dev DB; verify row counts and field values `[P2]`
  Run 2026-05-08 via FDW. Mig 026/027/034 applied (034 field-library-only — US type already seeded as "Story"/prefix=US). ETL ran cleanly — 0 source rows in dev (schema validated), 6 pre-existing US artefacts unchanged. Two fixes found and applied: workspace join (`master_record_workspaces` DISTINCT ON, no `is_default`); explicit NULL casts in field_values UNION ALL. `fdw_user_stories` foreign table created in vector_artefacts.
- ✅ **M4.3.4** Delete `backend/internal/userstories/` package once endpoint is removed `[P3]`
  Package retained (code still valid Go) — can be deleted in a separate cleanup pass alongside M3.3.4 (defects package). Endpoint removed; package is now dead code.

---

## M5. Portfolio Items

Portfolio-scoped work items (`obj_portfolio_items`). Same consolidation pattern — collapses into `artefacts`, endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### ✅ ~~M5.1 API — Retire `/portfolio-items`, serve via `/work-items`~~

- ✅ **M5.1.1** Verify `GET /work-items?item_type=portfolio+item` returns portfolio items post-ETL `[P2]`
  `[✓] M5.2.1 Portfolio Item type seeded → [✓] M5.3.3 ETL verified → [✓] M5.2.3 /work-items returns portfolio items`
  Note: PI scope changed to `work` (from `strategy`) so the work-items handler serves it. `portfolio item` added to `validItemTypes` in `workitemsv2/types.go`.
- ✅ **M5.1.2** Remove `/portfolio-items` from `/samantha/v1` block in `main.go` `[P2]`
  `[✓] M5.1.1 /work-items verified as replacement` — import, svc, handler, and route block all removed.
- ✅ **M5.1.3** Mark `/portfolio-items` as `deprecated: true` in `openapi.yaml` `[P2]`
  `[✓] M5.1.1 /work-items verified as replacement` — all 4 operations marked deprecated.
- ✅ **M5.1.4** Update any frontend callers of `api('/portfolio-items')` `[P2]`
  `[✓]` — No-op: `app/(user)/portfolio-items/page.tsx` is a placeholder with no `api()` calls.

### ✅ ~~M5.2 New Database — `vector_artefacts`~~

- ✅ **M5.2.1** Seed `artefact_types` row for `Portfolio Item` `[P2]`
  `[✓] M5.3.1 Column audit complete` — done in `db/artefacts_schema/030_seed_portfolio_item_type.sql`
- ✅ **M5.2.2** Seed `artefact_field_library` entries for portfolio-item-specific columns `[P2]`
  `[✓] M5.3.1 Column audit complete → [✓] M5.2.1 Portfolio Item type seeded` — 22 `pi_*` fields + `artefact_type_fields` bindings in 030 migration
- ✅ **M5.2.3** Verify `/work-items` returns portfolio item artefacts with correct field values `[P2]`
  `[✓] M5.2.1 Type seeded → [✓] M5.2.2 Field library seeded → [✓] M5.3.3 ETL run and verified` — 0 source rows in dev; endpoint responds correctly for `item_type=portfolio+item`.

### ✅ ~~M5.3 Old Database — `mmff_vector`~~

- ✅ **M5.3.1** Audit `obj_portfolio_items` columns — map each to `artefacts` or `artefact_field_values` `[P2]`
  Column map documented in `db/artefacts_schema/030_seed_portfolio_item_type.sql` header. 12 native columns, 22 custom fields, 8 computed rollup columns excluded.
- ✅ **M5.3.2** Write ETL script: insert `obj_portfolio_items` rows into `artefacts` (type=Portfolio Item) `[P2]`
  `[✓] M5.3.1 Column audit complete → [✓] M5.2.1 Type seeded → [✓] M5.2.2 Field library seeded` — `dev/scripts/etl_portfolio_items.sql`
- ✅ **M5.3.3** Run ETL on dev DB; verify row counts and field values `[P2]`
  `[✓] M5.3.2 ETL script written` — FDW-based ETL ran; 0 source rows in dev (expected); schema compatible. `fdw_portfolio_items` foreign table created.
- ✅ **M5.3.4** Delete `backend/internal/portfolioitems/` package once endpoint is removed `[P3]`
  `[✓] M5.1.2 /portfolio-items v1 endpoint removed` — package deleted. `userstories` package also deleted (M4.3.4).

---

## M6. Topology

The org chart canvas — a tree of nodes representing offices, teams, and roles. The most complex migration: the tree is self-referential (each node points to its parent by ID), so copying must preserve the exact structure. Three new tables needed in `vector_artefacts`: `topology_nodes`, `topology_role_grants`, `topology_view_state`. Plan: [PLA-0034](dev/plans/PLA-0034.json)

### ✅ ~~M6.1 API — Register `/topology` on v2~~

- ✅ **M6.1.1** Register full CRUD for `/topology` under `/samantha/v2` in `main.go` `[P2]`
  > Done 2026-05-09 — topology block moved from root `/api` into `/samantha/v2`; `orgDesignH` wired; `go build` clean.
- ✅ **M6.1.2** Remove `/topology` from `/samantha/v1` block `[P2]`
  > Done 2026-05-09 — topology was at root `/api` level (not v1); removed from root as part of M6.1.1 move.
- ✅ **M6.1.3** Update `openapi-v2.yaml` with `/topology` path specs `[P2]`
  > Done 2026-05-09 — topology tag + 14 path entries + 4 schemas added; YAML validates clean.
- ✅ **M6.1.4** Switch `app/lib/topologyApi.ts` calls from `api()` to `apiV2()` `[P2]`
  > Done 2026-05-09 — all calls switched to `apiV2()`; `setViewState` reshaped to viewport coords; `OrgLevel` type and levels methods removed; `level_id` dropped from `OrgNode`; no TS errors.
- ✅ **M6.1.5** Audit topology components (`TopologyTreeFlyout`, `useTopologyData`, `useTopologyHandlers`, etc.) for any remaining `api()` calls `[P2]`
  > Done 2026-05-09 — grep confirms no remaining `api()` / `OrgLevel` / `level_id` references in frontend.

### ✅ ~~M6.2 New Database — `vector_artefacts`~~

- ✅ **M6.2.1** Design `topology_nodes` table — `workspace_id` tenancy, `parent_id` self-FK, spatial fields (`x`, `y`, `width`, `height`) `[P2]`
  > **START HERE →** can design in parallel with M6.3.1 audit
  >
- ✅ **M6.2.2** Design `topology_role_grants` table — links RBAC roles to topology nodes (soft FK to `roles` if not yet in `vector_artefacts`) `[P2]`
  `[✓] M6.2.1 topology_nodes designed (need PK/FK refs)`
- ✅ **M6.2.3** Design `topology_view_state` table — per-user canvas viewport (acceptable to reset on cutover) `[P2]`
  `[✓] M6.2.1 topology_nodes designed (need PK/FK refs)`
- ✅ **M6.2.4** Write migration `031_topology_nodes.sql` `[P2]`
  `[✓] M6.2.1 Table designed`
- ✅ **M6.2.5** Write migration `032_topology_role_grants.sql` `[P2]`
  `[✓] M6.2.2 Table designed → [✓] M6.2.4 Migration applied (FK dependency)`
- ✅ **M6.2.6** Write migration `033_topology_view_state.sql` `[P2]`
  `[✓] M6.2.3 Table designed → [✓] M6.2.4 Migration applied (FK dependency)`
- ✅ **M6.2.7** Rewrite `orgdesign.Service` to query `vectorArtefactsPool` `[P2]`
  > Done 2026-05-09 — dual-pool pattern (`pool` mmff_vector for auth, `vaPool` vector_artefacts for all topology I/O); `levels.go` deleted; column renames applied; `SetViewState` reshaped to viewport coords; `go build` clean; `go test ./internal/orgdesign/...` passed.

### ✅ ~~M6.3 Old Database — `mmff_vector`~~

- ✅ **M6.3.1** Audit `org_nodes` columns — confirm `subscription_id → workspace_id` mapping `[P2]`
  > **START HERE →** unblocked, no prerequisites
  >
- ✅ **M6.3.2** Write ETL script for `org_nodes → topology_nodes` — retain original UUIDs so `parent_id` links survive intact `[P2]`
  `[✓] M6.3.1 Column audit complete → [✓] M6.2.4 Migration applied`
- ✅ **M6.3.3** Write ETL script for `roles_org_nodes → topology_role_grants` — resolve `role_id` cross-DB reference `[P2]`
  `[✓] M6.3.2 topology_nodes ETL written (need FK refs) → [✓] M6.2.5 Migration applied`
- ✅ **M6.3.4** Write ETL script for `org_node_view_state → topology_view_state` — reset decision documented `[P2]`
  `[✓] M6.3.2 topology_nodes ETL written (need FK refs) → [✓] M6.2.6 Migration applied`
- ✅ **M6.3.5** Run all three ETLs on dev DB; walk the tree to verify parent/child integrity `[P2]`
  > Done 2026-05-09 — 58 topology nodes migrated (1 root, max depth 6, 0 orphans); 0 role grants (dev DB has none); `topology_view_state` intentionally empty (viewport reset on cutover).
- ✅ **M6.3.6** Retain `mmff_vector` pool for membership check only `[P2]`
  > Done 2026-05-09 — `pool` used only for subscription/membership queries; all topology I/O via `vaPool`.

---

## B1. Core Work Item Engine

Full lifecycle management for tasks, bugs, epics.

- ✅ ~~**B1.1** Full CRUD on work items (v2 — `vector_artefacts`)~~
- ✅ ~~**B1.2** Bulk operations — atomic update up to N items at once~~

  > `POST /api/v2/work-items/bulk` live — `handler.go:317`, `types.go:290`
  >
- ✅ ~~**B1.3** Parent/child hierarchy — items nested under epics~~

  - ✅ ~~**B1.3.1** `GET /work-items/{id}/children` — full descendant list with depth~~

  > `handler.go:120`, `service.go:279` — `children_count` on all item responses
  >
- **B1.4** State machine enforcement — reject invalid flow-state transitions at the API `[P2]`

  > `flow_state_id` accepted on update but no transition validation against `flow_transitions` table yet — `flow_transitions` table exists but is not queried by the update path
  > Last checked: 2026-05-08
  >
- ✅ ~~**B1.5** Ranking / drag-drop reorder~~
- ✅ ~~**B1.6** Field values on items (`field_values` on item response)~~

  > `GET /api/v2/work-items/{id}/field-values` live — `handler.go:341`
  >
- **B1.7** Work item templates `[P4]`
- **B1.8** Blocked-state — orthogonal stuck flag with provenance `[P2]`
  > Blocked is its own state, **independent of flow state** — an item can be blocked at any point in its workflow. The fact a story is "stuck on dev" tells us nothing about why; the blocked record carries that context. Schema (work-item columns, all nullable except `is_blocked` boolean):
  > - `is_blocked` `BOOLEAN NOT NULL DEFAULT FALSE` — convenience flag for indexing/filters
  > - `blocked_id` `UUID` — surrogate id for the active blocker record (so history can be added later without schema churn)
  > - `blocked_title` `TEXT` — short label, e.g. "Waiting on legal review"
  > - `blocked_description` `TEXT` — free-form detail
  > - `blocked_reason` `TEXT` — short categorisation (later: enum/lookup once patterns emerge)
  > - `blocked_user_reporter` `UUID` — who flagged it blocked
  > - `blocked_user_unblocked` `UUID` — who cleared the block (null while still blocked)
  > - `blocked_date_blocked` `TIMESTAMPTZ` — when the block was raised
  > - `blocked_date_unblocked` `TIMESTAMPTZ` — when the block was cleared (null while still blocked)
  >
  > **Sub-items below.** Webhook event `item.blocked` is a downstream consumer (B1.8.5).
  >
  - **B1.8.1** Migration — add `blocked_*` columns to `artefacts` table `[P2]`
    > Single migration in `db/artefacts_schema/`; index on `(workspace_id, is_blocked) WHERE is_blocked = TRUE` for fast unblocked-list queries.
    >
  - **B1.8.2** Backend — `Block` / `Unblock` service methods on `workitemsv2/service.go` `[P2]`
    > `Block(ctx, subID, itemID, BlockInput)` sets all `blocked_*` fields + `is_blocked=TRUE`, fires `item.blocked` notifier. `Unblock(ctx, subID, itemID)` sets `blocked_user_unblocked` + `blocked_date_unblocked`, flips `is_blocked=FALSE`, fires `item.unblocked`. Both operations leave flow_state_id untouched.
    >
  - **B1.8.3** API routes — `POST /work-items/{id}/block` and `POST /work-items/{id}/unblock` `[P2]`
    > Mounted on v2; OpenAPI spec updated. `block` body: `{title, description, reason}`; `unblock` body: `{}` (server fills user + timestamp).
    >
  - **B1.8.4** UI — block/unblock action on work-item detail panel + visual marker `[P2]`
    > Button on `WorkItemDetailPanel.tsx`; opens small form (title required, description + reason optional). When blocked: panel shows red banner with reporter + date; tree row shows red dot/badge. Unblock action records `blocked_user_unblocked` automatically.
    >
  - **B1.8.5** Webhook event wiring — `item.blocked` + `item.unblocked` `[P3]`
    > Notifier already lists `item.blocked` in `WebhookForm.tsx` dropdown. Add `item.unblocked` to dropdown. Backend fires both from B1.8.2 service methods. (Replaces deferred B9.7 wiring task — track here.)
    >
  - **B1.8.6** Reports — blocked-time on cycle/lead time and "currently blocked" filter `[P3]`
    > Cycle-time/lead-time reports subtract blocked windows. List views get `blocked = true/false` filter. Blocked items surface at the top of stale-work reports.
    >

---

## B2. Sprint & Timebox Management

- ✅ ~~**B2.1** Sprint CRUD — full v2 including create, edit, delete (PLA-0027 + PLA-0030 T2)~~
- ⚠️ **B2.2** Sprint lifecycle (`planning` → `active` → `closed`) `[P2]`

  > `POST /{id}/start` (planned→active) and `POST /{id}/close` (active→completed) are live with atomic UPDATE guards and `ErrStartLifecycle`/`ErrCloseLifecycle` errors. `PATCH` body can still set status freely — B2.2.2 (item-state validation) remains open.
  > Last checked: 2026-05-08
  >

  - ✅ ~~**B2.2.1** `POST /sprints/{id}/start` + `/close` explicit lifecycle actions `[P2]`~~
    > Commit (2026-05-08): `Start`/`Close` on service + handler; `ErrStartLifecycle`/`ErrCloseLifecycle`; notifier fires `sprint.started`/`sprint.closed`; routes wired under `WorkItemsSettingsEdit` permission.
    >
  - **B2.2.2** Validate item state before adding to active sprint `[P3]`
- **B2.3** Sprint goal field `[P3]`
- **B2.4** Sprint velocity tracking `[P3]`
- **B2.5** Burndown snapshot (`GET /sprints/{id}/burndown?date=`) `[P3]`
- **B2.6** Active sprint summary per workspace `[P3]`
- **B2.7** Releases timebox kind `[P4]`

---

## B3. Portfolio & Master Record

- ✅ ~~**B3.1** Master record (`/portfolio/master_record`) — v2 live~~
- ✅ ~~**B3.2** Portfolio layers (`/workspace/{id}/portfolio/layers`) — v2 live~~
- **B3.3** Portfolio items — retiring, consolidating into work items (see M5) `[P3]`
- **B3.4** Subscription layers — legacy, retire once frontend migrated to workspace-scoped v2 `[P3]`
- **B3.5** Portfolio adoption cutover (PLA-0024 / PLA-0026) `[P2]`
- **B3.6** Portfolio models — architectural decision pending (PLA-0030 T6) `[P4]`

---

## B4. Custom Fields

- ⚠️ **B4.1** Custom field library — define field types and options `[P2]`
  > Schema exists (`artefact_field_library`, `artefact_type_fields`), seeding scripts written for DE/US/PI types, and `GET /workspace/{id}/fields` resolver is live. Missing: no UI field manager to add/edit/delete fields without SQL. API-only today.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B4.2** Field schema endpoint (`/workspace/{id}/fields`) — v2 live~~
- ✅ ~~**B4.3** Field values on work item responses~~
  > `ListFieldValues`, `UpsertFieldValues`, `DeleteFieldValue` all live in `backend/internal/workitemsv2/handler.go` — `GET/PUT/DELETE /work-items/{id}/field-values`
  > Last checked: 2026-05-08
  >
- **B4.4** Custom field manager UI `[P3]`
- **B4.5** Item templates with field defaults `[P4]`

---

## B5. Roles & Permissions (RBAC)

- ✅ ~~**B5.1** Data-driven RBAC — `roles` / `permissions` / `roles_permissions` tables~~
  > `backend/internal/roles/service.go` + `permissions/` — full service live
  >
- ✅ ~~**B5.2** 5 seeded system roles (gadmin / padmin / team_lead / user / external)~~
  > Stable UUIDs `ad30/ad25/ad20/ad10/ad05` confirmed in `roles/service.go:31-35`
  >
- ✅ ~~**B5.3** 26 seeded permissions~~
  > `backend/internal/permissions/catalogue.go` — full permission catalogue live
  >
- ✅ ~~**B5.4** `useHasPermission(<code>)` frontend gate~~
  > `app/contexts/AuthContext.tsx:183` — canonical gate; used in multiple components
  >
- **B5.5** Custom role creation and assignment `[P3]`
- **B5.6** Replace stop-gap permission codes with precise codes (TD-PERM-001) `[P3]`
- **B5.7** `api_keys.manage` permission — not yet wired to API key routes `[P3]`
- **B5.8** Capability matrix — single transparent view of role × permission grants `[P2]`
  > Today the answer to "what can padmin do?" is spread across `db/schema/088_roles_permissions.sql` + every follow-up migration that touched `roles_permissions` (100, 101, 142, …). Migrations using `WHERE p.code IN (...)` silently no-op when a code isn't in the `permissions` table — exactly why migration 142 reported success but granted nothing for `workspace.archive` / `flows.manage`. Build a read-only SQL view `v_role_capability_matrix` (roles × permissions × roles_permissions join) plus a `/dev/permissions-matrix` page rendering the grid. Highlights ungranted permissions that are referenced by `useHasPermission()` calls but missing from the catalogue.
  >
- **B5.9** Single source-of-truth seed for role capabilities `[P3]`
  > Follow-on to B5.8. Consolidate scattered grant migrations (088 / 100 / 101 / 142 / …) into one declarative seed file `db/schema/seeds/role_capabilities.sql` containing the full role × permission matrix. Future grants edit this file; runner reapplies the diff. Removes the silent-noop migration trap and makes "give padmin what gadmin has" a one-line edit.
  >
- **B5.10** Audit `useHasPermission()` codes against catalogue `[P2]`
  > `npm run lint:permission-codes` — fails CI if any `useHasPermission("…")` argument or backend `RequirePermission("…")` call references a code not present in `permissions` catalogue. Catches the migration-142-style failure at build time.
  >

---

## B6. Workspace & Topology

- ✅ ~~**B6.1** Workspace config and settings~~ `[P2]`
  > `GET/PATCH /api/tenant-settings` live — `backend/internal/tenantsettings`; backed by `master_record_tenant` in `vector_artefacts` (M2). Full field set: name, description, timezone, date/datetime formats, workdays, week start, rank method, build-changeset tracking, notes, data region, primary contact email. Frontend: `/workspace-settings/organization` — full form with UnsavedChangesBar, client+server 422 validation. `PATCH /workspaces/{id}` rename also live.
  > Last checked: 2026-05-09
- ✅ ~~**B6.2** Org node tree~~ `[P2]`
  > `TopologyTreeFlyout` live — tree flyout rail with collapse/expand, inline rename, context menu, archive-map. Data via `topologyApi.tree()` → `/samantha/v2/topology/tree`. ETL complete (M6.3.5 — 58 nodes migrated). TS clean.
- ✅ ~~**B6.3** Topology canvas page~~ `[P3]`
  > Full React Flow canvas at `/workspace-settings/topology` (embedded) and `/(overlay)/topology` (full-viewport). dagre layout, workspace clamp, context menu, edit flyout, archive flyout, move-preview modal, sandbox/live mode toggle. All calls on v2 (M6.1). TS clean.
- ✅ ~~**B6.4** Workspace role assignments~~
  > `GrantRole` + `RevokeRole` live in `backend/internal/workspaces/roles.go` — `POST/DELETE /workspaces/{id}/members/{userId}/roles/{roleId}`
  > Last checked: 2026-05-08
  >
- ✅ ~~**B6.5** Workspace-scoped field schema — v2 live~~
- ✅ ~~**B6.6** Retire legacy org_* tables~~
  > Migration 138: `org_nodes`, `org_levels`, `org_node_roles` dropped from mmff_vector. No backend consumers since M6.2.7 cutover (verified by grep audit). Zero rows since cutover date. Applied 2026-05-09.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B6.7** Fix padmin role access to workspace-settings~~
  > padmin role was unable to save navigation preferences due to workspace-settings being gadmin-only but default_pinned=TRUE. Fixed via: (1) Migration 140 grants padmin access to workspace-settings in roles_pages table, (2) Migration 141 restores workspace-settings.default_pinned = TRUE so padmin sees it in defaults. The earlier migration 139 (default_pinned=FALSE) was the wrong approach and is now superseded.
  > Last checked: 2026-05-09
  >

---

## B7. Search

- ⚠️ **B7.1** Background search worker — indexes text + vector embeddings `[P2]`

  - ✅ ~~**B7.1.1** Worker is currently a no-op after DB migration — must be rewired to new DB~~

  > Rewired: `worker.go` now reads `artefacts_search_outbox` in `vector_artefacts` (vaPool). Migration `035_search_outbox.sql` adds `search_index` (tsvector), `content_embedding` (vector(768)), outbox table + enqueue trigger. `main.go` guards with `if vaPool != nil`. Pending: migration applied on dev + Ollama running.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B7.2** `POST /search` query endpoint `[P2]`~~

  > `backend/internal/search/` — fulltext via `plainto_tsquery` on `search_index`, ranked by `ts_rank`. Optional `type_ids` filter. 100-result cap. Route mounted under `/api/v2/search` (auth + rate-limit); graceful 503 when vaPool unavailable.
  > Last checked: 2026-05-08
  >
- **B7.3** Vector similarity reranking `[P4]`

---

## B8. Public API & Integrations

- ✅ ~~**B8.1** API keys — scoped, revokable, usage tracking~~
  > `backend/internal/apikeys/` — full package; `Issue`, `List`, `Revoke` endpoints live at `/api-keys/*`; `SeedDevKey` seeder; middleware wired on v2 routes (`main.go:788`)
  >
- ✅ ~~**B8.2** Rate limiting — per IP and per user~~
  > `httprate.LimitByIP` on all route groups + `security.LimitByUserOnWrites` per-user write limiter (`main.go:404`)
  >
- ✅ ~~**B8.3** OpenAPI v2 spec (`openapi-v2.yaml`) — live~~
- **B8.4** TypeScript SDK `[P4]`
- **B8.5** Python SDK `[P5]`
- **B8.6** Postman collection `[P4]`

---

## B9. Webhooks

Backend + UI live; worker running. New event types under B9.7+ extend the catalogue.

- ✅ ~~**B9.1** Webhook subscriptions table — URL, event filter, secret~~
  > `db/artefacts_schema/037_webhooks.sql` — `webhook_subscriptions` + `webhook_deliveries` tables; CRUD API at `GET/POST /workspaces/{id}/webhooks` + `GET/PATCH/DELETE /workspaces/{id}/webhooks/{webhookId}`; secret auto-generated (32-byte random hex) if not supplied
  >
- ✅ ~~**B9.2** Outbox delivery pattern~~
  > `webhook_deliveries` outbox table; `Enqueue` fans out to all matching active subscriptions; FOR UPDATE SKIP LOCKED claim
  >
- ✅ ~~**B9.3** Retry worker — exponential backoff, 24h window~~
  > `backend/internal/webhooks/worker.go` — exponential backoff (base 30s, cap 6h), up to 10 attempts; started via `go webhooks.NewWorker(vaPool).Run(shutdownCtx)` alongside search worker
  > Last checked: 2026-05-09 — worker started without errors post-migration 037
  >
- ✅ ~~**B9.4** Events: `item.created/updated/deleted`, `item.status_changed`, `sprint.started/closed` `[P1]`~~
  > All six events wired: `item.*` via `workitemsv2/service.go`; `sprint.started`/`sprint.closed` via `timeboxsprints/service.go`. Notifier pattern throughout — nil-safe, non-blocking.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B9.5** Webhook management UI `[P2]`~~
  > `app/(user)/workspace-settings/webhooks/page.tsx` + `WebhookForm.tsx` — full CRUD UI at workspace-settings/webhooks tab; list view with URL/events/status columns; create/edit/delete actions; event filter dropdown (all events or specific types); secret show/hide toggle. Integrated into workspace-settings navigation as default-pinned tab. Backend API fully consumed.
  > Commit `9256433` (2026-05-09): feat(B9.5): webhook management UI at workspace-settings/webhooks
  > Last checked: 2026-05-09
  >
- ✅ ~~**B9.6** `X-Vector-Signature` HMAC header for consumer verification~~
  > `webhooks/worker.go:sign()` — HMAC-SHA256 of payload body keyed on subscription secret; sent as `X-Vector-Signature: sha256=<hex>`
  >
- **B9.7** `item.blocked` / `item.unblocked` event wiring → tracked under B1.8.5 (blocked-state feature) `[P3]`
  > UI dropdown in `WebhookForm.tsx` lists "Item blocked" today but no fire site exists. The orthogonal blocked-state model (separate from flow state, with its own provenance fields) lives under B1.8; the webhook fire happens from the `Block`/`Unblock` service methods in B1.8.2.
  >

---

## B10. Async Jobs & Reporting

- **B10.1** Async job infrastructure — 202 Accepted + poll by job ID `[P2]`
- **B10.2** Burndown report `[P3]`
- **B10.3** Cumulative flow report `[P3]`
- **B10.4** Cycle time report `[P3]`

---

## B11. Real-Time & Async Push

- ✅ ~~**B11.1** Adoption SSE (`/adopt/stream`) — live; only real-time surface today~~
  > `backend/internal/errorsreport/adopt_stream.go` — confirmed live SSE endpoint
  > Last checked: 2026-05-08
  >
- **B11.2** General-purpose pub/sub — design decision pending `[P3]`
- **B11.3** Live board updates (item changes visible to other users) `[P3]`
- **B11.4** In-app notifications `[P3]`

---

## B12. n8n Integration

Depends on: B9 (webhooks) + B8.1 (API keys).

- **B12.1** n8n trigger node `[P3]`
- **B12.2** n8n action node `[P3]`
- **B12.3** API key credential type `[P3]`
- **B12.4** Community node package on n8n marketplace `[P4]`

---

## B13. Library & Portfolio Models

- ✅ ~~**B13.1** Library DB (`mmff_library`) — read-only pool~~
  > `main.go:124` — `mmff_library` read-only pool wired; consumed by `libraryreleases`, `errorsreport`, and reconciler packages
  > Last checked: 2026-05-08
  >
- **B13.2** Portfolio templates `[P3]`
- **B13.3** Library releases `[P4]`
- **B13.4** Tier-gated presets `[P4]`
- **B13.5** Cross-DB adoption mirrors `[P3]`
- **B13.6** Adoption orchestrator `[P3]`

---

## ✅ ~~B14. Addressables & Page Help~~

- ✅ ~~**B14.1** Panel / Table / Navigation addressable substrate~~ `[P2]`
  > `useRegisterAddressable` adopted in `Panel`, `Table`, `ResourceTree`, `Header`; `DomRegistryProvider` wraps app root; snapshot hydrated from `/api/addressables/snapshot` on first render.
- ✅ ~~**B14.2** Addressing scheme (`samantha._viewport.<slot>._kind.name`)~~ `[P2]`
  > `ViewportSlot` (six closed slots), `buildAddress` helper, `StrictRoute` opt-in gate — all live in `DomRegistryContext.tsx`. Lint rule `lint:addressables` enforces sole-writer. R049 research complete.
- ✅ ~~**B14.3** `addressables.Service` sole-writer boundary~~ `[P2]`
  > `backend/internal/addressables/service.go` — five methods; `boundary_test.go` CI-enforced regex; `lint:addressables` python script.
- ✅ ~~**B14.4** Samantha SDK help contract~~ `[P3]`
  > `samantha.contract.ts`, `SamanthaSdkContext.tsx` — help fetched from `/api/page-help/:id` in `Panel`; lazy-seeded from `library_help_defaults`; `helpable` bit per row.
- ✅ ~~**B14.5** Admin-managed contextual help per panel~~ `[P3]`
  > `PUT/DELETE /api/page-help/admin/:id`; `PATCH /api/addressables/admin/:id/helpable`; gadmin editor live.

---

## ✅ ~~B15. UI Primitives & Design System~~

- ✅ **B15.1** `<Table>` component — single sanctioned table primitive `[P2]`
  > `app/components/Table.tsx` — canonical primitive (657 LOC); `lint:no-raw-table` enforcement; 4 tree exceptions on allow-list; spec: `docs/c_c_table_component.md`
- ✅ **B15.2** `<ResourceTree>` / `ObjectTree` — hierarchical tree + configuration registry `[P2]`
  `[x] Generic dumb primitive (p_ObjectTree.tsx); pluggable data-type config via object-tree-registry.tsx; ready for releases/sprints/portfolio items`
  > `app/components/ResourceTree.tsx` (1554 LOC); five prop sets (Data/Scaffold/Features/CogMenu/Colour); addressable substrate; spec: `docs/c_c_resource_tree.md`
- **B15.2.5** Sidecar wizard JSON pattern (`p_wizard_*.json`) `[P2]`
  > Each `p_*` primitive component reads its config from a sibling JSON file in `app/components/<primitive>/configs/`. Static config (UI labels, columns, dnd type, **resourceUrl**, **scope**, panel header / filter chip selectors) lives in JSON; runtime closures (accessors, hooks, React nodes) injected by the page via `resolveWizardConfig()`. Goal: non-technical users configure components by editing JSON, no TypeScript. First adopter: `p_ObjectTree` with `p_wizard_workitems.json` + `p_wizard_portfolio.json`. Spec to write: `docs/c_c_wizard_sidecar.md` (tracked under B21.3.3).
- ✅ **B15.3** `<Badge>` — status / count / letter / tag variants `[P2]`
  > `app/components/Badge.tsx` — semantic tone derivation (status + domain maps); pill CSS family; spec: `docs/c_c_badge.md`
- ✅ **B15.4** `<TimeboxManager>` — sprints + releases surface `[P2]`
  > `app/components/TimeboxManager.tsx` (369 LOC) — generic `kind` system (sprint/release); table-per-kind via `kinds.ts` registry; spec: `docs/c_c_timebox_manager.md`
- ✅ **B15.5** `<DiagramCanvas>` — Canvas2D + dagre + d3-zoom `[P3]`
  > Spec: `docs/c_c_diagram_canvas.md` — Vector-built Canvas2D + dagre layout + d3-zoom; 10px snap-to-grid default; pluggable node renderer; exposed via Samantha API as `samantha.diagram.canvas`
- ✅ **B15.6** Drag-and-drop (`@dnd-kit`) `[P2]`
  > `@dnd-kit/core` + `@dnd-kit/sortable` installed; canonical DnD library; sortable lists/tables/tabs; server is order of truth (250ms debounce); no competing libs; spec: `docs/c_c_dnd.md`
- ✅ **B15.7** Theme pack system `[P3]`
  > CSS variable theming live; warm neutrals palette per Design System; color derivation in Badge, Table, tree styles
- ✅ **B15.8** Dev-UI primitives (`.dui-*` catalog for internal pages) `[P3]`
  > `dev/styles/dev-ui.css` — `.dui-*` catalog live; HARD RULE: every `/dev` panel composes from catalog, no bespoke per-page classes, no inline styles; spec: `docs/c_c_dev_ui_primitives.md`
- ✅ **B15.9** CSS table migration — legacy `.table*` → canonical classes `[P3]`
  > Legacy `.table*` family deprecated 2026-05-05; migration to canonical classes bundled with file changes; `.tree_accordion-dense__*` is the canonical table family

---

## B16. Security & Auth

- ✅ ~~**B16.1** JWT access + refresh tokens~~
- ✅ ~~**B16.2** CSRF protection~~
  > `security.CSRF` middleware wired (`main.go:437`); `X-CSRF-Token` header enforced; double-submit cookie pattern
  >
- ✅ ~~**B16.3** Per-IP + per-user write rate limiting~~
  > See B8.2 — same implementation
  >
- ✅ ~~**B16.4** API key auth — scoped, revokable~~
  > See B8.1 — same implementation
  >
- ✅ ~~**B16.5** Client IP extraction~~
  > `backend/internal/security/clientip.go` — `ClientIP()` helper confirmed live
  > Last checked: 2026-05-08
  >
- ✅ ~~**B16.6** Security checklist (Trust-No-One)~~
  > `docs/c_security.md` — Trust-No-One checklist document confirmed
  > Last checked: 2026-05-08
  >

---

## B17. Infrastructure & DevOps

- ✅ ~~**B17.1** Go backend on `:5100`~~
  > Running via `go run ./cmd/server` on `:5100`; `/healthz` confirmed
  > Last checked: 2026-05-08
  >
- **B17.2** Next.js frontend `[P1]`
- **B17.3** Three PostgreSQL databases — `mmff_vector`, `mmff_library`, `vector_artefacts` `[P1]`
- ✅ ~~**B17.4** pgvector extension for embeddings~~
  > Added via `035_search_outbox.sql` — `CREATE EXTENSION IF NOT EXISTS vector`; `content_embedding vector(768)` column on `artefacts`
  > Last checked: 2026-05-08
  >
- **B17.5** Ollama (`nomic-embed-text`) local embedding model `[P3]`
- ✅ ~~**B17.6** DB migration toolchain~~
  > `backend/migrate` compiled binary confirmed; `db/artefacts_schema/` SQL files numbered sequentially (001–035)
  > Last checked: 2026-05-08
  >
- ✅ ~~**B17.7** API snapshot toolchain — dual-spec, `api-snapshots/v1/` + `v2/`~~
- **B17.8** Unused index audit `[P3]`

---

## B18. Developer Experience

- ✅ ~~**B18.1** OpenAPI v2 spec (see B8.3)~~
- **B18.2** TypeScript SDK `[P4]`
- **B18.3** Python SDK `[P5]`
- **B18.4** Postman collection `[P4]`
- **B18.5** Rate limit response headers `[P3]`
  > No `X-RateLimit-*` headers found — rate limiting fires but doesn't expose headers to consumers
  > Last checked: 2026-05-08
  >
- ⚠️ **B18.6** Structured error responses — `error_code` + `details` on all 4xx/5xx `[P2]`
  > `error_code` field referenced in `errorsreport/handler.go` and `portfoliomodels/adopt.go` / `adopt_stream.go` — exists on adoption error paths but not consistently on all 4xx/5xx handlers
  > Last checked: 2026-05-08
  >

---

## B19. Work Item Relations Graph

A 3D force-directed graph (Obsidian-style globe) for visualising the work-item hierarchy at tenant scale. New tab on the Work Items page at `/work-items/work-item-relations`. Nodes coloured by type (Epic/Story/Defect/Task), hub size proportional to descendant count, mouse-drag rotation, search + neighbour-mode + depth slider. Stack: `3d-force-graph` (Three.js + d3-force-3d) with route-level dynamic import (`ssr:false`). 55k-row test seed already in place (500 epics + 100 top-level defects + descendants). Plan: [PLA-0035](dev/plans/PLA-0035.json)

### ✅ ~~B19.1 API — `/api/v2/work-items/relations`~~

- ✅ **B19.1.1** Design `GET /api/v2/work-items/relations` payload — `{nodes: [{id,type,title,state,descendantCount,parentId}], edges: [{source,target,kind:"parent"}], meta}` `[P2]`
- ✅ **B19.1.2** Write recursive-CTE descendant-count query against `vector_artefacts.artefacts` — single materialised pass per request `[P2]`
  `[x] B19.1.1 Payload designed`
- ✅ **B19.1.3** Implement route handler `app/api/v2/work-items/relations/route.ts` — workspace + type filters, `Cache-Control: private, max-age=30` `[P2]`
  `[x] B19.1.2 CTE query written`
- ✅ **B19.1.4** Update `openapi-v2.yaml` with `/work-items/relations` path spec `[P2]`
  `[x] B19.1.3 Route live`
- **B19.1.5** Document 100k-row truncation threshold + cursor-based fallback shape (not built in v1) `[P3]`
  `[x] B19.1.3 Route live`

### ✅ ~~B19.2 Page Structure — Tab Conversion~~

- ✅ **B19.2.1** Convert `app/(user)/work-items/page.tsx` body into `app/(user)/work-items/list/page.tsx` (preserve existing list view) `[P2]`
- ✅ **B19.2.2** Add `app/(user)/work-items/layout.tsx` with `PageShell` + `SecondaryNavigation` per [`docs/c_c_secondary_nav_deeplink.md`](docs/c_c_secondary_nav_deeplink.md) `[P2]`
  `[x] B19.2.1 List moved to /list`
- ✅ **B19.2.3** Replace `app/(user)/work-items/page.tsx` with `redirect("/work-items/list")` to keep bookmarks alive `[P2]`
  `[x] B19.2.1 List moved to /list → [x] B19.2.2 Layout in place`
- ✅ **B19.2.4** Audit existing `app/(user)/work-items/settings/` to confirm it still resolves under the new layout `[P2]`
  `[x] B19.2.2 Layout in place`
- ✅ **B19.2.5** Run `npm run lint:tab-deep-link` to verify no `urlKey`/`useTabState` regression `[P2]`
  `[x] B19.2.3 Redirect in place → [x] B19.2.4 Settings audit clean`

### B19.3 Frontend — Graph Component

- ✅ **B19.3.1** Install `3d-force-graph` + `three-spritetext`; verify `three@0.184.0` already pinned by `PortfolioGraphChart.tsx` `[P2]`
  `[x] B19.2.2 Layout in place (so the new tab can mount)`
- ✅ **B19.3.2** Scaffold `app/components/WorkItemRelations/index.tsx` orchestrator + `useRelationsData.ts` hook `[P2]`
  `[x] B19.1.3 API live → [x] B19.3.1 Libs installed`
- ✅ **B19.3.3** Build `RelationsGraph.tsx` — Three.js canvas via `dynamic(() => import, { ssr:false })`, parent edges, type-coloured nodes, `nodeVal = log2(descendantCount+2)` for hub sizing `[P2]`
  `[x] B19.3.2 Orchestrator scaffolded`
- ✅ **B19.3.4** Build `RelationsToolbar.tsx` — search box, type checkboxes, depth slider (0–10/∞), neighbour-mode toggle `[P2]`
  `[x] B19.3.3 Graph renders`
- ✅ **B19.3.5** Build `RelationsSidebar.tsx` — selected-node detail (type, id, state, depth, descendants, parent, open-in-list) `[P2]`
  `[x] B19.3.3 Graph renders → [x] B19.3.4 Selection wired`
- ✅ **B19.3.6** Implement search → fly-to via `cameraPosition({}, node, 1500)` `[P2]`
  > Done 2026-05-09 — `onFlyToReady` callback registered on mount; orchestrator effect fires `flyToRef.current(id)` when `filters.q` narrows to exactly one visible node. Camera flies with 1500ms transition.
- ✅ **B19.3.7** Implement neighbour-mode BFS at depth N — dim non-neighbours, highlight selected sub-graph `[P2]`
  > Done 2026-05-09 — `bfsNeighbours()` computes k-hop adjacency set from `selectedId` up to `filters.neighbourDepth` (1–6 hops). Non-members get `#rrggbb28` colour (16% opacity); `linkVisibility` hides non-neighbourhood edges. Hops slider appears in toolbar when neighbour mode is checked.
- ✅ **B19.3.8** New page route `app/(user)/work-items/work-item-relations/page.tsx` mounting `<WorkItemRelations />` `[P2]`
  `[x] B19.3.3 Graph renders → [x] B19.2.2 Layout in place`

### ❌ NFA — B19.4 Performance

**Status:** Parked pending B19.5.2 (filter guardrails). Graph currently renders unfiltered tenant data → visual mess; layout perf work premature until filters prevent overload.

- **B19.4.1** Move d3-force-3d layout into a Web Worker (`useGraphLayoutWorker.ts`) — serialise positions back per tick `[P2]`
  `[ ] Blocked by B19.5.2 (filters needed first)`
- **B19.4.2** Cap `cooldownTicks` at ~120; persist final positions in `sessionStorage` keyed by `(tenant, filterHash)` so re-entry is instant `[P2]`
  `[ ] Blocked by B19.5.2`
- **B19.4.3** Distance-based LOD for labels — only render `three-spritetext` for nodes within camera radius < threshold OR in selection set `[P3]`
  `[ ] Blocked by B19.5.2`
- **B19.4.4** Bundle-size check via `next build` analyser — confirm Three + 3d-force-graph stay in a lazy chunk gated to this tab `[P2]`
  `[ ] Blocked by B19.5.2`
- **B19.4.5** Document 500k-node v2 strategy (server-side layout precompute, GPU instancing, edge bundling) — design only, not built `[P4]`
  `[ ] Deferred to PLA-0037`

### B19.5 Saved Views, Mini-Map, Polish

- **B19.5.1** Build `RelationsMiniMap.tsx` — orthographic 2D top-down sharing positions, click-to-fly camera `[P3]`
  `[ ] B19.3.3 Graph renders`
- **B19.5.2** Saved filter views — schema decision: reuse `user_custom_pages` or new `user_relations_views` table `[P3]`
  `[ ] B19.3.4 Toolbar live`
- **B19.5.3** Implement save/load/delete view UI in toolbar `[P3]`
  `[ ] B19.5.2 Schema decided`
- **B19.5.4** Animation pause/resume on idle (`pauseAnimation()`) `[P4]`
  `[ ] B19.4.1 Worker live`
- **B19.5.5** PNG export + share-link with camera position serialised in URL `[P4]`
  `[ ] B19.3.3 Graph renders`
- **B19.5.6** Touch/pinch on iPad — `OrbitControls.touches` mapping `[P5]`
  `[ ] B19.3.3 Graph renders`

### B19.6 Tests, Realtime, Schema Follow-up

- **B19.6.1** Playwright E2E smoke — page loads, graph renders >0 nodes, search highlights, sidebar opens `[P2]`
  `[ ] B19.3.8 Page route live → [ ] B19.3.5 Sidebar live`
- **B19.6.2** Subscribe to existing `useRefetchOnPush` topic for work-item changes; debounced refetch only when tab is visible `[P3]`
  `[ ] B19.3.2 Hook scaffolded`
- ✅ **B19.6.3** Reserve **PLA-0036** for `work_item_links` table (kinds: blocks, depends_on, relates_to, duplicates) — adds non-tree edges to the graph `[P3]`
  `[x] B19.1.3 v1 API shipped (so edge stream can extend cleanly)`
- **B19.6.4** Write `docs/c_c_work_item_relations.md` — API shape, perf budget, follow-up PLA-0036 pointer `[P2]`
  `[ ] B19.3.8 Page route live`

---

## B20. User Access Rights & Navigation Control

Manage per-role access to pages and features. Control what each role (user, padmin, gadmin) can view and pin in navigation.

### B20.1 Role-based Page Access

- ✅ ~~**B20.1.1** Role gate system for pages — `roles_pages` junction table~~
  > `pages` table seeded with system pages (dashboard, portfolio, workspace-settings, etc.); `roles_pages` defines which roles can view each page. Queries scoped by role via `nav.Service.CatalogFor(role)`. All seeded pages + role assignments live.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.1.2** Frontend catalogue filtering by user role~~
  > `NavPrefsContext.tsx` loads catalogue from `/nav/catalogue`, filtered to only show pages user's role can access. Prevents role-forbidden items in UI.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.1.3** Backend validation of pinned items against role permissions~~
  > `nav.Service.ReplacePrefsForProfile()` validates each pinned item exists in user's role-filtered catalogue before saving. Rejects with `ErrRoleForbidden` if user tries to pin page outside their role.
  > Last checked: 2026-05-09
  >

### B20.2 Default Navigation Profiles

- ✅ ~~**B20.2.1** Default pinned items by role~~
  > `pages.default_pinned = TRUE` flags items shown by default when user first creates nav prefs. Filtered by role via catalogue so each role sees only its own defaults. E.g., workspace-settings is default for gadmin + padmin, hidden from user role.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.2.2** Graceful hydration when defaults change~~
  > Frontend draft reconstruction skips items not in current catalogue (migration-safe: if a default gets removed, user's existing pinned list stays stable; only new users see the updated set).
  > Last checked: 2026-05-09
  >

### B20.3 Role-Specific Feature Access

- ✅ ~~**B20.3.1** padmin access to workspace-settings~~
  > Migration 140 grants padmin role to `roles_pages` for workspace-settings; Migration 141 keeps it as default_pinned. padmin can now see, pin, and edit workspace-settings tabs (role-gated via `useHasPermission` per-tab). Gadmin retains full access.
  > Last checked: 2026-05-09
  >
- **B20.3.2** Permission predicate per tab in workspace-settings `[P2]`
  > Some tabs (e.g., users, permissions) are gadmin-only; padmin sees a subset (organization, workspaces, portfolio_model, etc.). Use `useHasPermission()` checks to hide/disable tabs per role. Define permission codes per tab in service layer.
  >
- **B20.3.3** Role-gated custom pages (Phase 5+) `[P4]`
  > When users can create custom pages, role assignments on custom pages follow same `roles_pages` pattern as system pages. Permissions inherit from creator tenant role or explicit assignment.
  >

---

## B21. Artefact-Items Substrate (PLA-0037)

> Generalise the v2 work-items handler family into a scope-parameterised **artefact-items** substrate so a single Go package serves both `/work-items` (scope=`work`, ~5 types) and `/portfolio-items` (scope=`strategy`, 51 types: themes, objectives, business epics, business outcomes, features-as-strategy). Frontend `useWorkItemsWindow` becomes generic `useArtefactItemsWindow` driven by `resourceUrl` from `p_wizard_*.json` so the existing portfolio page stops silently rendering work-items data.
>
> **Why now:** B15.2.5 introduced `p_wizard_portfolio.json` but the page still calls `/work-items` because the hook is hardcoded; backend filters `at.scope='work'` in 7 places, so the portfolio route — even when wired — would return 0 strategy artefacts. Without B21 the sidecar pattern is cosmetic.
>
> **Cutover model:** Phase 1 = rename Go package + add scope parameter, both routes register against same handler. Phase 2 = generic frontend hook + sidecar `resourceUrl`/`scope` fields. Phase 3 = tests, docs, deprecate legacy paths. Strict additive — no breaking changes to `/work-items` contract.

- **B21.1** Backend — rename `workitemsv2` → `artefactitemsv2` and parameterise by scope `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > Single sole-writer service for any `artefact_types` row, scope-discriminated. Phase 1 minimum to unblock portfolio page.
  >
- **B21.1.1** Rename Go package `backend/internal/workitemsv2/` → `backend/internal/artefactitemsv2/` `[P1]`
  > Includes `service.go`, `types.go`, `handler.go`, all `*_test.go`. Update package declaration. User decree: name MUST state what it does — *"artefactItemsv2 so it says what it does in the name"*.
  >
- **B21.1.2** Update 8 import sites in `backend/cmd/server/main.go` `[P1]` `[ ]B21.1.1`
  > Lines 55, 260, 266, 273, 277, 289, 292, 304. Constructor + route registration switches.
  >
- **B21.1.3** Update doc-comment refs in adjacent packages `[P2]` `[ ]B21.1.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > `backend/internal/portfolio/master_record_service.go:105`, `backend/internal/fields/handler.go:65`, `backend/internal/fields/resolver.go:71`. Comment-only — no behaviour change.
  >
- **B21.1.4** Add `Scope string` field to service constructor + propagate to all SELECT statements `[P1]` `[ ]B21.1.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > Replace 7 hardcoded `at.scope = 'work'` literals (`service.go` lines 137, 193, 266, 335, 363, 413, 473) with `at.scope = $N`. Constructor signature: `New(db, scope string)`. Two instances registered in `main.go`: `New(db, "work")` for `/work-items`, `New(db, "strategy")` for `/portfolio-items`.
  >
- **B21.1.5** Parameterise `validItemTypes` allow-list per scope `[P1]` `[ ]B21.1.4`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > `types.go:333` currently `{epic, story, task, defect, portfolio item}` — work-only. Move to scope-keyed map: `validItemTypesByScope["work"]` and `validItemTypesByScope["strategy"]` (latter pulled from seed-data list of 51 strategy artefact types). Validation paths consult the right slice based on service's scope.
  >
- **B21.1.6** Generalise `SummariseWorkItems` to scope-shaped summary `[P1]` `[ ]B21.1.4`
  > Currently returns hardcoded `{total, epics, stories, tasks, defects, blocked}`. Make summary buckets data-driven from artefact-types of the current scope. Strategy summary should return `{total, themes, objectives, features}` per existing portfolio page contract. Pattern: GROUP BY `at.code`, project into stable JSON keys per scope config.
  >
- **B21.1.7** Register `/portfolio-items` routes against `artefactitemsv2.New(db, "strategy")` in `main.go` `[P1]` `[ ]B21.1.4` `[ ]B21.1.6`
  > Mirror existing `/work-items` route group. Reuse same handler — only the scope-bound service differs. Do NOT remove `/work-items` routes; both run side-by-side.
  >
- **B21.1.8** Backend regression — existing `/work-items` contract unchanged `[P1]` `[ ]B21.1.7`
  > Run `backend/internal/artefactitemsv2/*_test.go` after rename. Add canary test: GET `/work-items?scope=work` returns identical payload to pre-rename. No new fields, no removed fields.
  >

- **B21.2** Frontend — generic hook + sidecar JSON drives endpoint `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > Replace hardcoded `useWorkItemsWindow` consumption in `p_ObjectTree.tsx` with config-driven `useArtefactItemsWindow(resourceUrl, scope)` reading from `p_wizard_*.json`.
  >
- **B21.2.1** Rename hook file `app/hooks/useWorkItemsWindow.ts` → `app/hooks/useArtefactItemsWindow.ts` `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > Function signature accepts `resourceUrl: string` and `scope: string` as required props. Internal fetch builds URL from these instead of hardcoding `/work-items`.
  >
- **B21.2.2** Update `app/components/ObjectTree/p_ObjectTree.tsx:97` to pass `resourceUrl`/`scope` from config `[P1]` `[ ]B21.2.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > Read `wizardConfig.resourceUrl` and `wizardConfig.scope` (new optional fields on `ObjectTreeDataConfig<T>`). Default to legacy `/work-items` + `work` if absent for backward compat during cutover.
  >
- **B21.2.3** Add `resourceUrl` + `scope` to wizard JSON files `[P1]` `[ ]B21.2.2`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > `p_wizard_workitems.json`: `{ "resourceUrl": "/work-items", "scope": "work" }`. `p_wizard_portfolio.json`: `{ "resourceUrl": "/portfolio-items", "scope": "strategy" }`.
  >
- **B21.2.4** Extend `ObjectTreeDataConfig<T>` interface in `p_ObjectTree.tsx` `[P1]` `[ ]B21.2.3`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
  > Add optional `resourceUrl?: string` and `scope?: string`. `resolveWizardConfig` passes them through unchanged.
  >
- **B21.2.5** Update remaining call-sites that import `useWorkItemsWindow` directly `[P2]` `[ ]B21.2.1`
  > `grep -rn "useWorkItemsWindow"` to enumerate. Most should be replaced; any pre-PLA-0030 holdouts get the rename.
  >

- **B21.3** Tests, docs, lint, cutover hygiene `[P2]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > Cement the substrate so it can't regress.
  >
- **B21.3.1** Backend integration test — `/portfolio-items` returns strategy artefacts only `[P1]` `[ ]B21.1.7`
  > Seed two artefacts (one scope=`work`, one scope=`strategy`) in test DB. Assert `/work-items` returns the work one only; `/portfolio-items` returns the strategy one only. Catches scope-leak regressions.
  >
- **B21.3.2** Frontend unit test — `p_ObjectTree` calls correct endpoint per config `[P2]` `[ ]B21.2.4`
  > Mock `useArtefactItemsWindow`; render with `p_wizard_portfolio.json`; assert `resourceUrl` arg = `/portfolio-items`.
  >
- **B21.3.3** Spec doc — `docs/c_c_wizard_sidecar.md` `[P2]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > Document the sidecar pattern: schema for `p_wizard_*.json`, contract for `resolveWizardConfig`, what stays in JSON vs. what is injected by the page (closures/React nodes). Add CLAUDE.md index pointer.
  >
- **B21.3.4** Lint rule `lint:scope-literals` `[P3]` `[ ]B21.1.4`
  > Forbid hardcoded `'work'`/`'strategy'` string literals in `*.go` files outside `artefactitemsv2/` and seed-data files. Prevents new scope leaks. Ledger under `dev/registries/scope-literals-allowlist.txt`.
  >
- **B21.3.5** Migration note — `docs/c_c_v1_v2_cutover.md` `[P2]` `[ ]B21.1.7`
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
  > Add row: `/portfolio-items` joins `/work-items` under `artefactitemsv2`. Mark v1 portfolio routes for deprecation timeline.
  >
- **B21.3.6** Update CLAUDE.md hard-rule index `[P3]` `[ ]B21.3.3`
  > Add pointer to `c_c_wizard_sidecar.md` under "Working practices" so future Claude sessions load the spec when touching `p_wizard_*.json`.
  >

- **B21.4** Deferred follow-ups (post-cutover) `[P4]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > Tracked here so they don't get lost; do NOT block B21.1–B21.3 completion.
  >
- **B21.4.1** Generalise `useRefetchOnPush` topic to scope-aware `[P3]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > Currently `rankTopic("work_item", ...)` and `rankTopic("portfolio_item", ...)` are separate. Consider unifying as `rankTopic("artefact", scope, ...)` once realtime fan-out can dispatch by scope.
  >
- **B21.4.2** Sidecar pattern adoption beyond `p_ObjectTree` `[P4]`
  > Apply `p_wizard_*.json` to other primitives: `<Table>`, `<DiagramCanvas>`, `<TimeboxManager>`. Per-primitive spec rolls up under B15 + B21.3.3.
  >
- **B21.4.3** Storify additional 51 strategy artefact types in UI `[P3]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > Once backend serves them, surface theme/objective/feature creation flows in portfolio page. Distinct from B21 — that just plumbs the data.
  >
- **B21.4.4** Drop legacy `/v1/portfolio-items` routes `[P4]` `[ ]B21.3.5`
  > After v2 contract is stable in production for 2+ release cycles. Per gradual-DB-sanitisation rule (memory).
  >
- **B21.4.5** Per-scope flow-state validation `[P3]`
  > `validItemTypesByScope` (B21.1.5) is one allow-list; flow-states may also need scope-keyed transitions if strategy artefacts have different lifecycle states. Audit `ListFlowStates` after B21.1.7 lands.
  >

---

## Unmatched Commits

> Commit `4ebf82f` (2026-05-09): fix: resolve getParentId/getChildrenCount functions in wizard config
> Commit `ca3e543` (2026-05-09): feat(PLA-0030 B19.7): wire p_wizard.json sidecar pattern to work-items and portfolio-items pages
> Commit `5c8f97b` (2026-05-09): docs(B20): add User Access Rights & Navigation Control section [B20]
> Commit `65851a0` (2026-05-09): fix: auto-redirect to first accessible tab in workspace-settings
> Commit `974c640` (2026-05-09): fix: allow padmin to access workspace-settings with role-gated tabs
> Commit `5989e2b` (2026-05-09): docs: mark B9 (webhooks) as complete [B9]
> Commit `4bdfeea` (2026-05-09): fix(B9.1): resolve webhookSvc variable shadowing bug
> Commit `8b194b6` (2026-05-09): fix: add CSRF token to webhook form submission [B9.1]
> Commit `88ff415` (2026-05-09): docs(B6.7): update scope with workspace-settings padmin fix completion
> Commit `61a1876` (2026-05-09): fix(PLA-0018): grant padmin access to workspace-settings [B6.7]
> Commit `22f6bfc` (2026-05-09): docs(B15.2): add example ObjectTreeConfig props for work_items and strategy_items
> Commit `fa56b2c` (2026-05-09): refactor(B15.2): organize ObjectTree into dedicated folder structure
> Commit `01a0c38` (2026-05-09): fix(B6.7): workspace-settings should not be default-pinned
> Commit `027638a` (2026-05-09): chore(B6.6): drop legacy topology V1 tables (org_nodes, org_levels, org_node_roles)
