---
name: Session handoff — PLA-0027 Sprints timebox complete; all committed and pushed
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: 41500057-955a-48d3-8a2b-127aef04c94b
---

## Current state (last updated: 2026-05-07)

**Active branch:** `main`
**Story index last issued:** `00520`
**Phase:** PH-0005
**Branch is clean** — all work committed and pushed to origin. `git status` shows nothing pending.

---

## Planka card states

**Completed this session (move to Completed in Planka if not already):**
- 00513 — `internal/timeboxsprints` Go service (CRUD + validation)
- 00514 — `/api/v2/timeboxes/sprints` REST surface + main.go wiring
- 00515 — Integration tests (≥80% coverage)
- 00516 — Migration 129 + 130: `planning/sprints` page registry (user/padmin/gadmin)
- 00517 — `app/(user)/planning/sprints/page.tsx` frontend route
- 00518 — `<TimeboxManager>` component + `timebox/kinds.ts` registry + bulk-create form
- 00519 — Samantha `_timebox` substrate registration
- 00520 — Docs update (`c_schema.md` + `c_c_timebox_manager.md`)

**In progress / Doing:**
- None.

**Parked:**
- None.

---

## Uncommitted on branch

Branch is clean. All changes committed and pushed in two commits:
- `e105fd4` — `feat(PLA-0027): sprints timebox — full E2E implementation`
- `f2b1640` — `chore: misc session changes — auth, workitemsv2, dev panels, portfolio`

---

## What shipped this session

### PLA-0027 — Sprints Timebox System (complete)

**Backend (`backend/internal/timeboxsprints/`):**
- `types.go` — `Sprint`, `CreateSprintInput` (includes `SprintVelocity *int`), `UpdateSprintInput`, `ListFilters`
- `service.go` — `Create`, `BulkCreate`, `Update`, `Delete`, `List` with validation, overlap guard, adjacency check
- `handler.go` — REST handlers for all CRUD operations + `BulkCreate`; `BulkCreate` body now includes `sprint_velocity`
- `service_test.go` — 13+ targeted tests pushing coverage to ≥80.4%
- Wired in `backend/cmd/server/main.go` when `vaPool != nil`; fallback 503 when nil

**Database (`db/schema/`):**
- `129_sprints_page.sql` — registers `planning/sprints` page (key_enum, href, icon `timer`, order 7); grants `user` + `padmin` roles; backfills `user_nav_prefs` for existing accounts
- `130_sprints_page_gadmin.sql` — extends to `gadmin` role (user requested all roles); both migrations applied to dev DB

**Frontend:**
- `app/components/timebox/kinds.ts` — `TIMEBOX_KINDS` registry; sprint entry with `apiBase`, `namePrefix`, `bindsToTeam`, `enforcesNonOverlap`, `tracksCreep`
- `app/components/TimeboxManager.tsx` — single component switched by `kind` prop:
  - **List view**: renders `<Table>` with columns: Name (with suffix in muted parens), Start, End, Cadence, Status (pill), Scope, Velocity
  - **Create view**: "Create Sprints" button in panel title; opens bulk-create form with:
    - "Number of Sprints" counter (1–52) that generates N rows
    - `<Table>` with `kind: "custom"` columns: Name (static label, not editable), Suffix (optional), Start (row 0 editable, rows 1+ locked), Cadence (days), End (derived, read-only), Velocity (integer, optional)
    - Date arithmetic uses `Date.UTC` to avoid DST/timezone shifts — cadence 14 from May 7 = May 7→May 20, next starts May 21
    - POSTs to `/api/v2/timeboxes/sprints/bulk-create?workspace_id=...`
  - Outer wrapper registers `useRegisterAddressable({ kind: "timebox", name: kind })` for Samantha `_timebox` substrate
- `app/(user)/planning/sprints/page.tsx` — route `/planning/sprints`; uses `useAuth()` for `workspaceId`; renders `<TimeboxManager kind="sprint" workspaceId={workspaceId} />`

**Docs:**
- `docs/c_c_timebox_manager.md` — status updated to "built — PLA-0027 complete"
- `docs/c_schema.md` — `timebox_sprints` sole-writer note added

### vaPool / backend restart issue (resolved)
The running backend had `vaPool == nil` because it was started with `BACKEND_ENV=dev` which loads `.env.dev` — that file doesn't have `VECTOR_ARTEFACTS_DB_URL`. The correct start is `go run ./cmd/server` from `backend/` with no env override, which loads `.env.local` (has all VA_DB vars). Always start backend without `BACKEND_ENV` set.

### Other changes in `f2b1640`
These were pre-existing session changes committed together:
- `auth/handler.go` + `login/page.tsx` — session feedback improvements
- `AuthContext.tsx` + `DevTabContext.tsx` — context cleanup  
- `AdoptionOverlay.tsx` + `app/v2/custom-fields/page.tsx` — UI polish
- `workitemsv2` handler/service + new tests (`handler_test.go`, `service_test.go`)
- `DevPage.tsx` + `DevApiV2TestsPanel.tsx` + `app/api/dev/go-test/route.ts` — v2 API test panel in Dev Setup
- `portfoliomodels` test fixes
- `docs/c_tech_debt.md` — entries added
- `dev/research/R048.json` — research paper

---

## Recent commits

```
f2b1640 chore: misc session changes — auth, workitemsv2, dev panels, portfolio
e105fd4 feat(PLA-0027): sprints timebox — full E2E implementation
fd1de12 feat(PLA-0027): create Sprints plan + allocate stories 00513–00520
f31e356 feat(WS2-B): migrate library-releases to notify.* toast system
a14947f docs: handover2 — PLA-0026 wrap state + remote pickup notes
26e861a feat(sprints): timebox_sprints migration + TimeboxManager design doc
```

---

## What's next

1. **Sprints page — create UI gaps:** The bulk-create form is functional but minimal. Known missing pieces:
   - No per-row cadence override (all rows inherit row 0's cadence; each row's cadence field is rendered but cascade only re-runs when row 0 changes — a user editing row 3's cadence doesn't cascade forward)
   - No edit/delete UI for existing sprints in the list view
   - No "current sprint" highlight in the list (the DB `status` column exists — active sprint should be visually distinct)
   - `orgNodeId` is not being passed to `TimeboxManager` from the Sprints page (topology binding — sprints are supposed to bind to a team node; currently all sprints are workspace-scoped only)

2. **PLA-0020 (E2E Human-Friendly Feedback):** Check `dev/plans/PLA-0020.json` — WS1-B (batch-update remaining `httperr.Write` call sites to use `messages.*`) and WS2-B (migrate per-component error `useState` → `notify.apiError()`) were in-progress. WS1-A, WS2-A were complete.

3. **PLA-0026 wrap-up:** Check Planka for any remaining PLA-0026 cards not yet moved to Completed.

4. **workitemsv2 tests:** `handler_test.go` and `service_test.go` were committed but verify they pass: `cd backend && go test ./internal/workitemsv2/...`

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100/v1` (versioned base; backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content) + `vector_artefacts` (artefact cutover DB)
- **Backend start:** `go run ./cmd/server` from `backend/` — NO `BACKEND_ENV` override, loads `.env.local` which has `VECTOR_ARTEFACTS_DB_URL`; health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|artefacts|both]`
- **SSH tunnel for vector_artefacts:** `ssh -fN vector-dev-pg` forwards `localhost:5435` → remote `vector_artefacts` DB. Must be up before starting backend or `sprintH` will be nil and sprints return 503.
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `password`
- **padmin test account:** `padmin@mmffdev.com` / `password`
- **user test account:** `user@mmffdev.com` / `password`
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Planka list IDs:** Backlog=1760700028730475544, To Do=1760700252018443289, Doing=1760700299682513946, Completed=1760700351842878491
- **Planka helper:** `./.claude/bin/planka` is the SOLE entry point for board reads/writes — never use curl directly
- **Active backend env:** `dev` — DB tunnel at `localhost:5435`, env file `backend/.env.local`
- **vaPool nil trap:** If backend is started with `BACKEND_ENV=dev` it loads `.env.dev` which lacks `VECTOR_ARTEFACTS_DB_URL` → vaPool nil → sprintH nil → sprints return 503. Always start without `BACKEND_ENV`.
- **Sprints API base:** `/api/v2/timeboxes/sprints` — bulk-create at `/api/v2/timeboxes/sprints/bulk-create?workspace_id=...`
- **TimeboxManager Table columns use unique keys:** The `<Table>` component uses `col.key` as React key — all six bulk-create columns must have distinct keys (`_idx`, `sprint_suffix`, `sprint_date_start`, `sprint_cadence_days`, `sprint_date_end`, `sprint_velocity`)
- **Date arithmetic:** All sprint date math uses `Date.UTC(y, m-1, d+n)` to avoid DST/timezone shifts — never use `new Date(dateStr + "T00:00:00")` with `.toISOString()`
