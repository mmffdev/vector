# Handover — Database Refactor (Column-Prefix Sweep + DB Merge)

**Created:** 2026-05-26
**Scope expanded:** 2026-05-26 — what was a column-prefix-only refactor became a three-pillar refactor (column-prefix + DB merge + FDW drop). See "Expanded scope" below.
**Status:** Strategy locked. Ready to execute. Three pillars; sequence matters.
**Live HEAD when handover landed:** `9599960b` — the latest handover-doc polish. Code-bearing baseline is `3ec7885e` (the post-rewind clean state). Run `git log --oneline -10` to confirm; if there are unfamiliar commits between `9599960b` and HEAD, READ them before proceeding.
**Build status when handover landed:** `go build ./...` GREEN. Live DBs untouched since 2026-05-26 02:57 UTC rewind.
**Pre-rewind backups on remote `vector-dev-pg`:** `20260526_025726_3ec7885e_dev_*.sql` (rewind point) + `20260526_031015_4f35d20d_dev_*.sql` (handover commit). Either restores live DB state if needed.

---

## TL;DR for a fresh-context session

This is now a **three-pillar database refactor**:

1. **Column-prefix sweep** — every column on every table in `mmff_vector` + `vector_artefacts` must be prefixed `<table_name>_<col>` per the rule in `.claude/CLAUDE.md`. Partially shipped on 2026-05-14 (9 migrations); 27 tables remain bare. PK becomes `<table>_id`, FK becomes `<table>_id_<target>[_<role>]` per `docs/c_c_naming_conventions.md` §2.4.
2. **DB merge** — all 37 mmff_vector tables move into vector_artefacts. End state: one tenant DB (vector_artefacts), one shared library DB (mmff_library, exempt from rule). The `mmff_vector` database is **dropped** after the move.
3. **FDW drop** — vector_artefacts currently has 16 `fdw_*` foreign tables pointing back at mmff_vector (and at long-dead obj_* tables). All 16 get dropped along with the FDW server + user mapping. End state: zero cross-DB joins, zero FDW infrastructure.

**Goal:** eliminate cross-DB joins entirely. Make all current `JOIN fdw_*` queries into native single-DB joins. Single tenant pool (`vaPool`), single DB cluster.

**Do not wipe + reseed.** A previous attempt in this session built a wipe-and-reseed pipeline and it cost 8 hours of detours. All three pillars are achievable via **in-place ALTER + cross-DB COPY** following the existing pattern in `db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql`.

**Read these files in this order before doing anything:**
1. This handover, top to bottom.
2. `.claude/CLAUDE.md` — full HARD RULES surface, especially the EVERY COLUMN IS `<table_name>_<column>` rule, the NEVER ASSUME A DATABASE rule, and the NEVER DESTRUCTIVE GIT rule.
3. `docs/c_c_naming_conventions.md` §2.3 (column prefix), §2.4 (PK/FK shape), §2.8 (rename history + done list), §2.9 (carve-out).
4. `db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql` — the canonical template for an in-place rename migration.
5. `docs/c_c_db_routing.md` — pool → DB → service map. Required reading before any psql query (per HARD RULE NEVER ASSUME A DATABASE). Also: every service listed there gets repointed to `vaPool` as part of this work.
6. `backend/cmd/server/main.go` — every `NewService(pool, ...)` call site. After the merge, all of these become `NewService(vaPool, ...)`.

---

## Expanded scope — what changed 2026-05-26

The earlier version of this handover scoped the refactor to **only the column-prefix sweep on 27 bare-column tables**. The user expanded the scope:

- **All 37 mmff_vector tables move to vector_artefacts** (not just the 13 bare-column ones). Every table — including ones that already have proper column prefixes from the 2026-05-14 partial sweep — gets relocated.
- **The column-prefix rule applies to ALL moved tables.** Tables that landed in mmff_vector with full prefixes from migrations 186–190 keep their prefixes through the move. Tables still bare get prefixed as part of the move migration.
- **`mmff_vector.master_record_workspaces` folds into `vector_artefacts.master_record_workspaces`** as a column merge — they are NOT the same schema. See "Master Record Workspaces fold" section below.
- **All 16 FDW foreign tables in vector_artefacts get dropped**, along with the FDW server + user mapping. Cross-DB joins disappear from the SQL surface entirely.
- **`mmff_vector` database is DROPPED** at the end of the refactor. The `pool` variable in `backend/cmd/server/main.go` disappears with it.

Decisions captured in conversation 2026-05-26:
- Q: How fold the two MRW tables? **A: Merge columns into VA's table.** (mmff_vector's extras — `subscription_id`, `slug`, `created_by`, `archived_by` — become new prefixed columns on vector_artefacts's table.)
- Q: FDW cleanup in scope? **A: Yes — drop all 16 in this refactor.**
- Q: Source DB after move? **A: Drop mmff_vector after migration.**

---

## What is DONE

### Policy
- **Column-prefix HARD RULE** locked in `.claude/CLAUDE.md`: every column on every table in `mmff_vector` + `vector_artefacts` is `<table_name>_<col>`. PK is `<table>_id`. FK is `<table>_id_<target>[_<role>]` per `docs/c_c_naming_conventions.md` §2.3 + §2.4. `mmff_library` is EXEMPT (shared library spine).
- **Vector_Scope.md B18.9** updated to the full-table-name rule (doc v2.63).
- **`docs/c_c_column_prefix_registry.md` DELETED** — mechanical rule needs no registry.
- **3-letter-abbreviation detour** (commits `b4d879df` … `01b103eb` … `69f23efe`) **REWOUND** via `git reset --hard 3ec7885e` + `git push --force-with-lease origin main` (2026-05-26 02:57 UTC). Clean baseline.
- **Bookmarks cleanup** done in commits `c4698ffe` + `1c9bc5d7`. Entity-bookmark surface fully removed (frontend + backend); `PageBookmarks` survives.

### Snapshots + safety nets
- 4 DBs snapshotted on remote Postgres as `*_snapshot_20260525` (mmff_vector, vector_artefacts, mmff_library, mmff_dev) — parity-verified, queryable any time.
- Pre-push backup hook took an additional snapshot at rewind point (`3ec7885e`).
- Documented in `docs/c_c_db_routing.md` (commit `3a3f3801`).

### Discovery work (still valid)
- Wave 1A — drop-order inventory for both DBs (38 + 39 tables, FK direction known)
- Wave 1B — migration file census at `/tmp/migration_rewrite_map.json` (stale on the prefix-registry side now; structural inventory still useful)
- Wave 1C — Go SQL constants census at `/tmp/go_sql_rewrite_map.json` (same caveat)
- All 4 surviving DBs + their snapshot copies are intact and queryable

### Pre-merge inventory (verified 2026-05-26)
- **mmff_vector: 37 tables.** Full list captured live; do NOT rely on the bare-column subset alone — the merge touches all 37. Refresh via the SQL block under "Live-DB current state".
- **vector_artefacts: 38 tables + 16 FDW foreign tables.** The 16 fdw_* tables are the cross-DB join surface to eliminate.
- **`master_record_workspaces` exists in both DBs with divergent schemas.** mmff_vector's (10 cols): `id, subscription_id, name, slug, description, created_by, created_at, updated_at, archived_at, archived_by`. vector_artefacts's (17 cols, already fully prefixed): `master_record_workspaces_id_workspace, master_record_workspaces_name, master_record_workspaces_description, master_record_workspaces_id_user_owner, master_record_workspaces_primary_contact_email, master_record_workspaces_data_region, master_record_workspaces_timezone, master_record_workspaces_date_format, master_record_workspaces_datetime_format, master_record_workspaces_workdays, master_record_workspaces_week_start, master_record_workspaces_rank_method, master_record_workspaces_build_changeset_tracking, master_record_workspaces_notes, master_record_workspaces_created_at, master_record_workspaces_updated_at, master_record_workspaces_archived_at`. Folding rules in the dedicated section below.

---

## Strategy — the three pillars, in order

The work is in **three sequenced pillars**. Each pillar has a clear DoD and is independently verifiable. Do them in this order — reversing the order leaves the system broken between pillars.

### Pillar 1: Column-prefix sweep (in-place, both DBs)

Get every table in both DBs into full-prefix shape FIRST, while the tables are still in their home DB. Doing it before the move means the move-pillar is purely a copy + drop — no shape changes mid-flight.

### Pillar 2: Cross-DB move (mmff_vector → vector_artefacts)

With both DBs in matching shape (full-prefix everywhere), move all 37 mmff_vector tables into vector_artefacts via `CREATE TABLE … AS SELECT * FROM dblink(…)` or `pg_dump/pg_restore --data-only` after schema is pre-created. Includes the master_record_workspaces fold.

### Pillar 3: FDW drop + backend repoint + mmff_vector drop

Once data lives in vector_artefacts, every Go service moves from `pool` to `vaPool`. All 16 fdw_* foreign tables in vector_artefacts get dropped (they reference the now-empty mmff_vector). FDW server + user mapping dropped. Finally `mmff_vector` database itself is dropped.

---

## Live-DB current state (verified 2026-05-26)

### mmff_vector — 37 tables to move

```
admin_api_keys                 master_record_workspaces       users_nav_profile_groups
cost_centres                   notifications_outbox           users_nav_profiles
csp_reports                    page_entity_refs               users_notification_rules
dpop_jti_cache                 pages                          users_notifications
library_help_defaults          pages_access_version           users_notifications_prefs
master_record_workspaces       pages_addressables             users_password_resets
                               pages_help                     users_permissions
                               pages_tags                     users_reauth_nonces
                               subscriptions                  users_roles
                               subscriptions_sequence         users_roles_pages
                               subscriptions_stakeholders     users_roles_permissions
                               users                          users_roles_workspaces
                               users_custom_page_views        users_sessions
                               users_custom_pages             users_tab_order
                               users_mentions                 vector_icons
                               users_nav_groups
                               users_nav_prefs
```

Wait — `admin_api_keys` and `users_sessions` ALSO exist in vector_artefacts. Add to the collision register below.

### vector_artefacts — 38 native tables + 16 FDWs

Native tables (38) listed under "What is DONE → Pre-merge inventory". The 16 FDW foreign tables:

```
fdw_defects                       fdw_obj_strategy_types
fdw_master_record_tenant          fdw_obj_strategy_types_layers
fdw_obj_execution_types           fdw_obj_work_items
fdw_obj_execution_types_tenant    fdw_org_nodes
fdw_obj_flow_tenant               fdw_portfolio_items
fdw_obj_flow_tenant_full          fdw_portfolio_templates
                                  fdw_roles_org_nodes
                                  fdw_subscriptions
                                  fdw_user_stories
                                  fdw_workspaces
```

**12 of these point at tables that are already DEAD** (the obj_* prefix and the *_tenant suffix are remnants of the pre-PLA-0023 work-items substrate, all dropped in the cutover). Confirm before drop, but the expected pattern is that all 16 either point at dead tables or at mmff_vector tables that will live in vector_artefacts natively after Pillar 2.

### Collisions — same name, both DBs

Discovered 2026-05-26. Must be resolved during Pillar 2:

| Name | mmff_vector | vector_artefacts | Resolution |
|---|---|---|---|
| `master_record_workspaces` | 10 cols (registry/lookup) | 17 cols (settings sidecar, fully prefixed) | **Fold** — see dedicated section |
| `admin_api_keys` | exists | exists | Verify schema parity. If identical, drop mmff_vector's copy at move time. If divergent, fold (analogous to MRW). |
| `users_sessions` | exists | exists | Same as above — verify parity, fold if divergent. |
| `csp_reports` | exists | exists | Same — verify parity. |
| `dpop_jti_cache` | exists | exists | Same — verify parity. |

**Action item for Pillar 2 prep:** dump column lists for all 5 collisions and decide per-table: parity-drop, fold, or rename-before-move. Do this BEFORE Pillar 2 dispatch.

### Bare-column gap list (as of 2026-05-26 — Pillar 1 scope)

Refresh with:

```sql
-- in mmff_vector + vector_artefacts:
SELECT table_name, count(*) AS bare_col_count
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND NOT (column_name LIKE table_name || '\_%' ESCAPE '\')
   AND table_name NOT LIKE 'pg\_%' ESCAPE '\'
   AND table_name NOT LIKE 'fdw\_%' ESCAPE '\'
   AND table_name != 'schema_migrations'
 GROUP BY table_name
 ORDER BY table_name;
```

**mmff_vector (13 tables, ~145 bare columns):** cost_centres (9), csp_reports (17), dpop_jti_cache (2), library_help_defaults (10), master_record_workspaces (10), page_entity_refs (3), pages (14), subscriptions (7), users (43), users_custom_page_views (8), users_custom_pages (7), users_tab_order (8), vector_icons (7).

**vector_artefacts (14 tables, ~133 bare columns):** artefact_priorities (9), artefacts (26), artefacts_adoption_states (10), artefacts_fields_library (12), artefacts_number_sequences (3), artefacts_search_outbox (6), artefacts_types_fields (8), csp_reports (17), dpop_jti_cache (2), etl_backfill_audit (5), strategy_layers_adopted (8), topology_commits (5), topology_nodes (20), workspaces_fields (4).

**§2.9 carve-out — CONFIRMED OUT (2026-05-26):** the doc claimed `users` + `artefacts` stay bare due to JSON wire-tag deps. **The user's "every column" mandate (2026-05-26) supersedes the carve-out.** Sweep them too. The JSON wire-tag rewrite is part of Pillar 1 — every `json:"id"` struct tag becomes `json:"users_id"` etc.; every frontend consumer (TypeScript types, API client, components reading `.id`) gets updated in the same wave. This is the biggest single-table effort in the refactor.

**MRW PK normalization — CONFIRMED (2026-05-26):** rename `vector_artefacts.master_record_workspaces.master_record_workspaces_id_workspace` → `master_record_workspaces_id` as part of Pillar 1 to match §2.4. The `_id_workspace` form is a pre-existing deviation; the canonical PK shape is `<table>_id`. This rename is a Pillar 1 migration (in-place ALTER, before the move), not a Pillar 2 fold concern. Update every Go SQL + struct tag + JSON tag + frontend consumer in the same wave.

**Collision resolution priority — CONFIRMED (2026-05-26):** before Pillar 1 dispatch, resolve the 4 non-MRW collisions FIRST (see "Collisions" table above):
1. Dump full schema (columns + types + constraints + indexes) for `admin_api_keys`, `users_sessions`, `csp_reports`, `dpop_jti_cache` in BOTH DBs.
2. Per-table decision: parity-drop (if schemas are identical, drop mmff_vector's copy at Pillar 2 move time), fold (if divergent, add missing columns to VA's copy like MRW), or rename-before-move (if conceptually different despite same name).
3. Document each decision in a new short doc `handovers/refactorDB_collisions.md` before Pillar 1 starts. The collision resolutions affect what Pillar 1 migrations get written for each side (e.g. if `users_sessions` is parity-drop, then mmff_vector's copy still gets prefix-swept in Pillar 1 but is destined to be dropped in Pillar 2, so the Pillar 1 work on it is technically wasted — knowing this up front lets us skip it).

---

## Pillar 1 — Column-prefix sweep (in-place)

**Pattern template — read this file first:** `db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql`

### Per-table recipe

For each of the 27 bare-column tables:

1. Write a new migration `db/<dbname>/schema/NNN_<table>_column_prefix.sql` (next available NNN).
2. `ALTER TABLE <name> RENAME COLUMN <old> TO <new>` for every column. PK becomes `<table>_id`. FK becomes `<table>_id_<target>[_<role>]` per §2.4.
3. Rename indexes + constraints to match (the 186 template shows this).
4. DOWN counterpart: reverse renames.
5. Update any trigger functions referencing the columns (especially `set_updated_at` — see anti-patterns below).
6. Apply against a `*_dryrun` throwaway DB copied from `*_snapshot_20260525` first.

### Per-table Go sweep

7. `backend/internal/**/sql.go` — every SELECT / INSERT / UPDATE / JOIN / WHERE referencing the renamed columns gets rewritten.
8. `db:"..."` struct tags + `pgx.RowToStructByName` consumers updated.
9. `json:"..."` struct tags updated. Coordinated frontend rewrite.
10. Frontend TypeScript types + API client + component property accesses updated for any renamed JSON keys.
11. `go build ./... && go test ./...` green. `npm run typecheck` green.

### Pillar 1 DoD
- All 27 bare-column tables fully prefixed in both live DBs.
- `lint:column-prefix-convention` returns zero violations.
- Backend compiles, tests pass.
- Frontend typechecks.
- padmin login works, dashboard renders, key CRUD paths function.
- SY003 regenerated (HARD RULE — substrate changed).
- Each migration applied via the standard migration apply path (NOT pre-applied to live before the migration record is written — schema_migrations integrity matters).

---

## Pillar 2 — DB merge (mmff_vector → vector_artefacts)

After Pillar 1 is fully shipped and green.

### Pre-flight (do before any move)

1. Verify Pillar 1 DoD on both live DBs.
2. Take fresh snapshots: `mmff_vector_premove_<date>`, `vector_artefacts_premove_<date>`.
3. Resolve the 5 collisions (see "Collisions" table above) — produce per-collision decision doc.
4. Confirm `dblink` extension is installed in vector_artefacts (or install it for the move).
5. List every foreign key that crosses the mmff_vector ↔ vector_artefacts boundary today (currently they can't be real FKs because Postgres blocks cross-DB FKs — they're app-enforced soft FKs; SY003 has the 8 currently identified).
6. Read the master_record_workspaces fold plan in the dedicated section below.

### Per-table move recipe

For each of the 37 mmff_vector tables (in FK-safe order — leaf tables first, then parents):

1. **Pre-create schema in vector_artefacts** via a migration `db/vector_artefacts/schema/NNN_move_<table>_from_mmff_vector.sql` that runs the CREATE TABLE + indexes + constraints + sequences. Use the EXACT current schema from mmff_vector (post-Pillar-1, so fully prefixed).
2. **Copy data** via `dblink` from mmff_vector. Pattern:
   ```sql
   INSERT INTO <table> (col, col, ...)
   SELECT col, col, ... FROM dblink('host=... dbname=mmff_vector ...',
     'SELECT col, col, ... FROM <table>')
     AS t(col type, col type, ...);
   ```
   Or `pg_dump --data-only --table=<table>` + `pg_restore` if `dblink` is awkward at this volume.
3. **Verify row count parity** between source and dest.
4. **Drop the source table** in mmff_vector (last step per table — keeps source as rollback fallback until the last moment).
5. **Apply the move migration record** in vector_artefacts so `schema_migrations` reflects the new shape.

### Master Record Workspaces fold (special-case under Pillar 2)

The 5-collision resolution for `master_record_workspaces` is a column merge, not a drop or rename. After Pillar 1 (where mmff_vector's MRW gets prefixed to `master_record_workspaces_id`, `master_record_workspaces_subscription_id`, etc.), the two tables look like:

**mmff_vector.master_record_workspaces** (post-Pillar-1, hypothetical shape):
- `master_record_workspaces_id` (PK)
- `master_record_workspaces_id_subscription` (FK to subscriptions)
- `master_record_workspaces_name`
- `master_record_workspaces_slug`
- `master_record_workspaces_description`
- `master_record_workspaces_id_user_created_by` (FK to users)
- `master_record_workspaces_created_at`
- `master_record_workspaces_updated_at`
- `master_record_workspaces_archived_at`
- `master_record_workspaces_id_user_archived_by` (FK to users)

**vector_artefacts.master_record_workspaces** (current, already prefixed — but PK will be normalized in Pillar 1):
- `master_record_workspaces_id_workspace` → renamed to `master_record_workspaces_id` in Pillar 1 (locked 2026-05-26 per §2.4)
- `master_record_workspaces_name`
- `master_record_workspaces_description`
- `master_record_workspaces_id_user_owner` (FK to users)
- `master_record_workspaces_primary_contact_email`
- `master_record_workspaces_data_region`
- `master_record_workspaces_timezone`
- `master_record_workspaces_date_format`
- `master_record_workspaces_datetime_format`
- `master_record_workspaces_workdays` (text[])
- `master_record_workspaces_week_start`
- `master_record_workspaces_rank_method`
- `master_record_workspaces_build_changeset_tracking`
- `master_record_workspaces_notes`
- `master_record_workspaces_created_at`
- `master_record_workspaces_updated_at`
- `master_record_workspaces_archived_at`

**Fold plan:**

1. **PK normalization is a Pillar 1 task** (already locked above) — `master_record_workspaces_id_workspace` → `master_record_workspaces_id`. Done before Pillar 2 starts.
2. **Add missing columns to VA's table** (Pillar 2 move-migration):
   - `master_record_workspaces_id_subscription` (uuid, FK to subscriptions)
   - `master_record_workspaces_slug` (text)
   - `master_record_workspaces_id_user_created_by` (uuid, FK to users)
   - `master_record_workspaces_id_user_archived_by` (uuid, FK to users)
3. **Update from mmff_vector** via dblink: `UPDATE vector_artefacts.master_record_workspaces SET … = src.…` joined on `master_record_workspaces_id`.
4. **Verify**: every row in mmff_vector has a matching row in vector_artefacts post-update. Rows in vector_artefacts with no mmff_vector match (if any) keep NULL for the new columns — document this in the move migration.
5. **Drop the source** in mmff_vector after row-count parity check passes.
6. **Backend services that USED to read from mmff_vector.master_record_workspaces** now read from vector_artefacts.master_record_workspaces. Update `backend/cmd/server/main.go` wiring and the service SQL.

### Pillar 2 DoD
- All 37 tables exist in vector_artefacts with full row-count parity to their old mmff_vector copies.
- Master Record Workspaces fold complete with no data loss.
- All 5 collisions resolved.
- Source tables dropped in mmff_vector (DB itself still exists, just empty).
- Backend repointed to vaPool for everything that used to use pool (Pillar 3's work; can overlap).
- SY003 regenerated.

---

## Pillar 3 — FDW drop + backend repoint + mmff_vector drop

After Pillar 2 is fully shipped and green.

### FDW drop

1. **Verify all 16 fdw_* are dead** by greping for them in `backend/internal/`:
   ```bash
   for fdw in fdw_defects fdw_master_record_tenant fdw_obj_execution_types fdw_obj_execution_types_tenant fdw_obj_flow_tenant fdw_obj_flow_tenant_full fdw_obj_strategy_types fdw_obj_strategy_types_layers fdw_obj_work_items fdw_org_nodes fdw_portfolio_items fdw_portfolio_templates fdw_roles_org_nodes fdw_subscriptions fdw_user_stories fdw_workspaces; do
     echo "=== $fdw ==="
     rg -n "$fdw" backend/internal/ || echo "  (no refs)"
   done
   ```
   Expected: zero hits (or 3 known dead-code stubs from the handover's existing "Dead-code FDW callers" section — fix those at the same time).
2. **Write a migration** `db/vector_artefacts/schema/NNN_drop_all_fdw.sql` that drops every fdw_* foreign table.
3. **Drop the FDW server + user mapping** in the same migration:
   ```sql
   DROP USER MAPPING IF EXISTS FOR <user> SERVER <server_name>;
   DROP SERVER IF EXISTS <server_name> CASCADE;
   DROP EXTENSION IF EXISTS postgres_fdw;
   ```
   Verify the server name by `SELECT * FROM pg_foreign_server;` in vector_artefacts first.
4. DOWN: re-create FDW (this is intentionally not symmetric — the post-merge world has no use for FDW, so DOWN is best-effort).

### Backend repoint (pool → vaPool)

1. In `backend/cmd/server/main.go`, every `NewService(pool, …)` call gets reviewed.
2. For services that used to talk to mmff_vector tables that are now in vector_artefacts: `pool` → `vaPool`.
3. Some services merge with vector_artefacts services (e.g. if `workspaces` service in mmff_vector becomes redundant with vector_artefacts equivalents).
4. Delete the `pool` variable + its connection-string config + its `.env.dev` line once nothing references it.
5. Update `docs/c_c_db_routing.md` to reflect the new wiring.

### mmff_vector drop

1. Confirm zero references to `pool` in `backend/internal/**`.
2. Confirm zero references to `mmff_vector` (the string) in backend config, hooks, scripts (excluding historical handover docs).
3. Run via `psql` on the remote: `DROP DATABASE mmff_vector;`
4. Update the snapshot job to stop dumping `mmff_vector`.
5. Update `docs/c_c_db_routing.md` and the HARD RULE in `.claude/CLAUDE.md` ("Three databases are in play on every env" → "Two databases are in play on every env").
6. Update SY003 — should now describe two databases, not three.

### Pillar 3 DoD
- Zero `fdw_*` foreign tables in vector_artefacts.
- Zero references to `pool` (mmff_vector pool variable) in `backend/cmd/server/main.go` and `backend/internal/`.
- `mmff_vector` database does not exist on dev (or any env where Pillar 2 has shipped).
- HARD RULE in CLAUDE.md updated to reflect two-DB world.
- SY003 regenerated.
- All smoke tests pass.

---

## Where to pick up next

1. **Read this whole doc top to bottom.**
2. **Re-read `docs/c_c_naming_conventions.md` §2.3 + §2.4 + §2.8 + §2.9** — rule + pattern + status truth.
3. **STEP 0 — Resolve the 4 non-MRW collisions** (locked 2026-05-26 as the first action before any other Pillar work):
   - Dump full schemas (columns + types + constraints + indexes) for `admin_api_keys`, `users_sessions`, `csp_reports`, `dpop_jti_cache` from BOTH `mmff_vector` and `vector_artefacts`.
   - Per-table verdict: parity-drop / fold / rename-before-move.
   - Write `handovers/refactorDB_collisions.md` documenting each decision.
   - The MRW fold is already specified above; that one does NOT need this step (PK normalization is in Pillar 1, column merge is in Pillar 2).
   - The §2.9 carve-out is already CONFIRMED OUT (sweep `users` + `artefacts` in Pillar 1, coordinated JSON tag rewrite included).
4. **Dispatch Pillar 1 ONE subagent** (or sequence of agents if scope warrants):
   - Goal: write 27 ALTER TABLE column-prefix migrations following the 186 template
   - Source of truth: live snapshot DB schema (`*_snapshot_20260525`) for column inventory
   - Per-table: derive PK + FK column names per §2.4 (e.g. `users.subscription_id` → `users_id_subscription`, NOT `users_subscription_id`)
   - Sweep Go SQL + struct tags + frontend types in the same wave — every renamed column gets corresponding Go + TS rewrites
   - JSON wire-tags get updated and frontend coordinated rewrite is in scope
   - Dry-run against `*_dryrun` throwaway DBs before declaring done
   - Output: `db/{mmff_vector,vector_artefacts}/schema/NNN_*_column_prefix.sql` + DOWN counterparts + Go diffs + TS diffs
5. **Verify Pillar 1 by opening files** — DO NOT trust subagent summaries. The last attempt's agent claimed "verified by spot-check" and shipped 4 structural defects.
6. **Apply Pillar 1 against snapshot DBs first**, then live. Restart backend, smoke test, regenerate SY003.
7. **Move to Pillar 2** once Pillar 1 is DONE. Take fresh snapshots first.
8. **Move to Pillar 3** once Pillar 2 is DONE.
9. **Final commit + push** when all three pillars are green. Tag the commit (`refactorDB-complete-<date>`) for easy rollback reference.

**Total effort estimate:** ~10-15 hours across all three pillars if briefed into subagents with proper verification gates between waves. Each pillar is independently testable.

---

## Known caveats

### What WAS partly broken in the wipe-and-reseed attempt (now reverted)
For the historical record, in case the wipe-and-reseed approach gets resurrected:

- `set_updated_at()` trigger function — shared by 11 tables across both DBs, but pg_dump emitted a per-table hardcoded body. Generic rewrite via `TG_TABLE_NAME` works:
  ```sql
  CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE v_col text := TG_TABLE_NAME || '_updated_at';
  BEGIN
      NEW := json_populate_record(NEW, json_build_object(v_col, now())::jsonb::json);
      RETURN NEW;
  END;
  $$;
  ```
- `dispatch_polymorphic_parent()` function was referenced by `trg_subscriptions_stakeholders_dispatch` but its original parent tables (`company_roadmap`, `workspace`, `portfolio`, `product`) are all DEAD. Resolution: drop the trigger entirely, tighten CHECK constraint to single surviving parent (`'master_record_workspaces'`).
- `artefacts_search_outbox.id` + `webhooks_deliveries.id` are `bigserial`, not `bigint NOT NULL` + `ALTER ... SET DEFAULT nextval(...)`. pg_dump separates the sequence creation; agent missed the CREATE SEQUENCE.

### Dead-code FDW callers (untouched this session)
3 Go files reference foreign tables that should be dropped:
- `backend/internal/workspacemasterrecord/sql.go` — `fdw_workspaces`, `fdw_subscriptions`
- `backend/internal/mentions/sql.go` — `users_teams_members` (table doesn't exist)
- `backend/internal/nav/sql.go` — `loadEntity` stub for a deleted route

Not blocking; compile is green because Go doesn't validate SQL strings at compile time. These will runtime-fail when called. Fix during the cutover or open a separate TD.

### Files in /tmp from this session (probably gone after macOS cleanup)
- `/tmp/migration_rewrite_map.json` — Wave 1B output
- `/tmp/go_sql_rewrite_map.json` — Wave 1C output
- `/tmp/collapse_migrations.py` — Wave 2D's pg_dump→synth script

Don't rely on these. Regenerate if needed.

### Process lessons
- **DO NOT trust subagent summaries.** Open files and verify before chaining the next agent. Last attempt's Wave 2D agent claimed "verified by spot-check" and shipped 4 structural defects.
- **Lock the rule shape FIRST** by reading `docs/c_c_naming_conventions.md` §2.3 + §2.4 before any agent dispatch. The previous run picked the wrong shape (`users_subscription_id` vs the canonical `users_id_subscription`) because it didn't reference §2.4.
- **The §2.8 status line ("COLUMN-PREFIX SWEEP COMPLETE") is overstated** — only ~50% of tables were swept on 2026-05-14. Read live-DB column shapes via `information_schema.columns`, not the doc.

---

## Operational facts a cold-start session needs

### Postgres access
The dev Postgres lives in a Docker Swarm container `vector-dev_postgres.*` on remote host `vector-dev-pg` (77.68.33.216). The Mac connects via SSH tunnel on `localhost:5435`. **Docker does NOT run on the Mac.** All DB introspection from the agent side must use this pattern:

```bash
ssh -o ExitOnForwardFailure=no vector-dev-pg \
  "docker exec \$(docker ps --format '{{.Names}}' | grep '^vector-dev_postgres') \
   psql -U mmff_dev -d <dbname> -c '<sql>'"
```

The `-o ExitOnForwardFailure=no` is needed because the SSH alias has auto-forwards (ports 5435/7575/8085/3002/3100/5672/15673) that fail if the dev backend is running and holding them.

Live DBs: `mmff_vector`, `vector_artefacts`, `mmff_library`, `mmff_dev`.
Snapshot DBs: `*_snapshot_20260525` (same names + suffix).
Throwaway DBs for dry-runs: create as `*_dryrun` then drop.

DB password (dev): `68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi` (also in `backend/.env.dev` as `DB_PASSWORD`).

### Backend stack
- **Go backend** on `http://localhost:5100`. Run via `cd backend && BACKEND_ENV=dev go run ./cmd/server`. Logs to stdout.
- **Next.js frontend** on `http://localhost:5101`. Run via `npm run dev`. Logs to stdout.
- **Env pinning:** backend is HARD-PINNED to `dev`. Don't switch. `backend/.env.staging.locked` and `.env.production.locked` are refusing stubs.
- **Dev API key for curl tests:** `grep DEV_API_KEY backend/.env.dev | cut -d= -f2` — gets you a Bearer token that bypasses the session/DPoP flow for any `/_site/admin/dev/*` route.

### Tests
- Backend: `cd backend && go test ./...` (some `featuretests` are pre-existing broken — `vectorArtefactsPoolForF1` undefined — not blocking unrelated work).
- Frontend: `npm run typecheck` for TS check; `npm run test` for vitest if needed.
- Lint suite: `npm run lint:column-prefix-convention` checks column-prefix gaps and was the lint that enforced the partial sweep on 2026-05-14.

### Human accounts — HARD RULE, do not modify
- `gadmin@mmffdev.com` / `padmin@mmffdev.com` / `user@mmffdev.com` — passwords `password` (reset 2026-05-02). Never modify their `users.password_hash`, `users.email`, `users.is_active`, `users.role`, or `users.password_changed_at`. If login fails: ASK, don't overwrite.
- For testing: create NEW accounts (e.g. `claude_gadmin@mmffdev.com`).

### Commit style
Recent commit message style — look at `git log --oneline -10` for the pattern. Use `[B18.9]` (or whatever scope ref applies) in subject. Co-author trailer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
Pre-commit hook auto-regenerates the API spec when backend route surface changes; let it. Pre-push hook auto-snapshots all 3 DBs (mmff_vector / vector_artefacts / mmff_library) and tags by HEAD sha.

### Subagent dispatch discipline (mandate added this session)
- Default to subagents for any task >3 tool calls.
- Brief them like a colleague with zero context — explicit file paths, explicit success criteria, explicit STOP-on-unmapped policy.
- **NEVER trust an agent's "verified by spot-check" claim.** Open files and verify between waves.
- Memory leaf: `context/memory/feedback_subagent_driven_default.md` (was committed once as `85ea4ad5` and lost in the rewind — re-add if needed).

### Single-agent serial discipline (LOCKED 2026-05-26 — context-protection mandate)

**RULE:** This refactor runs ONE subagent at a time. No parallel dispatch, no chaining.

**Loop:**
1. Dispatch ONE subagent with a tightly scoped brief (one wave of work — e.g. "write the 5 Pillar 1 migrations for the cost_centres / csp_reports / dpop_jti_cache / library_help_defaults / page_entity_refs tables; Go SQL + struct tag sweep included; dry-run against `*_dryrun`; output the diff").
2. Agent runs to completion and returns.
3. **MAIN CONTEXT validates the output by opening files** — not by reading the agent's summary. Verify migrations against the 186 template. Verify Go diffs compile. Verify dry-run output is what the agent claimed.
4. If validation passes: commit the wave. If validation fails: write a TIGHT corrective brief for the NEXT agent (not the same one — context is gone) and dispatch a fresh agent for the fix.
5. **The original subagent is killed off** (its conversation is gone the moment it returns — there is no "send it back to the same agent"; every dispatch is a fresh agent with zero memory).
6. Dispatch the NEXT agent for the NEXT wave. Repeat.

**Why this matters (context-protection mandate):**
- Main context stays small. The agent's working context (file dumps, dry-run output, intermediate reasoning) does NOT pollute the main context — only the agent's final summary + the files it produced come back.
- Each dispatch starts fresh, so a long refactor can run across many waves without main context ballooning.
- Verification gates are real gates: an agent can't drag a defect into the next wave because the next wave gets a fresh agent that only knows what the main context tells it.
- "Verified by spot-check" cannot happen because there is no shared context to spot-check from — the main context MUST open the files itself.

**Anti-pattern this rule prevents (the cause of the 8-hour detour earlier this session):**
- Dispatching Wave 2D and Wave 2E in parallel, or chaining 2D → 2E without verification, resulted in 2E building on 2D's unverified output. Both had to be reworked. The serial-with-validation discipline closes that surface.

**Wave sizing guidance:**
- A wave is "as much as one subagent can do AND main-context can validate in one sitting." For Pillar 1, that's likely 4–6 tables per wave (≈100–150 column renames + matching Go SQL + struct tags + JSON tags + frontend rewrites). For Pillar 2, that's likely 4–6 tables moved per wave. For Pillar 3, that's likely 3 waves total (FDW drop, backend repoint, mmff_vector drop).
- Don't go bigger to "save dispatches" — validation is the expensive step; oversized waves make validation impossible to do well.

---

## Reference

### Migration template
`db/mmff_vector/schema/186_users_password_resets_column_prefix_RF1_4_4.sql` — read first

### Naming spec
`docs/c_c_naming_conventions.md` §2.3 (column-prefix), §2.4 (PK/FK shape), §2.8 (rename history), §2.9 (known carve-outs)

### Live-DB query for current bare-column gaps
See SQL block above under "Live-DB current state"

### Snapshot DBs (queryable safety net)
- `mmff_vector_snapshot_20260525`
- `vector_artefacts_snapshot_20260525`
- `mmff_library_snapshot_20260525`
- `mmff_dev_snapshot_20260525`

Access via:
```bash
ssh -o ExitOnForwardFailure=no vector-dev-pg \
  "docker exec \$(docker ps --format '{{.Names}}' | grep '^vector-dev_postgres') \
   psql -U mmff_dev -d <snapshot_name> -c '<sql>'"
```

### Pre-rewind backup (from pre-push hook)
- `20260526_025726_3ec7885e_dev_mmff_vector.sql` (1.6 MB)
- `20260526_025726_3ec7885e_dev_vector_artefacts.sql` (3.9 MB)
- `20260526_025726_3ec7885e_dev_mmff_library.sql` (34 KB)

Path on remote: standard backup-on-push location.

### Pool-swap site enumeration (Pillar 3 driver)
`handovers/wipe_reseed_pool_swap_sites.md` — every `NewService(pool, ...)` site in `backend/cmd/server/main.go`. This IS the Pillar 3 backend-repoint inventory; every entry there gets converted from `pool` → `vaPool` (or merged with an existing vaPool service) after Pillar 2 ships. Cross-reference against `docs/c_c_db_routing.md` as you go.

---

## Anti-patterns to avoid (the 8-hour lesson from the previous attempt)

Don't repeat any of these:

1. **Don't propose a column-prefix rule without reading `docs/c_c_naming_conventions.md` §2.3 first.** The previous attempt invented a 3-letter-abbreviation variant (`users.usr_id`, `subscriptions.sub_*`, etc.), built a 76-entry registry, then discovered the established full-table-name convention already in tree. ~2 hours wasted on the detour + revert. The full-name rule is mechanical, zero-collision, and matches existing committed migrations (186–190 + 063–066).

2. **Don't synthesise migrations from `pg_dump --schema-only`.** It works structurally but loses semantic context (shared `set_updated_at` becomes table-hardcoded, sequences disappear from `bigserial` columns, polymorphic dispatch functions get dropped without their callers being repointed). The previous attempt produced 164 collapse files with 4 latent structural defects. ~3 hours wasted before dry-run replay caught the issues. Use the existing `ALTER TABLE RENAME COLUMN` pattern (migration 186) instead — it edits live schema in place, no semantic loss.

3. **Don't trust an agent's "verified by spot-check" claim.** The previous Wave 2D agent claimed verification; opening 3 files found 4 structural defects (`set_updated_at` hardcoded, `dispatch_polymorphic_parent` orphan reference, 4 bare-column refs in `fn_users_roles_pages_cascade_nav_prefs`, 2 missing sequence definitions). **Always open files between waves and check before dispatching the next agent.**

4. **Don't chain agents without verification gates.** The previous attempt chained Wave 2D → 2E without inspecting 2D's output. 2E built ~900 column rewrites on top of an unverified foundation; both had to be reworked.

5. **Don't trust the `## §2.8 — STATUS: COLUMN-PREFIX SWEEP COMPLETE` claim in the naming doc.** It's overstated — only ~50% of tables were swept in the 2026-05-14 work. Read live-DB column shapes via `information_schema.columns` (the SQL is in this handover), not the doc's status line.

6. **Don't conflate the three pillars** (added 2026-05-26 with the scope expansion). When tempted to combine "rename column" + "move to other DB" + "drop FDW" into a single migration: stop. Each pillar has independent failure modes and independent rollback paths. A combined migration that fails partway leaves the DB in an unrecoverable state. Sequence: Pillar 1 fully green → snapshot → Pillar 2 fully green → snapshot → Pillar 3 fully green → snapshot. Pillar boundaries are commit boundaries, not "branch boundaries we'll squash later."

**The right approach is always:** read the existing convention doc first, find the partial work, finish it the same way. Estimated ~3-4 hours for Pillar 1 (column-prefix sweep on 27 tables). Total for all three pillars: ~10-15 hours.
