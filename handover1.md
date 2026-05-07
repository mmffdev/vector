# Handover 1 — Sprints / TimeboxManager scoping session
**Date:** 2026-05-07  
**Branch:** main  
**Last commit:** dc01be5 — PLA-0026/00504 saga integration test

---

## What we did this session

### 1. Migration 025 — `timebox_sprints` (vector_artefacts DB)

**Files:**
- `db/artefacts_schema/025_timebox_sprints.sql` ← **new, untracked**
- `db/artefacts_schema/down/025_timebox_sprints_DOWN.sql` ← **new, untracked**
- `docs/c_schema.md` ← **modified** (sprints row updated)

**What it does:**
- Drops the minimal `sprints` table (from migration 013).
- Creates `timebox_sprints` with the full Sprint Setup column set — all columns are `sprint_*` prefixed per the brief:
  - Identity: `id`, `subscription_id`, `workspace_id`, `org_node_id` (nullable soft-UUID; writer service validates team-level)
  - Form fields: `sprint_name`, `sprint_suffix`, `sprint_owner`, `sprint_cadence_days`, `sprint_date_start`, `sprint_date_end`
  - Rolled-up metrics: `sprint_scope`, `sprint_velocity`, `sprint_estimate` (default 0)
  - Creep counters: `sprint_creep_by_count`, `sprint_creep_by_estimate` (default 0; populated post-start)
  - Lifecycle: `status` (planned/active/completed), `sprint_date_added`, `sprint_date_updated`, `archived_at`
- Renames `artefacts.sprint_id` → `artefacts.timebox_sprint_id` and repoints FK at the new table.
- Adds `btree_gist` extension + EXCLUDE constraint on `(workspace_id, org_node_id, daterange(start, end, '[]'))` — DB rejects overlapping live sprints in the same team.

**Not yet applied to dev DB.** Run when ready:
```bash
psql -U mmff_dev -d vector_artefacts -f db/artefacts_schema/025_timebox_sprints.sql
```

---

### 2. Design doc — `<TimeboxManager>` component

**Files:**
- `docs/c_c_timebox_manager.md` ← **new, untracked**
- `.claude/CLAUDE.md` ← **modified** (pointer line added)

**Key decisions locked in:**
- Single reusable component `app/components/TimeboxManager.tsx` — drives sprints, releases, future timebox kinds.
- **Table-per-kind** storage (not a unified table with discriminator). Each kind owns its schema, lifecycle, and Go service.
- Kind→table registry in `app/components/timebox/kinds.ts` (shared TS const; component and callers both import it). Adding a kind = add a registry row + migration + Go service; component not touched.
- `kind` prop (lowercase) — matches project's `_kind` discriminator vocabulary. Not `type`.
- **Samantha SDK — 3-level addressing:**
  - `samantha._timebox` — all timeboxes the caller can see (cross-kind)
  - `samantha._timebox.<kind>` — collection for one kind, e.g. `samantha._timebox.sprint`
  - `samantha._timebox.<kind>.<name>` — single row, e.g. `samantha._timebox.sprint.sprint-0001`

---

## What is NOT done yet — pick up from here

In priority order:

### A. Apply migration 025 to dev DB
```bash
psql -U mmff_dev -d vector_artefacts -f db/artefacts_schema/025_timebox_sprints.sql
```
Remember to backfill `schema_migrations` if applied via raw psql (per project push-often rule).

### B. Commit the session's files
Uncommitted new/modified files from this session:
- `db/artefacts_schema/025_timebox_sprints.sql`
- `db/artefacts_schema/down/025_timebox_sprints_DOWN.sql`
- `docs/c_c_timebox_manager.md`
- `docs/c_schema.md`
- `.claude/CLAUDE.md`

### C. Create a PLA-NNNN for Sprints feature
Use `<stories>` to decompose across **all layers** before any code:
1. **DB** — 025 migration (done), future: `timebox_releases`
2. **Go service** — `internal/timeboxsprints` (sole writer; team-level org_node validation; adjacency enforcement: B.start = A.end + 1; bulk-create transaction)
3. **REST surface** — `/api/v2/timeboxes/sprints` CRUD + bulk-create endpoint
4. **Page registry** — `mmff_vector` migration: `pages` row for `planning/sprints`, Planning tag, nested default
5. **Samantha** — register `_timebox` substrate (3 levels) per [c_c_addressables.md](docs/c_c_addressables.md)
6. **Frontend route** — `app/(app)/planning/sprints/page.tsx`
7. **Component** — `app/components/TimeboxManager.tsx` + `app/components/timebox/kinds.ts`
8. **Tests** — Go service unit tests (adjacency, non-overlap, bulk-create); integration test

### D. Page placement contract (when page registry row lands)
- URL: `/planning/sprints`
- Default: nested under Planning nav group (sub-tab in secondary nav)
- Deep-link: even if user promotes to L1 nav, link opens `/planning/sprints` per [c_c_secondary_nav_deeplink.md](docs/c_c_secondary_nav_deeplink.md)
- Visible to: `padmin` (product owners create/manage sprints); `user` read-only view TBD
- Pattern: same deep-link contract as Work Items, Topology — see [c_page-structure.md](docs/c_page-structure.md)

---

## Reference docs written this session

| Doc | Purpose |
|---|---|
| [`docs/c_c_timebox_manager.md`](docs/c_c_timebox_manager.md) | Full component contract, prop surface, kind registry, Samantha addressing, sprint-specific rules, not-yet-built checklist |
| [`db/artefacts_schema/025_timebox_sprints.sql`](db/artefacts_schema/025_timebox_sprints.sql) | Migration — full timebox_sprints schema |
| [`db/artefacts_schema/down/025_timebox_sprints_DOWN.sql`](db/artefacts_schema/down/025_timebox_sprints_DOWN.sql) | Rollback migration |

---

## Active plan context

PLA-0026 is still in-flight (adopt saga / vector_artefacts cutover). The Sprints work is a **new PLA** — do not fold sprint stories into PLA-0026. Create a fresh plan via `<stories>` decomposition when ready to build.
