# Handover 2 — WorkItemsTree wired to vector_artefacts

**Date:** 2026-05-07
**Branch:** main
**Last commit:** `f31e356 feat(WS2-B): migrate library-releases to notify.* toast system`

---

## What this session fixed

### Problem

WorkItemsTree on the Work Items page showed 0 rows despite the summary header correctly showing 15 items. The tree has been broken since the `sprint_id` → `timebox_sprint_id` column rename landed in the `artefacts` table.

### Root causes (two, both fixed)

**1. `backend/.env.dev` was missing two env vars**

The backend loads `backend/.env.dev` when `BACKEND_ENV=dev`. This file was missing:

```env
VECTOR_ARTEFACTS_DB_URL=host=localhost port=5435 user=mmff_dev password=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi dbname=vector_artefacts sslmode=disable
WORK_ITEMS_V2=true
```

Both have now been added (lines 34–35 of `backend/.env.dev`). Without `VECTOR_ARTEFACTS_DB_URL`, `vaPool` stays nil and the service returns empty slices silently. Without `WORK_ITEMS_V2=true`, the route isn't registered.

**2. `workitemsv2/service.go` — SQL column name mismatch**

The `artefacts` table column was renamed from `sprint_id` → `timebox_sprint_id` by an earlier migration (`db/artefacts_schema/025_timebox_sprints.sql`), but the Go service SQL strings were never updated. All SELECT queries referencing `a.sprint_id::text` returned a 500 from Postgres ("column does not exist").

Fixed in `backend/internal/workitemsv2/service.go`:

- `a.sprint_id::text` → `a.timebox_sprint_id::text` in all three SELECT queries (ListWorkItems, GetWorkItem, ListChildren)
- `a.sprint_id = $N::uuid` → `a.timebox_sprint_id = $N::uuid` in WHERE filters (ListWorkItems filter, SummariseWorkItems sprint filter)
- `sprint_id = NULL` / `sprint_id = $N::uuid` → `timebox_sprint_id` in PatchWorkItem SET clause
- `sprint_id` → `timebox_sprint_id` in INSERT column list (CreateWorkItem)
- `a.sprint_id %s NULLS LAST` → `a.timebox_sprint_id %s NULLS LAST` in buildOrderBy sort

**Verification after restart:**

```text
GET /v1/api/v2/work-items → 200, 3 root epics returned (correct)
GET /v1/api/v2/work-items/summary → 200, {total:15, epics:3, stories:6, tasks:4, defects:2}
```

The tree in the browser will now show 3 expandable epics with their children loading on expand.

---

## Dev seed data in vector_artefacts

The fixture `db/artefacts_schema/seed/01_work_items_fixture.sql` is applied. It contains:

- **3 Epics**, **6 Stories**, **4 Tasks**, **2 Defects**
- All for `subscription_id = 00000000-0000-0000-0000-000000000001`
- `workspace_id = 20000000-0000-0000-0000-000000000001` (fixture-only UUID)
- 3 archived rows were deleted before seed to clear a duplicate-key block: `DELETE FROM artefacts WHERE archived_at IS NOT NULL AND subscription_id = '00000000-0000-0000-0000-000000000001'`

---

## Active backend state

- **`BACKEND_ENV=dev`** — pinned, do not change
- SSH tunnel `localhost:5435` → dev VPS Postgres (both `mmff_vector` and `vector_artefacts` via same tunnel port)
- Backend process: `BACKEND_ENV=dev go run ./cmd/server/.` in `backend/`
- Logs show: `vector_artefacts pool connected` on start

To restart after a crash:

```bash
cd backend
BACKEND_ENV=dev go run ./cmd/server/. &
# watch for: "vector_artefacts pool connected"
curl http://localhost:5100/healthz
```

---

## Files changed this session

| File | Change |
| --- | --- |
| `backend/.env.dev` | Added `VECTOR_ARTEFACTS_DB_URL` + `WORK_ITEMS_V2=true` |
| `backend/internal/workitemsv2/service.go` | All `sprint_id` SQL column refs → `timebox_sprint_id` (7 sites) |

Neither change is committed yet.

---

## Remaining known issues (pre-existing, not touched this session)

- **`workitemsv2` test suite** — `sprint_id` → `timebox_sprint_id` rename is also broken in the test fixtures/queries. User declined to fix in this session ("no"). Fix when the test suite is next run.
- **cross_db_canary_test.go** — `{"timebox_sprints", true}` is commented out. Once migration 025 is confirmed applied and canary is re-run, uncomment the line.
- **PLA-0026 deferred drops** (00485–00489) — gated on 7-day deployment soaks, not actionable yet. See prior handover notes.
- **TD-FE-002** — WorkspaceContext pattern (S3), trigger at 3rd production consumer.

---

## Next concrete unit of work

Work Items tree is now functional. Candidate next tasks:

1. **Test the tree in the browser** — verify epics expand to show stories/tasks, inline edits work (title, due date, status pill).
2. **Fix the test suite** — update `workitemsv2/*_test.go` `sprint_id` → `timebox_sprint_id` (user declined this session but it will break `go test`).
3. **Check PLA-0027 plan status** — 8 stories marked `todo` in `dev/plans/PLA-0027.json` despite most code shipped; flip statuses to reflect reality.
4. **Move to next feature** — check `docs/c_plan_index.md`.

---

_Wrote on cookra@me.com's local; safe to delete after pickup._
