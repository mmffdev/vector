# Handover 3 — Auth refresh-on-load + v2 work-items 500

**Date:** 2026-05-07
**From:** Opus 4.7 (1M ctx)
**Backend env:** `dev` (pinned — do not switch)

---

## TL;DR

1. **FIXED — refresh-on-load logout.** Cookie `Path` mismatch. `rt` cookie was set on `/api/auth` but the route is mounted at `/v1/api/auth/refresh`, so the browser refused to send it. Changed `setRefreshCookie` to `Path: "/v1/api/auth"` and `clearRefreshCookie` to evict at both old and new paths. Backend log now shows `POST /v1/api/auth/refresh - 200`.
2. **IN PROGRESS — v2 work-items returns 500.** `GET /v1/api/v2/work-items?limit=25&offset=0` returns 500 `{"error":"internal"}`. The handler was swallowing the underlying DB error. I added a `log.Printf("workitemsv2.List: subID=%s err=%v", ...)` line in the handler and rebuilt — **next reload will reveal the actual DB error in `/tmp/backend-dev.log`**. Pick up from there.

---

## What I changed

### 1. `backend/internal/auth/handler.go` — cookie Path fix

- `setRefreshCookie`: `Path: "/api/auth"` → `Path: "/v1/api/auth"` (matches actual mounted route).
- `clearRefreshCookie`: now emits TWO Set-Cookie headers — one for `/v1/api/auth` (current) and one for `/api/auth` (legacy) — so any stale rt cookies from older builds get evicted on logout/refresh-fail.

### 2. `backend/internal/workitemsv2/handler.go` — diagnostic logging

- Added `"log"` import.
- In `List` handler, before the silent 500 response, added:
  ```go
  log.Printf("workitemsv2.List: subID=%s err=%v", subID, err)
  ```
- The 500 response body itself is unchanged (still `{"error":"internal"}`) — only the server-side log is enhanced.
- **This is debug scaffolding.** Once the root cause is found and fixed, consider whether to keep the log line (probably yes — silent 500s are bad) or replace with a proper structured error response.

### 3. Backend rebuild + restart

Built fresh binary to `/tmp/vector-backend` and started it directly with:
```bash
BACKEND_ENV=dev \
VECTOR_ARTEFACTS_DB_URL="host=localhost port=5435 user=mmff_dev password=... dbname=vector_artefacts sslmode=disable" \
/tmp/vector-backend > /tmp/backend-dev.log 2>&1 &
```

(The launcher's previous `go run ./cmd/server/.` was killed — PID 77395/77400. Current backend PID was 82438 at handover time.)

---

## How to pick up the v2 500 investigation

### Step 1 — confirm backend is still up

```bash
lsof -ti:5100
tail -5 /tmp/backend-dev.log
```

If dead, restart with the command in section 3 above. If `/tmp/vector-backend` no longer exists, rebuild:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend"
go build -o /tmp/vector-backend ./cmd/server
```

### Step 2 — trigger the request

Have the user reload any page that calls `useWorkItemsWindow` (e.g. `/planning`, `/work-items`). Or hit it directly with a session cookie.

### Step 3 — read the actual error

```bash
grep "workitemsv2.List" /tmp/backend-dev.log | tail -5
```

The `err=...` portion will tell you exactly what's failing (likely a SQL column/relation mismatch between `vector_artefacts` schema and the query in `service.go` lines 126–200ish).

### Step 4 — fix the root cause

Common suspects:
- `vector_artefacts.artefacts` schema drift vs the query (check columns: `parent_artefact_id`, `flow_state_id`, `priority`, `sprint_id`, `owned_by_user_id`, `archived_at`, `subscription_id`, `number`, `title`, `description`).
- `flow_states` / `artefact_types` joins (the query joins `at` and `fs` tables).
- The `rollupCTE` referenced at line 144 of `service.go`.

The DB is reachable (the pool connected message shows up at startup). The 500 happens on `QueryRow` for the count query OR the data query.

---

## What was NOT touched

- Frontend code (`app/components/work-items-tree-config.tsx`, `WorkItemsTree.tsx`) — the bug is server-side.
- The launcher / `go run` wrapper — currently bypassed; backend is running directly from the rebuilt binary.
- The active backend env marker in `.claude/CLAUDE.md` — still `dev`.

---

## Earlier session work (already committed before this point)

- **Dev UI panel "API v2 Tests"** ([dev/pages/DevApiV2TestsPanel.tsx](dev/pages/DevApiV2TestsPanel.tsx)) — clickable tests that stream `go test` output via SSE. 35 tests across 9 groups. Uses hardcoded `panelName` per entry to satisfy NAME_RE.
- **Research paper R048** ([dev/research/R048.json](dev/research/R048.json)) — documents the v2 API test infrastructure.
- **CORS fix** — `backend/.env.dev` `FRONTEND_ORIGIN` is now comma-separated `http://localhost:3000,http://localhost:3001,http://localhost:5101`; `cmd/server/main.go` line ~427 now `strings.Split(...)` the env var.
- **AuthContext bootstrap dedup** — module-level `_bootstrapFlight` in [app/contexts/AuthContext.tsx](app/contexts/AuthContext.tsx) protects against StrictMode double-fire of `refresh()` consuming the one-time-use rt cookie twice.

---

## Hard-rule reminders for the next agent

- **Backend env stays `dev`.** Do not switch to staging/production. Do not even ask.
- **Human accounts are off limits.** Never modify gadmin/padmin/user@mmffdev.com credentials.
- **Dev UI primitives only on `/dev` pages** — `.dui-*` catalog, no inline `style={{}}`, no bespoke classes.
- **No destructive git commands without explicit confirmation.**
- **Tech-debt register is a standing rule** — every task identifies/measures/recommends.

---

## Open question for the user

Should `clearRefreshCookie` keep the legacy-path eviction long-term, or is one cleanup pass enough? Currently it always emits both — cheap but slightly noisy. Drop the legacy path in a week or two once we're confident no stale cookies survive.
