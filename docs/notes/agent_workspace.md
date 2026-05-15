# PLA-0043 Handover — Topology Scope Clamp on Artefact Reads

**Date:** 2026-05-12
**Branch:** `pla-0043-topology-scope-clamp` (pushed to origin, 4 commits ahead of `main`)
**Last commit:** `a07d3b5`
**Plan:** `dev/plans/PLA-0043.md`
**Predecessor (shipped):** PLA-0042 (chrome scope picker — `?scope=<id>` URL + ScopeContext + ScopePicker)
**PR draft URL (not opened yet):** https://github.com/mmffdev/vector/pull/new/pla-0043-topology-scope-clamp

---

## What PLA-0043 is for

PLA-0042 shipped the **chrome** scope picker: a topology-node UUID rides in `?scope=<id>` on the browser URL and a `ScopeContext` exposes it to React. But nothing on the backend yet clamps reads to that subtree — every artefact list still returns the full tenant.

PLA-0043 is the **clamp layer**:
- Each artefact carries an optional `topology_node_id` pointing at a node in `topology_nodes`.
- When a list read arrives with `?scope=<id>`, the API returns only artefacts whose `topology_node_id` is `<id>` OR a live descendant of it.
- `NULL topology_node_id` (un-assigned) shows in unscoped reads, is hidden in scoped reads.
- Grant model: **grant-inherits-down** — a grant on a parent reaches the parent + every descendant; a grant on a child never reaches the parent.
- `gadmin` bypasses scope checks entirely (platform support role).

---

## What is DONE on this branch (4 commits)

### `17e5960` — Migration 046

- [db/artefacts_schema/046_artefacts_topology_node_id.sql](db/artefacts_schema/046_artefacts_topology_node_id.sql)
- [db/artefacts_schema/down/046_artefacts_topology_node_id_DOWN.sql](db/artefacts_schema/down/046_artefacts_topology_node_id_DOWN.sql)
- Adds `artefacts.topology_node_id UUID NULL REFERENCES topology_nodes(id) ON DELETE SET NULL`.
- Partial index `artefacts_topology_node_id_live_idx` ON `(topology_node_id) WHERE topology_node_id IS NOT NULL AND archived_at IS NULL`.
- **Applied to dev DB via psql** on 2026-05-12 (the Go migrate runner had two unrelated pending migrations 035/036 ahead in queue — we side-stepped by applying directly and then backfilling `schema_migrations`). The `schema_migrations` row for `046_artefacts_topology_node_id.sql` IS present in dev.

### `06883fd` — orgdesign helpers

- [backend/internal/orgdesign/service.go](backend/internal/orgdesign/service.go) — added `DescendantNodeIDs(ctx, subID, rootNodeID) ([]uuid.UUID, error)` directly after `ArchivedDescendants` (around line 1024). Recursive CTE down `parent_id`, skips archived branches, uses the same `workspaceClause`/`workspaceClauseAt` helpers as `ArchivedDescendants`.
- [backend/internal/orgdesign/permissions.go](backend/internal/orgdesign/permissions.go) — new file. `CanReadScope(ctx, subID, userID, targetNodeID, actorRole) (bool, error)`. Gadmin bypass (still calls `loadNode` so a bogus node 404s for gadmin too). Otherwise walks UP via recursive CTE from target through ancestors and asks `EXISTS` against `topology_role_grants`.
- Both write through `s.vaPool` (vector_artefacts) using `pgx.TxOptions{AccessMode: pgx.ReadOnly}`.

### `78fd394` — artefactitemsv2 clamp

- [backend/internal/artefactitemsv2/types.go](backend/internal/artefactitemsv2/types.go) — added `ScopeNodeID`, `ActorUserID`, `ActorRole` fields to `Filters`; added sentinels `ErrScopeForbidden` (403) and `ErrScopeNodeNotFound` (404).
- [backend/internal/artefactitemsv2/service.go](backend/internal/artefactitemsv2/service.go):
  - Added `TopologyScopeResolver` interface (declared in the v2 package — avoids circular import into orgdesign).
  - Added `topology TopologyScopeResolver` field on `Service` + `WithTopologyResolver(t)` setter.
  - In `ListWorkItems`: when `filters.ScopeNodeID != nil`, calls `CanReadScope`, translates `orgdesign.ErrNodeNotFound` → `ErrScopeNodeNotFound` (via string-match on "node not found" because we deliberately don't import orgdesign), false → `ErrScopeForbidden`, true → calls `DescendantNodeIDs` and appends `a.topology_node_id = ANY($N::uuid[])` to the WHERE clause. NULL rows drop out automatically because `= ANY` excludes NULL.
- [backend/internal/artefactitemsv2/handler.go](backend/internal/artefactitemsv2/handler.go) — `List` parses `?scope=<uuid>` (400 on bad UUID), reads actor from `auth.UserFromCtx(r.Context())`, maps sentinels to 403/404/400.
- [backend/cmd/server/main.go](backend/cmd/server/main.go):
  - Declared `var v2ScopeAttach func(artefactitemsv2.TopologyScopeResolver)` before the vaPool branch.
  - Inside the vaPool branch (after `wiSvc`/`piSvc` are built), captured a closure that calls `WithTopologyResolver` on both.
  - After `orgDesignSvc = orgdesign.New(...)` lower down, calls `v2ScopeAttach(orgDesignSvc)`.
  - This shape was chosen because `orgDesignSvc` is built AFTER the v2 services in main.go and we didn't want to reorder.

### `a07d3b5` — Frontend + OpenAPI

- [app/lib/api.ts](app/lib/api.ts) — added `withForwardedScope(path, method)`. For `GET` requests targeting paths matching `/(^|\/)(work-items|portfolio-items)(\?|\/|$)/`, reads `?scope=` from `window.location.search` (SSR-safe) and appends it to the API path unless already present. Wired into `_fetch` at the call site before `fetch(base + finalPath, ...)`. Retry path passes the original `path` (the helper re-derives `finalPath` on retry).
- [openapi-v2.yaml](openapi-v2.yaml) — documented `scope` query param on `GET /work-items` including the 400/403/404 contract.

---

## What is NOT done — pick up here on the new machine

Pending in priority order:

### P1 — must do before merging

1. **Per-item endpoints are still ungated.** Only `List` is clamped. `Get`, `Patch`, `Delete`, `/children`, `/field-values`, etc. on the v2 work-items + portfolio-items routes do NOT check scope. The simplest path:
   - In `GetWorkItem`, accept an optional `scopeNodeID *uuid.UUID` (or read `?scope=` in handler), and if set, after the row scan, verify the loaded artefact's `topology_node_id` is in `DescendantNodeIDs(scopeNodeID)`. Same for child/patch routes.
   - Alternative: add a single `MustReadInScope(svc, ctx, subID, artefactID, scopeID)` helper that does a one-shot SQL existence check.
   - Decision needed from user: do we 404 or 403 when the artefact exists but is outside the user's selected scope? Default suggestion: **404** (mirror "row not in your filter" — don't leak existence across scopes).

2. **Audit emission for `scope_read_denied`.** The sentinel `ErrScopeForbidden` is returned by the service and mapped to 403 in the handler. There is no audit log write yet. Look at `auditLog` use elsewhere in the handler (search `auditLog`) and wire an event with code `scope_read_denied`, `subject_id=user.ID`, `target_id=scopeNodeID`.

3. **Unit tests for the new helpers.** None exist yet on this branch.
   - `orgdesign.DescendantNodeIDs` — fixture: A → B, A → C, B → B1 (archived), B → B2 (live). `DescendantNodeIDs(A)` returns {A, B, C, B2}, NOT B1 or its children.
   - `orgdesign.CanReadScope` — fixtures: grant on A → can read A, B, C, B2; grant on B → can read B, B2 ONLY (NOT A or C); no grant → false; gadmin → true everywhere; bogus node → `ErrNodeNotFound`.

4. **Integration test for the handler scope matrix.** Touch `backend/internal/artefactitemsv2/handler_test.go`:
   - 200 happy path: grant on A, `?scope=A`, returns artefacts owned by A or any descendant.
   - 200 narrower scope: grant on A, `?scope=B`, returns only A's children under B.
   - 403: grant on B, `?scope=A` (parent — grants don't inherit up).
   - 404: `?scope=<random-uuid>` not in tenant.
   - 400: `?scope=not-a-uuid`.
   - 200 gadmin bypass: gadmin role, `?scope=` anywhere, returns subtree.
   - 200 unscoped includes NULL: no `?scope=`, NULL `topology_node_id` rows appear.
   - 200 scoped excludes NULL: `?scope=A`, NULL rows DO NOT appear.

### P2 — should do, can defer

5. **Manual smoke test in the browser.** Needs the dev launcher up (`<launcher>` skill), a fixture A/B/C tree with grants, and a few artefacts assigned to each node. Confirm the picker filters work-items as expected.
6. **Document the cross-cutting clamp pattern** in `docs/c_c_topology.md` (or a new `c_c_scope_clamp.md`) — at minimum the rule "grant-inherits-down; un-assigned visible only in unscoped reads."
7. **Capture as tech-debt** (S2): the cross-package wiring in `main.go` uses a captured closure (`v2ScopeAttach`). This works but is fragile — if the construction order ever flips, the closure stays nil. Cleaner long-term: a small `wiring.go` in `cmd/server` that explicitly orders dependencies.

### P3 — nice to have

8. **Re-flow the v2 list route to also forward scope through any 5xx path** so the partial / total counts in the response payload reflect scope. (Currently if the service hits an unrelated 500, scope info is lost — minor.)
9. **Extend the lint rule `lint:writer-boundary`** to catch new direct topology writes. Pre-existing boundary violation in `backend/internal/portfoliomodels/dev_reset.go` (writes `topology_nodes` / `topology_role_grants` / `topology_view_state` directly) — known, not introduced by this work but should be cleaned up.

---

## How to pick up on the new machine

```bash
# Make sure you're on the right branch
cd "<repo root>"
git fetch origin
git checkout pla-0043-topology-scope-clamp
git pull --ff-only

# Confirm the four PLA-0043 commits are present
git log --format="%h %s" main..HEAD
# Expect (top → bottom):
#   a07d3b5 feat(PLA-0043): frontend auto-forwards ?scope= …
#   78fd394 feat(PLA-0043): artefactitemsv2 ?scope= clamp …
#   06883fd feat(PLA-0043): orgdesign DescendantNodeIDs + CanReadScope helpers …
#   17e5960 feat(PLA-0043): migration 046 — artefacts.topology_node_id …
```

If you're on a fresh dev DB:
```bash
# Backend env is pinned to dev (HARD RULE — see CLAUDE.md). Tunnel :5435.
# Confirm 046 is applied:
PGPASSWORD='<see backend/.env.dev VA_DB_PASSWORD>' /opt/homebrew/opt/libpq/bin/psql \
  -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
  -c "SELECT filename FROM schema_migrations WHERE filename = '046_artefacts_topology_node_id.sql';"
# If empty: apply via `cd backend && go run ./cmd/migrate -dir "<repo>/db/artefacts_schema"`
#   — but BEWARE: migrations 035/036 may be pending ahead of 046; review queue first.
```

Build sanity:
```bash
cd backend && go build ./... && go vet ./internal/orgdesign/... ./internal/artefactitemsv2/... ./cmd/server/...
cd .. && npx tsc --noEmit  # ignore pre-existing TS errors unrelated to this work
```

---

## Key files to know

| Path | Purpose |
|---|---|
| `db/artefacts_schema/046_artefacts_topology_node_id.sql` | The schema change |
| `backend/internal/orgdesign/service.go` (`DescendantNodeIDs` ~ line 1024) | "this node + live subtree" set |
| `backend/internal/orgdesign/permissions.go` | `CanReadScope` — the gate |
| `backend/internal/artefactitemsv2/types.go` | `Filters.ScopeNodeID/ActorUserID/ActorRole`; sentinels `ErrScopeForbidden`, `ErrScopeNodeNotFound` |
| `backend/internal/artefactitemsv2/service.go` | `TopologyScopeResolver` interface; clamp wiring inside `ListWorkItems` |
| `backend/internal/artefactitemsv2/handler.go` | `?scope=` parse + 400/403/404 mapping in `List` |
| `backend/cmd/server/main.go` (~line 286 + ~line 350) | `v2ScopeAttach` closure pattern |
| `app/lib/api.ts` (`withForwardedScope`) | Browser-URL → API auto-forward |
| `openapi-v2.yaml` (`/work-items` GET) | Spec doc for `?scope=` |

---

## Sentinels & error mapping

| Sentinel | HTTP | Meaning |
|---|---|---|
| `artefactitemsv2.ErrScopeForbidden` | 403 | Node exists, user has no covering grant |
| `artefactitemsv2.ErrScopeNodeNotFound` | 404 | Node missing or in another tenant |
| `artefactitemsv2.ErrInvalidInput` | 400 | Bad UUID, missing actor, resolver not wired |
| `orgdesign.ErrNodeNotFound` | (translated to 404 above by string-match) | Used inside orgdesign |

**Important wiring note:** the v2 service detects orgdesign's `ErrNodeNotFound` via `strings.Contains(err.Error(), "node not found")` to avoid importing orgdesign (cycle risk if orgdesign ever reads artefacts). If you refactor, consider exporting a dedicated comparable sentinel or sharing the type via a third package.

---

## User constraints / preferences active here

- **HARD RULE — backend env pinned to dev.** `BACKEND_ENV=dev`, tunnel `:5435`, `backend/.env.dev`. Never switch.
- **HARD RULE — human accounts off limits.** `gadmin@`, `padmin@`, `user@mmffdev.com` — never modify. Create `claude-*` accounts if you need test logins.
- **Never wipe uncommitted work.** Always check `git status` before any destructive op.
- **Push commits often, don't stack.** This branch is pushed.
- **Work-item lifecycle.** Every task moves through `todo` → `doing` → `completed` on its `work_item_backlog` entry in the plan JSON. Story IDs for this PLA: see `dev/plans/PLA-0043.md`.
- **Bracket-tag commits with scope ref.** All four commits on this branch use `[FE-POR-API-0002]` or `[FE-POR-0003.1]` — keep this going.

---

## Open questions for the user

1. Per-item endpoint behaviour: 404 vs 403 when an artefact exists but is outside the user's selected scope? (Recommend 404 — don't leak existence.)
2. Are we storifying the remaining work (P1 items 1–4 above) as separate cards under PLA-0043, or rolling them into the same PR before merge?
3. PR or keep branch open while finishing the per-item clamp + tests?

---

_End of handover. Next-machine Claude: read this file in full, then `git log --format="%h %s" main..HEAD` to confirm you're on the same commit (`a07d3b5`)._
