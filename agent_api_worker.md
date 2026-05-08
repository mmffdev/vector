# Handover — API Rename (PLA-0028) + Contract Protection (PLA-0029)

**Date:** 2026-05-08
**Outgoing agent:** Claude Sonnet 4.6
**Branch:** `main`
**Backend env:** `dev` (pinned — never change this)
**Backend port:** `:5100` — `BACKEND_ENV=dev go run ./cmd/server/.` in `backend/`
**DB tunnel:** `localhost:5435` → dev VPS Postgres (both `mmff_vector` + `vector_artefacts`)

---

## What this session produced

### 1. WorkItemsTree fixed (already working)

`GET /v1/api/v2/work-items` was returning 500. Root causes were:

- `backend/.env.dev` missing `VECTOR_ARTEFACTS_DB_URL` and `WORK_ITEMS_V2=true`
- `backend/internal/workitemsv2/service.go` — 7 SQL strings still used `sprint_id` after the column was renamed to `timebox_sprint_id` in migration 025

Both fixed. Tree now returns 3 root epics correctly. **These changes are NOT yet committed.**

### 2. PLA-0028 — Samantha API Rename (designed + planned, NOT implemented)

Rename the entire API surface from `/v1/api/*` → `/samantha/v1/*`, dropping the `/api/` segment.

**Artefacts produced:**

| File | Status |
| --- | --- |
| `docs/superpowers/specs/2026-05-08-samantha-api-rename-design.md` | Written, not committed |
| `docs/superpowers/plans/2026-05-08-samantha-api-rename.md` | Written, not committed |
| `dev/plans/PLA-0028.json` | Written, not committed |
| `docs/c_plan_index.md` | Updated (PLA-0028 registered, counter bumped), not committed |

### 3. PLA-0029 — API Contract Protection (designed + planned, NOT implemented)

Four-layer toolchain: drift detection scripts, breaking-change git hook, snapshot + blast radius reporter, Dev panel, GitHub Actions stub.

**Artefacts produced:**

| File | Status |
| --- | --- |
| `docs/superpowers/specs/2026-05-08-api-contract-protection-design.md` | Written, not committed |
| `docs/superpowers/plans/2026-05-08-api-contract-protection.md` | Written, not committed |
| `docs/c_plan_index.md` | PLA-0029 row pending (not yet added — do this before starting Task 9) |

---

## Hard rules (never break these)

- **Backend env stays `dev`.** Do not switch, do not ask.
- **Human accounts off limits.** Never touch `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `user@mmffdev.com`.
- **No destructive git commands** without explicit user confirmation.
- **Dev UI primitives only** on `/dev` pages — `.dui-*` classes, no inline styles, no bespoke classes.

---

## Uncommitted changes at handover

Large number of modified backend files from prior sessions (roles rename, portfolio model work, etc.) — these predate this session. The files this session touched:

| File | Change |
| --- | --- |
| `backend/internal/workitemsv2/service.go` | 7× `sprint_id` → `timebox_sprint_id` SQL column fix |
| `dev/plans/PLA-0028.json` | New plan JSON |
| `docs/c_plan_index.md` | PLA-0028 registered, counter = PLA-0028 |
| `docs/superpowers/specs/2026-05-08-samantha-api-rename-design.md` | New spec |
| `docs/superpowers/plans/2026-05-08-samantha-api-rename.md` | New plan |
| `docs/superpowers/specs/2026-05-08-api-contract-protection-design.md` | New spec |
| `docs/superpowers/plans/2026-05-08-api-contract-protection.md` | New plan |

**`backend/.env.dev`** was fixed in a prior session but is also uncommitted. The user should decide what to commit before starting implementation.

---

## What to implement next

### Option A — PLA-0028 first (recommended)

The rename is a prerequisite for PLA-0029 to be meaningful — the contract toolchain should protect the *correct* URL shape. Do PLA-0028 first.

**Plan:** `docs/superpowers/plans/2026-05-08-samantha-api-rename.md`

**6 tasks:**

1. **Go router** — `backend/cmd/server/main.go`: change `r.Route("/v1", ...)` → `r.Route("/samantha/v1", ...)`, strip `/api/` from ~32 sub-route strings, hoist infra routes to root (`/api/env` → `/env`, etc.), extract v2 sub-routes into a new `r.Route("/samantha/v2", ...)` block. Also update `setRefreshCookie` Path in `backend/internal/auth/handler.go` from `/v1/api/auth` → `/samantha/v1/auth`.

2. **Frontend `api()` base URL** — `app/lib/api.ts`: `API_BASE` changes from `+ "/v1"` → `+ "/samantha/v1"`. Update 2 `apiInfra` call sites in `app/components/EnvBadge.tsx`: `/api/env` → `/env`, `/api/status/pipeline` → `/status/pipeline`.

3. **Bulk call-site rename** — ~40 `api("/api/…")` call sites across `app/`: strip `/api/` prefix. Also 3 hardcoded path constants in `app/(user)/portfolio-model/adoptionConstants.ts`.

4. **Direct-fetch verification** — check `useRealtimeSubscription.ts`, `useTopologyHandoffs.ts`, `AdoptionOverlay.tsx` for stale `/v1/api/` references. WebSocket `/ws` path is unchanged.

5. **OpenAPI spec** — `openapi.yaml`: server URLs → `http://localhost:5100/samantha/v1`; strip `/api/` from all ~106 path entries. Also copy to `api-reference/static/openapi.yaml`.

6. **Snapshot + smoke test** — after rename, run `npm run api:snap` (creates `api-snapshots/v1.yaml`), then smoke test: `GET /samantha/v1/auth/login` → 200; `GET /v1/api/work-items` → 404.

**Key grep to run before Task 3:**

```bash
grep -rn 'api("/api/' app/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v .next | wc -l
```

Expected: ~40 hits. After Task 3: 0 hits.

---

### Option B — PLA-0029 first

If the user wants the contract toolchain in place first (so it guards the rename), go here.

**Plan:** `docs/superpowers/plans/2026-05-08-api-contract-protection.md`

**9 tasks:** check_routes.sh → check_callers.py → snap_api.sh → pre-push hook → Next.js API route → DevApiChangelogPanel → GitHub Actions stub → docs/README → plan index registration.

**Before starting:** add PLA-0029 row to `docs/c_plan_index.md` and bump counter to `PLA-0029` (the plan JSON registration is Task 9 of the plan itself).

**Install oasdiff first:**

```bash
go install github.com/tufin/oasdiff@latest
oasdiff --version
```

---

## Remaining known issues (pre-existing, not touched this session)

| Issue | Notes |
| --- | --- |
| `workitemsv2` test suite | `sprint_id` → `timebox_sprint_id` still broken in test fixtures. User said "no" to fixing. Will fail `go test`. Fix when tests are next run. |
| `cross_db_canary_test.go` | `{"timebox_sprints", true}` is commented out. Uncomment once migration 025 canary is confirmed applied. |
| PLA-0026 deferred drops (00485–00489) | Gated on 7-day deployment soaks. Not yet actionable. |
| Roles rename migrations (131–135) | Migrations exist as untracked files (`db/schema/131–135_*.sql`). From `agent_renamer.md` — a prior agent produced these. Confirm status before touching. |
| Large set of uncommitted backend files | Many backend files modified across sessions. User should review `git status` and commit or stash before starting PLA-0028/0029. |

---

## Environment restart (if backend is dead)

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend"
BACKEND_ENV=dev go run ./cmd/server/.
# Watch for: "vector_artefacts pool connected"
curl http://localhost:5100/healthz
```

SSH tunnel must be active on `localhost:5435` for `vector_artefacts` queries to work.

---

## Key file locations

| What | Where |
| --- | --- |
| Go router (all routes) | `backend/cmd/server/main.go` |
| Auth cookie path | `backend/internal/auth/handler.go` — `setRefreshCookie` |
| Frontend API base URL | `app/lib/api.ts` — `API_BASE` |
| Frontend infra calls | `app/components/EnvBadge.tsx` |
| OpenAPI spec | `openapi.yaml` (root) + `api-reference/static/openapi.yaml` |
| PLA-0028 plan | `docs/superpowers/plans/2026-05-08-samantha-api-rename.md` |
| PLA-0029 plan | `docs/superpowers/plans/2026-05-08-api-contract-protection.md` |
| Dev panel page | `dev/pages/DevPage.tsx` |
| Plan index | `docs/c_plan_index.md` |
