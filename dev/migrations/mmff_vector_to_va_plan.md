# `mmff_vector` → `vector_artefacts` consolidation plan

> **Status:** DRAFT — awaiting user approval of naming scheme before any migration starts.
> **Scope:** every table in `mmff_vector` (62 total) — migrate live ones to `vector_artefacts`, drop dead ones.
> **Authoritative source of truth for table sets:** live `\dt` against both DBs, captured 2026-05-13.
> **Per-table protocol:** trace readers/writers → verify on mmff_vector → write CREATE+copy → repoint pool → update `docs/c_c_db_routing.md` → user tests → on green, DROP from mmff_vector.
> **No migration starts until naming scheme is approved.**

---

## 0 — Naming convention (proposed)

Observed convention in `vector_artefacts` (current state):

| Prefix | Domain | Examples |
|---|---|---|
| `artefact_*` | Artefact substrate | `artefact_types`, `artefact_field_values`, `artefact_field_library` |
| `flow_*` | State machines | `flow_states`, `flow_transitions`, `flow_state_exit_rules` |
| `timebox_*` | Sprints + releases | `timebox_sprints`, `timebox_releases` |
| `topology_*` | Org canvas | `topology_nodes`, `topology_role_grants` |
| `webhook_*` | Outbound integrations | `webhook_subscriptions`, `webhook_deliveries` |
| `master_record_*` | Tenant identity / portfolios | `master_record_tenant`, `master_record_portfolio` |
| `etl_*` | Migration scaffolding | `etl_backfill_audit` |
| `strategy_*` | Library adoption | `strategy_layers_adopted` |

**Proposed extension prefixes** for the 62 mmff_vector tables (NEW domains we have to add — flagged ⚠ where novel):

| Prefix | Domain | Reason |
|---|---|---|
| `auth_*` | Sessions, password resets, API keys | clearer than scattering `sessions` / `password_resets` at root |
| `authz_*` ⚠ | Roles, permissions, role-to-X bindings | distinct from `auth_*` (authentication) |
| `nav_*` ⚠ | Pages, page tags, user nav prefs, custom pages | one cohesive substrate; matches `nav.Service` |
| `audit_*` | Audit log + audit-adjacent | already canonical |
| `error_*` ⚠ | Error events + defects | unify the cross-cutting error register |
| `addressable_*` ⚠ | Page addressables, page help, entity refs | matches `addressables.Service` |
| `user_*` | Per-user state (tab order, custom views) | scoped, not at root |
| `subscription_*` | Subscription substrate (the *legacy* PoC schema replaced by `artefact_*`) | only kept if any rows still referenced; otherwise drop |
| `legacy_*` ⚠ | Mark for deletion candidates — provisional namespace while decommissioning | `legacy_obj_*` so the trail is visible during cutover |

**Sanity rules** (carried from `feedback_table_naming_prefixes` memory):
- Every new table MUST carry its substrate prefix. No generic names (`workspaces`, `pages`, `defects`) at root.
- Naming carries logic — a reader of just the table name should know which service owns it and which domain it belongs to.
- Plural for collections (`artefact_types`), singular only for singleton-like rows (none in this set).

---

## 1 — Migration phases (recommended order)

Order doesn't matter to the user, but FK dependency does — migrating a table whose FKs point at a not-yet-migrated table breaks integrity. Phases respect that:

| Phase | Theme | Tables | Why this phase |
|---|---|---|---|
| **P0 — Drop dead weight** | Zero-reference legacy | 8 tables | No readers/writers anywhere in code. Drop straight away — no migration needed. |
| **P1 — Leaf tables (no inbound FKs)** | Audit, errors, search outbox, view state, sequences | ~10 tables | Safe to migrate first; nothing else FKs to them. |
| **P2 — User-scoped state** | Per-user prefs, custom pages, tab order | ~6 tables | FK to `users` — but `users` stays in `mmff_vector` for now (auth domain); cross-DB FK strategy: drop the DB-level constraint, enforce in app. |
| **P3 — Substrate: nav** | Pages, tags, page-help, addressables | ~8 tables | Internal FK cluster; migrate together. |
| **P4 — Substrate: authz** | Roles, permissions, all role-bindings | ~6 tables | Internal FK cluster; migrate together. |
| **P5 — Substrate: subscription / portfolio legacy** | The old PoC schema being phased out | ~10 tables | Confirm each is dead before migrating; many may go straight to P0. |
| **P6 — Substrate: identity** | `users`, `sessions`, `password_resets`, `api_keys` | 4 tables | Move LAST — this is the FK root. |
| **P7 — Verify + drop** | Strip `mmff_vector` to zero application tables | — | Only `schema_migrations` remains; then retire the DB entirely. |

---

## 2 — Full table inventory (62 tables)

Status legend: ✅ live · ⚠ partial · ❌ dead (zero refs) · 🔵 in flight

| # | Current name (`mmff_vector`) | Proposed name (`vector_artefacts`) | Status | Phase | Notes |
|---|---|---|---|---|---|
| 1 | `api_keys` | `auth_api_keys` | ✅ | P6 | `apikeys.New(pool)` main.go:149 |
| 2 | ~~`audit_log`~~ | `audit_log` on `vaPool` | ✅ | P1 done 2026-05-13 | mig 047 (VA create) + mig 163 (mmff_vector drop); `audit.Logger.SetPool(vaPool)` swap inside vaPool init; 3676 rows copied, post-restart write verified on VA |
| 3 | `canonical_states` | DROP | ❌ | P0 | Zero refs (backend scan) |
| 4 | `company_roadmap` | `artefact_company_roadmap` ⚠ verify-live | ⚠ | P5 | Check if any rows / readers |
| 5 | ~~`defects`~~ | DROPPED 2026-05-13 (mig 165) | ✅ | P0′ done | 0 rows + 0 backend writers/readers + 0 incoming FKs → dead leaf; dropped with custom enum `defect_severity` (only used by this table). Revived defect tracking will use `artefact_types` on VA. |
| 6 | `entity_stakeholders` | `artefact_stakeholders` (cluster move) | 🔵 | P5 reclassified 2026-05-13 | NOT a P1 leaf — one of FOUR polymorphic-FK tables (`entity_stakeholders`, `item_type_states`, `item_state_history`, `page_entity_refs`) sharing `trg_*_dispatch` triggers (mig 013) that query parent tables (`company_roadmap`, `workspace`, `portfolio`, `product`) in the SAME DB. Migrating alone breaks dispatch trigger (cross-DB SELECT). Must move with the polymorphic cluster + parents OR accept app-only FK enforcement (drop trigger first). Currently 0 rows. `entityrefs.Service` is the sole writer — `internal/entityrefs/service.go`. |
| 7 | ~~`error_events`~~ | `error_events` on `vaPool` | ✅ | P1 done 2026-05-13 | mig 048 (VA create) + mig 164 (mmff_vector drop); `errorsreport.NewService(libPools.RO, errorsReportPool)` + `Orchestrator.ErrorsPool` (saga); 18 rows copied; cross-DB FKs (subscriptions, users) app-enforced; append-only trigger preserved on VA |
| 8 | `execution_item_types` | DROP (verify) | ⚠ | P5 | Likely superseded by `artefact_types` |
| 9 | ~~`library_acknowledgements`~~ | `library_acknowledgements` on `vaPool` | ✅ | P1 done 2026-05-13 | mig 049 (VA create) + mig 167 (mmff_vector drop); `libraryreleases.Service` + `Reconciler` both gain `SetAcksPool()` (audit.Logger pattern) — early-bound on `pool`, swapped after vaPool init in main.go L324–325; `librarydb.{ListReleasesSinceAck, loadAckedSet, AckRelease, CountOutstandingForSubscription}` refactored to take `acksPool` arg. 0 rows copied. Cross-DB FKs (`subscription_id`, `acknowledged_by_user_id`) stay app-enforced. |
| 10 | `library_help_defaults` | `addressable_help_defaults` | ✅ | P3 | Page-help seed data |
| 11 | `master_record_tenant` | `master_record_tenant` (merge) | ⚠ | P2 | **EXISTS IN BOTH DBs.** Tenant settings already split. Resolve which is canonical — `tenantsettings.New(tenantSettingsPool)` uses `vaPool if available, else pool`. Drop mmff_vector copy after confirming. |
| 12 | `master_record_workspaces` | `master_record_workspaces` (keep) | ✅ | P2 | `workspaces.New(pool, …)` main.go:263 |
| 13 | `o_artefact_visibility_levels` | DROP | ❌ | P0 | Zero refs |
| 14 | `o_search_index_outbox` | `search_index_outbox` ⚠ verify | ⚠ | P1 | Check if `search.New(vaPool)` outbox replaces this |
| 15 | `obj_custom_field_lib` | DROP (verify) | ⚠ | P5 | Superseded by `artefact_field_library` on VA |
| 16 | `obj_execution_types` | DROP | ❌ | P0 | Zero refs |
| 17 | ~~`obj_execution_types_overrides`~~ | DROPPED 2026-05-13 (mig 161) | ✅ | P0′ done | Zero rows + zero non-history refs confirmed |
| 18 | `obj_execution_types_tenant` | DROP | ❌ | P0 | Zero refs |
| 19 | `obj_field_template_fields` | DROP (verify) | ⚠ | P5 | Superseded by `artefact_type_fields` on VA |
| 20 | `obj_field_templates` | DROP (verify) | ⚠ | P5 | Superseded by `artefact_types` on VA |
| 21 | `obj_flow_system` | DROP | ❌ | P0 | Zero refs |
| 22 | `obj_flow_tenant` | DROP (verify) | ⚠ | P5 | Superseded by `flows` on VA |
| 23 | `obj_portfolio_items` | DROP (verify) | ⚠ | P5 | Superseded by `artefacts` on VA |
| 24 | `obj_strategy_types` | DROP (verify) | ⚠ | P5 | Superseded by `artefact_types` + `strategy_layers_adopted` on VA |
| 25 | `obj_strategy_types_layers` | DROP (verify) | ⚠ | P5 | Same as 24 |
| 26 | `org_node_view_state` | `topology_view_state_legacy` then DROP | ⚠ | P5 | `vector_artefacts.topology_view_state` is the canonical version (post-M6.2.7) |
| 27 | `page_addressables` | `addressable_page_addressables` | ✅ | P3 | `addressables.New(pool, …)` main.go:189 |
| 28 | `page_entity_refs` | `addressable_page_entity_refs` | ✅ | P3 | `entityrefs.Service` |
| 29 | `page_help` | `addressable_page_help` | ✅ | P3 | Help-icon contract via `<Panel>` |
| 30 | `page_tags` | `nav_page_tags` | ✅ | P3 | `nav.New(pool, navRegistry)` main.go:179 |
| 31 | `pages` | `nav_pages` | ✅ | P3 | Same service — internal FKs from custom-pages etc. |
| 32 | `password_resets` | `auth_password_resets` | ✅ | P6 | `auth.NewService(pool, …)` |
| 33 | `permissions` | `authz_permissions` | ✅ | P4 | `roles.New(pool, auditLog)` |
| 34 | `portfolio` | `legacy_portfolio` then DROP | ⚠ | P5 | Likely superseded by `master_record_portfolio` on VA |
| 35 | `product` | `legacy_product` then DROP | ⚠ | P5 | Likely superseded by `artefact_types` rows |
| 36 | `roles` | `authz_roles` | ✅ | P4 | 5 system roles seeded with stable UUIDs |
| 37 | `roles_org_nodes` | `authz_role_topology_grants` ⚠ verify | ⚠ | P4 | Already on VA as `topology_role_grants`? Confirm |
| 38 | `roles_pages` | `authz_role_pages` | ✅ | P4 | `nav.New(pool, …)` reads this |
| 39 | `roles_permissions` | `authz_role_permissions` | ✅ | P4 | `roles.New(pool, …)` |
| 40 | `roles_workspaces` | `authz_role_workspaces` | ✅ | P4 | `workspaces.New(pool, …)` |
| 41 | `schema_migrations` | (per-DB — exists on both already) | ✅ | — | Runner table; not migrated, owned by `backend/cmd/migrate` |
| 42 | `sessions` | `auth_sessions` | ✅ | P6 | `auth.NewService(pool, …)` |
| 43 | `sprints` | DROP (verify) | ⚠ | P5 | Superseded by `timebox_sprints` on VA |
| 44 | `subscription_artifacts` | `legacy_subscription_artefacts` then DROP | ⚠ | P5 | Pre-cutover PoC |
| 45 | `subscription_item_type_icons` | DROP | ❌ | P0 | Zero refs (per scan; user-mentioned exemption — verify) |
| 46 | `subscription_portfolio_model_state` | `legacy_subscription_portfolio_state` then DROP | ⚠ | P5 | Pre-cutover |
| 47 | `subscription_sequence` | `legacy_subscription_sequence` then DROP | ⚠ | P5 | Pre-cutover |
| 48 | `subscription_terminology` | `legacy_subscription_terminology` then DROP | ⚠ | P5 | Pre-cutover |
| 49 | `subscription_workflow_transitions` | DROP (verify) | ⚠ | P5 | Superseded by `flow_transitions` on VA |
| 50 | `subscription_workflows` | DROP (verify) | ⚠ | P5 | Superseded by `flows` on VA |
| 51 | `subscriptions` | `legacy_subscriptions` then DROP | ⚠ | P5 | Pre-cutover root — high inbound FK count, verify drop order |
| 52 | `user_custom_page_views` | `nav_user_custom_page_views` | ✅ | P3 | `custompages.New(pool)` |
| 53 | `user_custom_pages` | `nav_user_custom_pages` | ✅ | P3 | `custompages.New(pool)` |
| 54 | `user_nav_groups` | `nav_user_groups` | ✅ | P3 | `nav.New(pool, navRegistry)` main.go:179 |
| 55 | `user_nav_prefs` | `nav_user_prefs` | ✅ | P3 | Same service |
| 56 | `user_nav_profile_groups` | `nav_user_profile_groups` | ✅ | P3 | Same service |
| 57 | `user_nav_profiles` | `nav_user_profiles` | ✅ | P3 | Same service |
| 58 | `user_stories` | DROP (verify) | ⚠ | P5 | Story-tracker artefact — may be dead since Planka suspended |
| 59 | `user_tab_order` | `user_tab_order` (keep) | ✅ | P2 | `usertaborder.New(pool)` main.go:201 |
| 60 | `users` | `auth_users` | ✅ | P6 | The FK root of the whole DB — moves LAST |
| 61 | `vector_icons` | `legacy_vector_icons` ⚠ verify | ⚠ | P5 | Per `docs/c_c_db_routing.md` line 81: "live in mmff_vector — predate the cutover, not migrated yet" |
| 62 | `workspace` | DROP (verify) | ⚠ | P5 | Singular `workspace` (not `master_record_workspaces`) — likely legacy singleton |

---

## 3 — Tables flagged for immediate DROP (no migration, no rename)

Zero references in backend + frontend per the parallel Explore scans. Drop in P0 once user confirms.

1. `canonical_states`
2. `o_artefact_visibility_levels`
3. `obj_execution_types`
4. `obj_execution_types_overrides`
5. `obj_execution_types_tenant`
6. `obj_flow_system`
7. `subscription_item_type_icons` ⚠ (was flagged as live in docs/c_c_db_routing.md — verify with grep before drop)
8. `vector_icons` ⚠ (same — verify)

**Verification step before any drop:** re-run `grep -rn "<table>" backend/internal/ app/ db/` and confirm zero hits.

---

## 4 — Cross-DB FK problem (critical)

Many tables FK to `users.id` and `master_record_workspaces.id`. If `users` stays in `mmff_vector` while `pages` moves to `vector_artefacts`, the FK constraint cannot cross databases.

**Resolution strategy** (per phase):
- **During migration:** drop the DB-level FK constraint, enforce referential integrity in application layer (existing pattern — see `docs/c_polymorphic_writes.md`).
- **After P6 (users moved):** restore FKs within `vector_artefacts`.
- **Cutover safety:** every table migration includes a "what FKs does this break?" audit step BEFORE running the copy.

---

## 5 — Per-table migration runbook

For each table, in order:

1. **Trace.** `grep -rn "<table_name>" backend/internal/ app/ db/` — confirm reader/writer list matches plan.
2. **FK audit.** `\d <table>` on `mmff_vector` — list inbound + outbound FKs. Flag any cross-DB issues.
3. **Schema capture.** Dump the table definition: `pg_dump --schema-only -t <table>`.
4. **Write migration file** in `db/schema/NNN_migrate_<table>_to_va.sql` (vector_artefacts side gets a `db/va_schema/NNN_create_<new_name>.sql`).
   - CREATE on `vector_artefacts` with new name + same columns.
   - COPY data via `dblink` or app-side script.
5. **Repoint Go service** — change `pool` to `vaPool` in `main.go` constructor call. If service uses both, leave as-is and verify reads still work.
6. **Update `docs/c_c_db_routing.md`** — move table row from `pool` section to `vaPool` section.
7. **Restart backend** with `<server> -d` (dev pinned).
8. **Verify** `/api/env` returns dev; smoke-test the feature.
9. **STOP — wait for user test.**
10. **On green:** `DROP TABLE mmff_vector.<table>` via `db/schema/NNN_drop_<table>_from_mv.sql`. Backfill `schema_migrations`.
11. **Commit** with `[mig-<table>]` tag + scope ref.
12. **Move to next table.**

---

## 6 — What user needs to approve before P0 starts

1. **The naming scheme in §0** — especially the new prefixes (`auth_*`, `authz_*`, `nav_*`, `audit_*`, `error_*`, `addressable_*`, `legacy_*`).
2. **The DROP list in §3** — 8 tables flagged zero-reference. Confirm OK to drop without migration.
3. **The phase ordering in §1** — agreement that we go P0 → P1 → … → P6 (FK-safe order), not arbitrary.
4. **The per-table runbook in §5** — that's the stop-and-test cadence we agreed on (one table at a time, user tests, then drop).
5. **Single point of disagreement to resolve:** `master_record_tenant` exists in BOTH databases. `tenantsettings.New(tenantSettingsPool)` chooses `vaPool if available, else pool`. Question for user: is the `mmff_vector` copy now stale and droppable, or do they need to be merged first?

---

## 7 — Open questions / unknowns

- Are `vector_icons` + `subscription_item_type_icons` actually live? Routing doc says "live in `mmff_vector`" but backend scan says zero references. Verify before drop.
- `user_stories` table — does anything still read it post-Planka suspension?
- `workspace` (singular) vs `master_record_workspaces` (plural) — confirm singular is legacy.
- `subscription_*` family — which (if any) still have live writers? The PoC schema is supposed to be fully replaced by `artefact_*` on VA, but the scan showed some still have references.

---

## 8 — Tech debt impact (standing rule)

- **Identified S1:** every table left on `mmff_vector` while features migrate. Cross-DB FK drops are S1 until restored.
- **Recommendation:** finish the cutover in one branch with merges per-phase, not per-table. Trigger to pay down: P7 (drop the DB).

---

_Generated 2026-05-13 — DRAFT pending user approval._
