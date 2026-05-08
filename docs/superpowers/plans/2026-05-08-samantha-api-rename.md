# Samantha API Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every API route from `/v1/api/*` to `/samantha/v1/*`, drop the redundant `/api/` segment, and promote the internal v2 sub-routes to a proper `/samantha/v2/*` block.

**Architecture:** Pure string rename across three surfaces — Go router (`backend/cmd/server/main.go`), frontend helpers (`app/lib/api.ts`, call sites, direct-fetch files), and the OpenAPI spec (`openapi.yaml`). No middleware, auth, DTOs, or handler logic changes. The v2 sub-routes currently nested inside the v1 block (`/api/v2/work-items`, `/api/v2/timeboxes/sprints`) are pulled out into their own `/samantha/v2` mount.

**Tech Stack:** Go + chi router, Next.js (TypeScript), OpenAPI 3.1

**Plan ID:** PLA-0028
**Spec:** `docs/superpowers/specs/2026-05-08-samantha-api-rename-design.md`

---

## File Map

| File | Change |
| --- | --- |
| `backend/cmd/server/main.go` | `/v1` → `/samantha/v1`; all `/api/xxx` sub-routes → `/xxx`; v2 sub-routes extracted to `/samantha/v2` block; infra routes `/api/env`, `/api/status/pipeline`, `/api/env/switch` → `/env`, `/status/pipeline`, `/env/switch` |
| `app/lib/api.ts` | `API_BASE`: `+ "/v1"` → `+ "/samantha/v1"`; comments updated |
| `app/components/EnvBadge.tsx` | `"/api/status/pipeline"` → `"/status/pipeline"`; `"/api/env/switch"` → `"/env/switch"` |
| `app/(user)/portfolio-model/adoptionConstants.ts` | `"/api/portfolio-models"` → `"/portfolio-models"` (all 3 path constants) |
| All other `app/` call sites (30 files) | Drop `/api/` prefix from every `api("…")` call |
| `openapi.yaml` | Server URLs; all path entries drop `/api/` |

---

## Task 1: Rename the Go router mount and infra routes

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Rename the `/v1` mount point**

Find line ~574:
```go
r.Route("/v1", func(r chi.Router) {
```
Change to:
```go
r.Route("/samantha/v1", func(r chi.Router) {
```

- [ ] **Step 2: Rename unversioned infra routes (drop `/api/`)**

Find lines ~459–513 (before the `/samantha/v1` block):
```go
r.Get("/api/status/pipeline", func(w http.ResponseWriter, r *http.Request) {
```
→
```go
r.Get("/status/pipeline", func(w http.ResponseWriter, r *http.Request) {
```

```go
r.Get("/api/env", func(w http.ResponseWriter, r *http.Request) {
```
→
```go
r.Get("/env", func(w http.ResponseWriter, r *http.Request) {
```

```go
r.Post("/api/env/switch", func(w http.ResponseWriter, r *http.Request) {
```
→
```go
r.Post("/env/switch", func(w http.ResponseWriter, r *http.Request) {
```

- [ ] **Step 3: Rename all `/api/xxx` sub-routes inside the `/samantha/v1` block**

Every `r.Route("/api/xxx", ...)` and standalone `r.Get/Post/Put/Delete/Patch("/api/xxx", ...)` inside the `/samantha/v1` block drops the `/api/` prefix. Full list:

```go
// Before → After
r.Route("/api/auth", ...)           → r.Route("/auth", ...)
r.Route("/api/me", ...)             → r.Route("/me", ...)
r.Route("/api/nav", ...)            → r.Route("/nav", ...)
r.Route("/api/user/tab-order", ...) → r.Route("/user/tab-order", ...)
r.Route("/api/custom-pages", ...)   → r.Route("/custom-pages", ...)
r.Post("/api/addressables/build-reconcile", ...) → r.Post("/addressables/build-reconcile", ...)
r.Post("/api/addressables/register", ...)        → r.Post("/addressables/register", ...)
r.Get("/api/addressables/snapshot", ...)         → r.Get("/addressables/snapshot", ...)
r.Get("/api/page-help/{addressable_id}", ...)    → r.Get("/page-help/{addressable_id}", ...)
r.Route("/api/page-help/admin", ...)             → r.Route("/page-help/admin", ...)
r.Route("/api/addressables/admin", ...)          → r.Route("/addressables/admin", ...)
r.Route("/api/portfolio-models", ...)            → r.Route("/portfolio-models", ...)
r.Route("/api/portfolio", ...)                   → r.Route("/portfolio", ...)
r.Route("/api/workspace/{id}/portfolio", ...)    → r.Route("/workspace/{id}/portfolio", ...)
r.Route("/api/library/releases", ...)            → r.Route("/library/releases", ...)
r.Route("/api/subscription", ...)               → r.Route("/subscription", ...)
r.Route("/api/errors", ...)                     → r.Route("/errors", ...)
r.Route("/api/user-stories", ...)               → r.Route("/user-stories", ...)
r.Route("/api/defects", ...)                    → r.Route("/defects", ...)
r.Route("/api/rank", ...)                       → r.Route("/rank", ...)
r.Route("/api/work-items", ...)                 → r.Route("/work-items", ...)
r.Route("/api/sprints", ...)                    → r.Route("/sprints", ...)
r.Route("/api/custom-field-library", ...)       → r.Route("/custom-field-library", ...)
r.Route("/api/work-item-templates", ...)        → r.Route("/work-item-templates", ...)
r.Route("/api/flows", ...)                      → r.Route("/flows", ...)
r.Route("/api/topology", ...)                   → r.Route("/topology", ...)
r.Route("/api/workspaces", ...)                 → r.Route("/workspaces", ...)
r.Route("/api/workspace/{id}/fields", ...)      → r.Route("/workspace/{id}/fields", ...)
r.Route("/api/tenant-settings", ...)            → r.Route("/tenant-settings", ...)
r.Route("/api/portfolio-items", ...)            → r.Route("/portfolio-items", ...)
r.Route("/api/admin", ...)                      → r.Route("/admin", ...)
r.Route("/api/roles", ...)                      → r.Route("/roles", ...)
```

- [ ] **Step 4: Extract v2 sub-routes from the v1 block into a `/samantha/v2` block**

The current v2 sub-routes are nested inside `/samantha/v1` as `/api/v2/work-items` and `/api/v2/timeboxes/sprints`. Move them out of the v1 closure entirely and register them directly on `r` as a new `/samantha/v2` block.

Find the `if os.Getenv("WORK_ITEMS_V2") == "true"` block (lines ~900–950) and the sprint handler block. Cut them out of the v1 closure. After the `}) // end /samantha/v1` line, add:

```go
// ---- /samantha/v2 — feature-gated v2 routes ----
r.Route("/samantha/v2", func(r chi.Router) {
    r.Use(apikeys.Middleware(apiKeysSvc))

    // work-items v2 (PLA-0023 / 00469)
    if os.Getenv("WORK_ITEMS_V2") == "true" {
        r.Route("/work-items", func(r chi.Router) {
            r.Use(authSvc.RequireAuth)
            r.Use(authSvc.RequireFreshPassword)
            r.Use(httprate.LimitByIP(120, time.Minute))
            r.Get("/", workItemsV2H.List)
            r.Post("/", workItemsV2H.Create)
            r.Post("/bulk", workItemsV2H.Bulk)
            r.Get("/summary", workItemsV2H.Summary)
            r.Get("/flow-states", workItemsV2H.ListFlowStates)
            r.Get("/{id}", workItemsV2H.Get)
            r.Patch("/{id}", workItemsV2H.Patch)
            r.Delete("/{id}", workItemsV2H.Archive)
            r.Get("/{id}/children", workItemsV2H.ListChildren)
            r.Get("/{id}/field-values", workItemsV2H.ListFieldValues)
            r.Put("/{id}/field-values", workItemsV2H.UpsertFieldValues)
            r.Delete("/{id}/field-values/{field_library_id}", workItemsV2H.DeleteFieldValue)
        })
    } else {
        r.Get("/work-items", func(w http.ResponseWriter, r *http.Request) {
            http.Error(w, "v2 work-items not enabled", http.StatusServiceUnavailable)
        })
    }

    // timeboxes/sprints v2 (PLA-0027 / 00514)
    if sprintH != nil {
        r.Route("/timeboxes/sprints", func(r chi.Router) {
            r.Use(authSvc.RequireAuth)
            r.Use(authSvc.RequireFreshPassword)
            r.Use(httprate.LimitByIP(120, time.Minute))
            r.Get("/", sprintH.List)
            r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
                Post("/", sprintH.Create)
            r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
                Post("/bulk-create", sprintH.BulkCreate)
            r.Get("/{id}", sprintH.Get)
        })
    } else {
        r.Get("/timeboxes/sprints", func(w http.ResponseWriter, r *http.Request) {
            http.Error(w, "timebox sprints not enabled", http.StatusServiceUnavailable)
        })
    }
})
```

- [ ] **Step 5: Build the backend and confirm it compiles**

```bash
cd backend
go build ./cmd/server/...
```

Expected: no output (clean build).

- [ ] **Step 6: Restart and smoke-test the renamed routes**

```bash
pkill -f "go run ./cmd/server" 2>/dev/null; lsof -ti:5100 | xargs kill -9 2>/dev/null
BACKEND_ENV=dev go run ./cmd/server/. &
sleep 6
curl -s http://localhost:5100/healthz
curl -s http://localhost:5100/status/pipeline
curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/samantha/v1/auth/login  # expect 405 (GET not allowed) not 404
```

Expected:
- `/healthz` → `{"status":"ok",...}`
- `/status/pipeline` → JSON (not 404)
- `/samantha/v1/auth/login` → `405` (route exists, GET not allowed on a POST endpoint)

- [ ] **Step 7: Confirm old paths now 404**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/v1/api/auth/login
curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/api/status/pipeline
```

Expected: both `404`.

- [ ] **Step 8: Commit**

```bash
cd ..
git add backend/cmd/server/main.go
git commit -m "feat(PLA-0028): rename Go router /v1/api/* → /samantha/v1/* and extract /samantha/v2 block"
```

---

## Task 2: Update the frontend `api()` base URL and infra call sites

**Files:**
- Modify: `app/lib/api.ts`
- Modify: `app/components/EnvBadge.tsx`

- [ ] **Step 1: Update `API_BASE` in `app/lib/api.ts`**

Find line ~5:
```ts
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100") + "/v1";
```
Change to:
```ts
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100") + "/samantha/v1";
```

Update the comment at the top of the file (line ~2) that documents infra routes:
```ts
// For unversioned infra routes: /healthz, /api/env, /api/status/pipeline, /api/env/switch
```
→
```ts
// For unversioned infra routes: /healthz, /env, /status/pipeline, /env/switch
```

- [ ] **Step 2: Update `apiInfra` call sites in `app/components/EnvBadge.tsx`**

Line ~56:
```ts
const data = await apiInfra<PipelineStatus>("/api/status/pipeline", { skipAuth: true });
```
→
```ts
const data = await apiInfra<PipelineStatus>("/status/pipeline", { skipAuth: true });
```

Line ~116:
```ts
await apiInfra("/api/env/switch", {
```
→
```ts
await apiInfra("/env/switch", {
```

- [ ] **Step 3: Commit**

```bash
git add app/lib/api.ts app/components/EnvBadge.tsx
git commit -m "feat(PLA-0028): update frontend API_BASE to /samantha/v1 and infra paths"
```

---

## Task 3: Update all `api("/api/…")` call sites in `app/`

**Files:**
- Modify: 30 files across `app/` that call `api("/api/…")`

- [ ] **Step 1: Bulk-rename `/api/` prefix in all `api()` call strings**

Run from the repo root:

```bash
# Dry-run first — verify matches
grep -rn '"/api/' app/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|\.next"
```

Then apply:

```bash
# Replace "/api/ with "/ in api() call strings across app/
# This is safe because the pattern only appears inside api("…") template literals
find app -name "*.ts" -o -name "*.tsx" | xargs grep -l '"/api/\|`/api/' | grep -v "node_modules\|\.next" | while read f; do
  sed -i '' 's|"/api/|"/|g; s|`/api/|`/|g' "$f"
done
```

- [ ] **Step 2: Update `adoptionConstants.ts` — all three path constants**

`app/(user)/portfolio-model/adoptionConstants.ts`:

```ts
// Before
export const PORTFOLIO_MODELS_LIST_PATH = "/api/portfolio-models";
// …
return `/api/portfolio-models/${modelId}/adopt`;
// …
return `/api/portfolio-models/${modelId}/adopt/stream`;
```
→
```ts
export const PORTFOLIO_MODELS_LIST_PATH = "/portfolio-models";
// …
return `/portfolio-models/${modelId}/adopt`;
// …
return `/portfolio-models/${modelId}/adopt/stream`;
```

Also update the comment on line ~5 if it references the old path.

- [ ] **Step 3: Verify no `/api/` strings remain in app/ call sites**

```bash
grep -rn '"/api/\|`/api/' app/ --include="*.ts" --include="*.tsx" | grep -v "node_modules\|\.next\|// " | grep -v "app/api/"
```

Expected: zero results (the `app/api/` Next.js PoC handlers are excluded — they stay untouched).

- [ ] **Step 4: Commit**

```bash
git add app/
git commit -m "feat(PLA-0028): drop /api/ prefix from all frontend api() call sites"
```

---

## Task 4: Update NEXT_PUBLIC_API_BASE direct-fetch files

These three files bypass `api()` and build URLs manually from `NEXT_PUBLIC_API_BASE`. They don't need `samantha/v1` added (they construct their own full paths) but they reference `/api/` paths that need stripping.

**Files:**
- Modify: `app/hooks/useRealtimeSubscription.ts`
- Modify: `app/hooks/useTopologyHandoffs.ts`
- Modify: `app/(user)/portfolio-model/AdoptionOverlay.tsx`

- [ ] **Step 1: Check what paths these files construct**

```bash
grep -n "API_BASE\|/api/\|/v1\|/ws" app/hooks/useRealtimeSubscription.ts
grep -n "API_BASE\|/api/\|/v1\|/ws" app/hooks/useTopologyHandoffs.ts
grep -n "API_BASE\|/api/\|/v1\|adoptStreamPath" "app/(user)/portfolio-model/AdoptionOverlay.tsx"
```

`useRealtimeSubscription` and `useTopologyHandoffs` both append `/ws` to `API_BASE` (not `/api/`) — WebSocket endpoint is unversioned and unchanged. No edits needed in these two files.

`AdoptionOverlay.tsx` uses `API_BASE + adoptStreamPath(modelId)` — `adoptStreamPath` was already fixed in Task 3 (via `adoptionConstants.ts`). No further edits needed here.

- [ ] **Step 2: Verify no stale paths remain**

```bash
grep -rn '"/api/\|`/api/\|+ "/v1\|+ `/v1' \
  app/hooks/useRealtimeSubscription.ts \
  app/hooks/useTopologyHandoffs.ts \
  "app/(user)/portfolio-model/AdoptionOverlay.tsx"
```

Expected: zero results.

- [ ] **Step 3: Commit if any changes were made**

```bash
git add app/hooks/useRealtimeSubscription.ts app/hooks/useTopologyHandoffs.ts "app/(user)/portfolio-model/AdoptionOverlay.tsx"
git commit -m "feat(PLA-0028): update direct-fetch files for samantha path rename" 2>/dev/null || echo "nothing to commit"
```

---

## Task 5: Update OpenAPI spec

**Files:**
- Modify: `openapi.yaml`

- [ ] **Step 1: Update server URLs**

Find lines ~15–18:
```yaml
servers:
  - url: http://localhost:5100/v1
    description: Local development
  - url: https://api.example.com/v1
    description: Production
```
→
```yaml
servers:
  - url: http://localhost:5100/samantha/v1
    description: Local development
  - url: https://api.example.com/samantha/v1
    description: Production
```

- [ ] **Step 2: Strip `/api/` from all path entries**

The spec has ~106 path entries all starting with `/api/`. Run:

```bash
# Dry-run: count affected lines
grep -c "^  /api/" openapi.yaml
```

Expected: ~106 matches.

```bash
sed -i '' 's|^  /api/|  /|g' openapi.yaml
```

- [ ] **Step 3: Verify**

```bash
grep "^  /api/" openapi.yaml | wc -l
grep "^  /" openapi.yaml | head -10
```

Expected: 0 `/api/` prefixed paths remaining. First few paths should look like `/auth`, `/me`, `/nav`, etc.

- [ ] **Step 4: Commit**

```bash
git add openapi.yaml
git commit -m "feat(PLA-0028): update OpenAPI spec server URLs and paths for samantha rename"
```

---

## Task 6: End-to-end smoke test

- [ ] **Step 1: Ensure backend is running with latest source**

```bash
lsof -ti:5100 | xargs kill -9 2>/dev/null
cd backend
BACKEND_ENV=dev go run ./cmd/server/. > /tmp/backend-dev.log 2>&1 &
cd ..
sleep 8
curl -s http://localhost:5100/healthz | python3 -m json.tool
```

Expected: `{"status":"ok","env":"dev",...}`

- [ ] **Step 2: Get a JWT**

```bash
TOKEN=$(curl -s -X POST http://localhost:5100/samantha/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@mmffdev.com","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "token: ${TOKEN:0:20}…"
```

Expected: token printed (not empty, not an error).

- [ ] **Step 3: Test a v1 route**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5100/samantha/v1/work-items?limit=5" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'items={len(d[\"items\"])}, total={d[\"total\"]}')"
```

Expected: `items=3, total=3` (3 root epics).

- [ ] **Step 4: Test a v2 route**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5100/samantha/v2/work-items?limit=5" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'items={len(d[\"items\"])}, total={d[\"total\"]}')"
```

Expected: `items=3, total=3`.

- [ ] **Step 5: Confirm old paths 404**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/v1/api/work-items
curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/api/status/pipeline
```

Expected: both `404`.

- [ ] **Step 6: Load the frontend and verify no console errors**

Start the Next.js dev server if not running:
```bash
npm run dev
```

Open `http://localhost:3000` in a browser. Log in as `user@mmffdev.com` / `password`. Navigate to Work Items. Check browser devtools Network tab — all XHR requests should show `samantha/v1/` in their URLs, none should show `v1/api/` or return 404.

- [ ] **Step 7: Final commit — update plan index**

Update `docs/c_plan_index.md`: change `PLA-0027` last-issued to `PLA-0028` and add a row for PLA-0028.

```bash
git add docs/c_plan_index.md
git commit -m "docs(PLA-0028): register plan in index"
```

---

## Self-review

**Spec coverage:**
- ✅ Go router mount renamed `/v1` → `/samantha/v1` (Task 1, Step 1)
- ✅ All `/api/xxx` sub-routes drop `/api/` (Task 1, Step 3)
- ✅ v2 sub-routes extracted to `/samantha/v2` block (Task 1, Step 4)
- ✅ Infra routes drop `/api/` (Task 1, Step 2)
- ✅ `API_BASE` updated in `api.ts` (Task 2, Step 1)
- ✅ `apiInfra` call sites updated (Task 2, Step 2)
- ✅ All 30 `api("/api/…")` call sites updated (Task 3)
- ✅ `adoptionConstants.ts` updated (Task 3, Step 2)
- ✅ Direct-fetch files checked (Task 4)
- ✅ OpenAPI spec server URLs and paths updated (Task 5)
- ✅ End-to-end smoke test (Task 6)

**Placeholder scan:** None found.

**Type consistency:** No new types introduced — pure string rename throughout.
