# Handover — 2026-05-14 session

**For:** Rick (back from meeting) — or the next Claude session picking up this branch.
**Branch:** `001_redesign` (pushed to `origin/001_redesign`, up to commit `586d050`).
**Backups:** Every push triggered the backup-on-push hook; all three DBs snapshotted under `MMFFDev - Vector Assets/db-backups/` on each commit. Latest snapshot: `20260514_071902_586d050_*`.

---

## TL;DR

PLA-0048 phases **RF1.4.4 + RF1.5 + RF1.6 all shipped end-to-end same day**. TD-NAME-001 closed. `lint:column-prefix-convention` flipped from warn-only to hard fail-on-violation. 12 commits, 9 column-rename migrations, ~245 SQL constants rewritten, 9 → 0 packages on the lint ledger.

**Stop gate awaiting you:** RF1.6.5 — your review of the regenerated docs (`docs/c_c_db_routing.md`, `docs/c_schema.md`, `docs/c_c_naming_conventions.md`).

---

## What was shipped

### Commits (newest first, all on `001_redesign`)

| Commit | What |
|---|---|
| `586d050` | Close-out: TD-RESET-001 fix inline + `Vector_Scope.md` markers (RF1.4.4 + RF1.5 + RF1.6 ✅) |
| `c7f74bc` | **Pay-down #9 (final) — TD-NAME-001 CLOSED.** users_nav family (5 tables); lint flipped to hard gate |
| `f573da8` | Pay-down #8 — artefacts_types (19 cols) |
| `5b6bf20` | Pay-down #7 — flows family (7 tables, ~50 cols) |
| `3ad9531` | Pay-down #6 — RBAC triangle (users_roles + users_permissions + users_roles_permissions) |
| `8cdb4a9` | Pay-down #5 — users_roles_workspaces (junction; first §2.4 multi-FK role-suffix exercise) |
| `7f9416f` | Pay-down #4 — artefacts_fields_values + Go package rename `artefactitemsv2` → `artefactitems` |
| `7773c95` | Pay-down #3 — users_sessions |
| `c6d3b19` | Pay-down #2 — master_record_tenants (first cross-package writer pattern) |
| `2c4fc9b` | Pay-down #1 — users_password_resets (proof of template) |
| `d00e3d1` | `lint:column-prefix-convention` shipped warn-only (baseline 245 findings / 9 packages) |
| `4e1e171` | RF1.6 documentation pass (db_routing + schema + naming conventions + CLAUDE.md trim) |

### Migration files added

**mmff_vector:**
- `186_users_password_resets_column_prefix_RF1_4_4.sql`
- `187_users_sessions_column_prefix_RF1_4_4.sql`
- `188_users_roles_workspaces_column_prefix_RF1_4_4.sql`
- `189_users_roles_rbac_column_prefix_RF1_4_4.sql`
- `190_users_nav_family_column_prefix_RF1_4_4.sql`

**vector_artefacts:**
- `063_master_record_tenants_column_prefix_RF1_4_4.sql`
- `064_artefacts_fields_values_column_prefix_RF1_4_4.sql`
- `065_flows_family_column_prefix_RF1_4_4.sql`
- `066_artefacts_types_column_prefix_RF1_4_4.sql`

All applied to dev, all backfilled into `schema_migrations`, all backed up. **Staging/production: not applied yet** — by design, dev-only per the hard rule.

### New lints + ledgers

- `dev/scripts/lint_column_prefix_convention.py` — now hard gate. Ledger at `dev/registries/column_prefix_exempt.json` is empty.
- `dev/scripts/lint_cross_db_writer_test.py` (from RF1.5) — shrinking ledger; 6 packages still on it.

### Three TDs filed this session

| ID | Severity | Status |
|---|---|---|
| ~~TD-NAME-001~~ | S3 | **Resolved 2026-05-14 (same day)** — full column-prefix pay-down |
| ~~TD-RESET-001~~ | S2 | **Resolved 2026-05-14** — broken `subscription_id` DELETE on artefacts_fields_values; fixed inline |
| TD-TEST-001 | S2 | Open — stale `fn_master_record_tenant_seed_for_subscription` trigger; breaks ~15 integration tests |
| TD-NAME-002 | S3 | Open — six deferred §3.3 route renames (bookmarks, tab-order, api-keys verbs, flow-states nested, errors-report, tenant-settings) |

Plus TD-TOP-001 was filed earlier — sole-writer boundary violation in portfoliomodels dev_reset; not addressed this session.

---

## Convention deltas (what changed in the spec)

- **§2.3 column-prefix rule** — now enforced everywhere on renamed §2.6 root-family tables. `lint:column-prefix-convention` is a hard gate.
- **§2.4 FK shape** — `<table>_id_<target>` for single FKs, plus role suffix for multi-FK (e.g. `users_roles_workspaces_id_user_granted_by` vs `users_roles_workspaces_id_user_revoked_by`).
- **§1.1.2 v-suffix rule** — clarified through the artefactitemsv2 → artefactitems rename. Lesson: version suffixes are intentional but **temporary**. They earn their place while the older surface still casts a shadow (active directory, callable handler); they drop when it doesn't. Memory saved at `.claude/memory/project_artefactitems_rename.md`.
- **§4.1 migration numbering** — 3-digit unpadded sequence per DB, re-pad only at 999→1000 boundary.

---

## Carve-outs (intentional deferrals)

Two core tables remain **bare-columned** per §2.9, tracked when frontend wire-tag rewrite lands:

- **`artefacts`** core table — distinct from `artefacts_types` / `artefacts_fields_values` / `artefacts_adoption_states`, which ARE prefixed
- **`users`** core table

Reason: their columns map 1:1 to JSON wire-tags consumed by ~120 frontend sites. Renaming the DB columns without rewriting the wire contract would break the frontend; rewriting the wire contract is a separate PLA.

---

## What's still pending in scope (RF1.7 + beyond)

### Open RF1 stop gate
- **RF1.6.5** 🔵 — Your review of the regenerated docs. Bullets to verify:
  - `docs/c_c_db_routing.md` — service→pool→DB→tables map reflects all renames
  - `docs/c_schema.md` — RF1.4.2 banner + table list updated
  - `docs/c_c_naming_conventions.md` §2.8 — status row reads "COLUMN-PREFIX SWEEP COMPLETE"
  - `docs/c_c_lint_rules.md` — `lint:column-prefix-convention` marked HARD GATE
  - `Vector_Scope.md` — RF1.4.4 + RF1.5 + RF1.6 marked ✅

### RF1.7 completion tests (not yet run)
- `RF1.7.1` Open any `backend/internal/<pkg>/` and verify `doc.go` + `service.go` + `handler.go` + `sql.go` + tests in that order
- `RF1.7.2` Read `docs/c_c_naming_conventions.md` once and predict every future name

### Open TDs from this session
- `TD-TEST-001` (S2) — stale trigger; 1-hour fix
- `TD-NAME-002` (S3) — 6 route renames; ~half a day per family
- `TD-TOP-001` (S2, pre-session) — topology sole-writer boundary; ~45 min

### Working-tree state (yours, not mine)
At handover time the working tree has uncommitted changes I did NOT touch:
- `.claude/CLAUDE.md` (your trim)
- `Vector_Scope.md` (further edits beyond the markers I added)
- `dev/pages/DevScopePanel.tsx`
- `dev/styles/dev-ui.css`
- New files: `.claude/commands/c_backlog.md`, `BACKLOG.md`, plus a feedback memory `.claude/memory/feedback_no_hardcoded_order_from_db_data.md`

Decide whether to commit these under your own message or discard.

---

## How to verify clean state

```bash
# Branch + remote sync
git status
git log --oneline origin/001_redesign..HEAD     # empty = pushed

# Build + lint
cd backend && go build ./...
cd .. && npm run lint:rf1                       # 6 lints, all green

# DB sanity (dev only — per hard rule)
PGPASSWORD=... psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
  -c "SELECT filename FROM schema_migrations WHERE filename LIKE '18%_RF1_4_4%' OR filename LIKE '19%_RF1_4_4%' ORDER BY filename;"
# Expect: 186_users_password_resets, 187_users_sessions, 188_users_roles_workspaces,
#         189_users_roles_rbac, 190_users_nav_family

PGPASSWORD=... psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
  -c "SELECT filename FROM schema_migrations WHERE filename LIKE '06%_RF1_4_4%' ORDER BY filename;"
# Expect: 063_master_record_tenants, 064_artefacts_fields_values, 065_flows_family,
#         066_artefacts_types
```

## Where the audit trail lives

- **Pay-down log:** `dev/registries/column_prefix_exempt.json` (the `$comment` block records each migration + delta — survives even though `exempt_packages` is now empty)
- **TD register:** `docs/c_tech_debt.md` (TD-NAME-001 + TD-RESET-001 struck through with resolved-on dates and full pay-down notes; TD-TEST-001 + TD-NAME-002 remain open)
- **Conventions canon:** `docs/c_c_naming_conventions.md` §2.8 + §3.3 status rows
- **Lessons:** `.claude/memory/project_artefactitems_rename.md` (§1.1.2 v-suffix wisdom)

## Risks worth knowing

1. **Frontend may break against post-rename SQL** — most of this session was backend-only. Any frontend that reads bare column shapes via direct fetch (rather than through the Go API which transforms via `MapPublic*` mappers) will hit shape mismatches. Worth a smoke test on the next dev session.
2. **Integration tests still fail locally** — TD-TEST-001 (stale trigger) blocks any test path that calls `mkTenant` / `mkSubscription`. CI gate hasn't surfaced this yet because integration tests are build-tag-gated.
3. **Staging/prod haven't seen these migrations** — by design (dev-only hard rule). When staging deploy happens, all 9 migrations run as a single batch in commit order. They are all idempotent ALTER TABLE / ALTER INDEX renames inside `BEGIN`/`COMMIT`, so safe to replay or rerun, but **stop and verify each DB has the migration tracker rows BEFORE the runner replays anything**.

## Resuming

If you want to keep paying down tech debt, the natural next targets in priority order:
1. **TD-TEST-001** (S2, 1 hour) — DROP the stale trigger + audit `mkTenant`/`mkSubscription` fixtures across 5 test packages
2. **TD-TOP-001** (S2, 45 min) — add `topology.Service.ResetForSubscription` + rewrite `dev_reset.go::masterResetVA`
3. **TD-NAME-002** (S3, ~half day per route family) — start with bookmarks (smallest)

If you want to move on from PLA-0048: it's effectively done. RF1.7 completion tests + your doc-review stop gate are the only remaining items in the conveyor.

— Claude (Opus 4.7), 2026-05-14
