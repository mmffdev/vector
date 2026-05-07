# Handover — PLA-0027 Sprints Timebox complete
**Date:** 2026-05-07  
**Branch:** main  
**Last commit:** f2b1640 — chore: misc session changes  
**Story index last issued:** `00520`  
**Branch is clean — everything committed and pushed.**

---

## What was done this session

### PLA-0027 — Sprints Timebox System (all 8 stories complete)

#### Backend — `backend/internal/timeboxsprints/`
- `types.go` — `Sprint` struct, `CreateSprintInput` (with `SprintVelocity *int`), `UpdateSprintInput`, `ListFilters`
- `service.go` — `Create`, `BulkCreate`, `Update`, `Delete`, `List`; overlap guard via DB EXCLUDE constraint; adjacency enforcement; `validateCreateInput`
- `handler.go` — REST handlers for all CRUD + `BulkCreate`; `BulkCreate` body struct includes `sprint_velocity *int` wired through to service
- `service_test.go` — 13+ targeted tests, coverage ≥80.4%
- Wired in `backend/cmd/server/main.go` when `vaPool != nil`; fallback 503 when vaPool is nil

#### Database — `db/schema/`
- `129_sprints_page.sql` — registers `planning/sprints` page in `mmff_vector`; grants `user` + `padmin` roles; backfills `user_nav_prefs`
- `130_sprints_page_gadmin.sql` — extends page_roles + nav backfill to `gadmin` (requested mid-session)
- Both migrations applied to dev DB

#### Frontend
- `app/components/timebox/kinds.ts` — `TIMEBOX_KINDS` registry; sprint entry with `apiBase: "/api/v2/timeboxes/sprints"`, `namePrefix: "Sprint"`, `bindsToTeam`, `enforcesNonOverlap`, `tracksCreep`
- `app/components/TimeboxManager.tsx` — single component switched by `kind` prop:
  - **List view**: `<Table>` with columns: Name (shows suffix in muted parens if present), Start, End, Cadence, Status (pill), Scope, Velocity
  - **Create view**: "Create Sprints" button in panel title opens bulk-create form:
    - "Number of Sprints" counter (1–52) generates N rows instantly
    - Uses `<Table kind="custom">` columns — Name is a static label (not editable), Suffix optional, Start (row 0 editable, rows 1+ locked/cascaded), Cadence, End (derived), Velocity (integer, optional)
    - Date arithmetic uses `Date.UTC` — 14-day sprint from May 7 → May 20, next starts May 21 (timezone-safe)
    - POSTs to `/api/v2/timeboxes/sprints/bulk-create?workspace_id=...`
  - Outer wrapper registers `useRegisterAddressable({ kind: "timebox", name: kind })` for Samantha `_timebox` substrate
- `app/(user)/planning/sprints/page.tsx` — route `/planning/sprints`; uses `useAuth()` for `workspaceId`

#### Docs
- `docs/c_c_timebox_manager.md` — status updated to "built — PLA-0027 complete"
- `docs/c_schema.md` — `timebox_sprints` sole-writer note updated

---

## Bugs fixed during session

1. **vaPool nil → "timebox sprints not enabled" toast** — backend was started with `BACKEND_ENV=dev` which loads `.env.dev`; that file lacks `VECTOR_ARTEFACTS_DB_URL`. Fix: always start backend without `BACKEND_ENV` set (loads `.env.local`). Restarted backend, vaPool now connects.

2. **Date arithmetic off-by-one** — `new Date(dateStr + "T00:00:00").toISOString()` was shifting dates in certain timezones. Fixed to `Date.UTC(y, m-1, d+n)`.

3. **React duplicate key error** — `<Table>` uses `col.key` as React key. Two columns had `key: "sprint_suffix"` and two had `key: "sprint_date_start"`. Fixed all six bulk-create columns to unique keys: `_idx`, `sprint_suffix`, `sprint_date_start`, `sprint_cadence_days`, `sprint_date_end`, `sprint_velocity`.

4. **`sprint_velocity` not persisting** — the `BulkCreate` handler body struct was missing `SprintVelocity`, `CreateSprintInput` didn't have the field, and the INSERT queries didn't include `sprint_velocity`. Fixed all three layers (types.go, service.go ×2 queries, handler.go).

---

## Commits this session

```
f2b1640 chore: misc session changes — auth, workitemsv2, dev panels, portfolio
e105fd4 feat(PLA-0027): sprints timebox — full E2E implementation
fd1de12 feat(PLA-0027): create Sprints plan + allocate stories 00513–00520
f31e356 feat(WS2-B): migrate library-releases to notify.* toast system
```

---

## Known gaps / what's next

1. **Sprints list — no edit or delete UI.** The `Update` and `Delete` service methods exist and are tested but there are no frontend controls to invoke them. Likely needs an expander row or row action menu.

2. **Sprints list — no active sprint highlight.** The DB `status` column is computed (`planned` / `active` / `completed`) and returned in the list response, but the active sprint isn't visually distinguished beyond the status pill.

3. **`orgNodeId` not passed to TimeboxManager.** Sprints are supposed to bind to a team-level org node (`bindsToTeam: true` in kinds.ts). The Sprints page currently passes no `orgNodeId`, so all sprints are workspace-scoped only. A team picker or topology-derived node ID needs to be wired in.

4. **Per-row cadence override cascade is incomplete.** When the user edits cadence on row N (N > 0), the cascade doesn't re-run for rows N+1 onwards — only row 0's cadence change triggers a full cascade. Acceptable for now but worth fixing.

5. **PLA-0020 (E2E Human-Friendly Feedback):** WS1-B (batch-update remaining `httperr.Write` call sites to `messages.*`) and WS2-B (migrate per-component error `useState` → `notify.apiError()`) were in-progress before this session. Check `dev/plans/PLA-0020.json` for status.

6. **workitemsv2 tests** (`backend/internal/workitemsv2/handler_test.go` + `service_test.go`) — committed in `f2b1640` but not verified to pass. Run `cd backend && go test ./internal/workitemsv2/...` to confirm.

---

## Key facts for next agent

- **Backend start:** `go run ./cmd/server` from `backend/` — NO `BACKEND_ENV` env var, loads `.env.local` which has `VECTOR_ARTEFACTS_DB_URL`. Health at `:5100/healthz`.
- **SSH tunnel required:** `ssh -fN vector-dev-pg` forwards `localhost:5435` → `vector_artefacts` DB. Must be up before starting backend or `sprintH == nil` → sprints return 503.
- **Frontend:** Next.js on `:5101` (not `:3000`)
- **API:** `api()` helper → `http://localhost:5100/v1`
- **Two DB arch:** `mmff_vector` (main tenant data) + `vector_artefacts` (artefact/sprints cutover DB on port 5435)
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|artefacts|library|both]`
- **Test accounts:** `gadmin@mmffdev.com` / `password`, `padmin@mmffdev.com` / `password`, `user@mmffdev.com` / `password`
- **Planka helper:** `./.claude/bin/planka` — sole entry point for board reads/writes
- **Planka list IDs:** Backlog=1760700028730475544, To Do=1760700252018443289, Doing=1760700299682513946, Completed=1760700351842878491
- **Table component column keys must be unique** — `col.key` is used as the React key in `<Table>`
- **Sprints bulk-create API:** `POST /api/v2/timeboxes/sprints/bulk-create?workspace_id=<id>` with body `{ sprints: [{ sprint_name, sprint_suffix?, sprint_cadence_days, sprint_date_start, sprint_date_end, sprint_velocity?, org_node_id? }] }`
