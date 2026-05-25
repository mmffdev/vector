# JWT `workspace_id` claim survives refresh — design

> Date: 2026-05-25
> Sources: handoff `/var/folders/.../handoff-XXXXXX.md.96Oh0viYzQ` + live code verification at commit `f0091092`.

## Problem (one paragraph)

`auth.Login` resolves the user's default workspace via `resolveDefaultWorkspace` and stamps `u.WorkspaceID` before `SignAccessToken` — so the first JWT carries `workspace_id` correctly. `auth.Refresh` (and the grace-window `refreshFromSuccessor`) call `FindUserByID` to rehydrate the user, then `SignAccessToken(u, ...)` — but `FindUserByID` does NOT scan a `WorkspaceID` (no DB column; `WorkspaceID` is a per-session selection that lives transiently on `roletypes.User`). So `u.WorkspaceID == uuid.Nil` on every refresh, `SignAccessToken` omits the claim per the `omitempty` contract, and the request lands at `sentinel.Middleware` which falls back to `resolver.FirstLiveWorkspace` — returning whichever workspace was created first in the tenant, not the workspace the user had picked.

The 2026-05-25 sentinel SQL fix (renamed `FROM workspace` → `FROM master_record_workspaces` in `sentinel/sql.go:89`) keeps the fallback path **functional**, so today the system works for users with exactly one workspace grant (padmin's case). The bug bites users with **more than one** workspace grant who pick a non-default — they silently revert to the earliest-created workspace on every refresh.

## Why this framing (not "persist `WorkspaceID` on users")

The user clarified during the prior session: **workspaces are closed data containers; nothing escapes between them; a user can have many workspaces**. So:

- `WorkspaceID` is NOT a property of the user — it is a per-session active selection.
- The user's available workspaces live in `mmff_vector.users_roles_workspaces` (one row per `(user, workspace, role)`, active when `users_roles_workspaces_revoked_at IS NULL`).
- The user's last working location is already persisted in `users.default_focus_node_id`.
- `topology_nodes.workspace_id` is `NOT NULL` (vector_artefacts), so **the default focus node uniquely determines its workspace**. No new column needed.

The user explicitly ruled out "add `users.workspace_id`" / "add `users_sessions.active_workspace_id`" framings.

## Architecture

Two surgical changes, no schema migration:

### 1. Re-derive `WorkspaceID` on refresh (auth side)

In `auth.Refresh` (`backend/internal/auth/service.go:491`) and `auth.refreshFromSuccessor` (`backend/internal/auth/service.go:650`), insert between the `FindUserByID` call and the `SignAccessToken` call a derivation block:

```
if u.DefaultFocusNodeID != nil:
    workspaceID = WorkspaceResolver.WorkspaceForFocusNode(*u.DefaultFocusNodeID, u.SubscriptionID)
    if workspaceID != nil AND user has active grant on workspaceID:
        u.WorkspaceID = workspaceID
if u.WorkspaceID == uuid.Nil:
    workspaceID = WorkspaceResolver.FirstGrantedWorkspace(u.ID, u.SubscriptionID)
    if workspaceID != nil:
        u.WorkspaceID = workspaceID
// If still nil → JWT signs without claim → sentinel fallback applies (defence-in-depth).
```

### 2. Tighten `sentinel.FirstLiveWorkspace` to user grants

The fallback today returns ANY first workspace in the tenant — even one the actor has no grant on, which then 403s at Step 3 (`HasActiveRole`). Tighten the SQL to JOIN `users_roles_workspaces` so only granted workspaces are returned. Resolver signature gains a `userID` parameter.

### Cross-pool dependency: `WorkspaceResolver` interface in `auth`

`auth.Service` holds `pool` (mmff_vector) only. The derivation needs `vaPool` (vector_artefacts) to read `topology_nodes.workspace_id`. Mirror the existing `PermissionResolver` pattern at `auth/service.go:53`:

```go
type WorkspaceResolver interface {
    WorkspaceForFocusNode(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error)
    FirstGrantedWorkspace(ctx context.Context, userID, tenantID uuid.UUID) (uuid.UUID, error)
    UserHasActiveGrantOnWorkspace(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error)
}
```

Concrete impl lives outside `auth` (in `backend/internal/workspaceresolver/`, a new package) and is wired in `main.go`. This:

- keeps `auth.Service` free of a `vaPool` field,
- mirrors `PermissionResolver` precisely (auth doesn't grow new dependency edges; it grows one new interface field that is dependency-injected at boot),
- avoids the ruled-out `auth → sentinel` cycle.

## File map

**Modify:**
- `backend/internal/auth/service.go` — define `WorkspaceResolver` interface (next to `PermissionResolver`); add `WorkspaceResolver` field on `Service`; insert derivation blocks in `Refresh` and `refreshFromSuccessor`
- `backend/internal/sentinel/sql.go` — tighten `sqlFirstLiveWorkspace` to JOIN `users_roles_workspaces`
- `backend/internal/sentinel/types.go` — `Resolver.FirstLiveWorkspace` gains `userID` param
- `backend/internal/sentinel/resolver.go` — update `PoolResolver.FirstLiveWorkspace` to take + pass `userID`
- `backend/internal/sentinel/middleware.go` — pass `u.ID` into the `FirstLiveWorkspace` call site (line 143)
- `backend/internal/sentinel/middleware_test.go` — update `stubResolver.FirstLiveWorkspace` signature + 3 callsites that pass it explicitly
- `backend/cmd/server/main.go:175` — construct the new `workspaceresolver` and wire onto `authSvc.WorkspaceResolver = ...`

**Create:**
- `backend/internal/workspaceresolver/resolver.go` — `PoolResolver` struct holding `vaPool + mvPool`, implementing the three `WorkspaceResolver` methods
- `backend/internal/workspaceresolver/sql.go` — the three SQL constants
- `backend/internal/workspaceresolver/resolver_test.go` — unit tests against a stubbed pool OR integration tests against the dev DB (decide at task time; preference: integration with the live padmin row, since the bug is fundamentally cross-pool)

**Not touched:**
- `.claude/CLAUDE.md`, `context/MEMORY.md` (HARD RULES already landed)
- `app/sentinel/` and the rest of the frontend — backend-only fix; the frontend reads the correct JWT once minted correctly
- SY003 — regenerate AFTER the fix lands per the new HARD RULE, not before
- No schema migration

## Wire contract changes

**`Resolver.FirstLiveWorkspace`:**

```go
// Before
FirstLiveWorkspace(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error)

// After
FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error)
```

Returns `ErrNoWorkspace` when the user has zero active workspace grants in the tenant. Same wire shape as before, narrower predicate.

**`sqlFirstLiveWorkspace` (sentinel/sql.go):**

```sql
SELECT mw.id
  FROM master_record_workspaces mw
  JOIN users_roles_workspaces urw
    ON urw.users_roles_workspaces_id_workspace = mw.id
   AND urw.users_roles_workspaces_id_user = $2
   AND urw.users_roles_workspaces_revoked_at IS NULL
 WHERE mw.subscription_id = $1
   AND mw.archived_at IS NULL
 ORDER BY mw.created_at ASC
 LIMIT 1
```

`$1 = subscriptionID`, `$2 = userID` (matches the existing `sqlExistsActiveWorkspaceRole` parameter order — `workspaceID, userID` — so `userID` stays the last param across the file's predicates).

**`auth.Service`:**

```go
type Service struct {
    // ... existing fields ...
    WorkspaceResolver WorkspaceResolver  // NEW — wired in main.go
}
```

Nil-safe: when `WorkspaceResolver == nil`, the derivation block is skipped and `SignAccessToken` signs without `workspace_id` (same behaviour as today). Tests that construct `auth.NewService` without wiring the resolver continue to pass; only the new derivation-specific tests assert it.

## Failure modes

1. **`u.DefaultFocusNodeID` is nil** (user never picked a focus) → skip Path A; try Path B (`FirstGrantedWorkspace`).
2. **`WorkspaceForFocusNode` returns `ErrNoRows`** (focus node was deleted between sessions) → skip Path A; try Path B.
3. **User's grant on the derived workspace was revoked** → `UserHasActiveGrantOnWorkspace` returns false → skip Path A; try Path B.
4. **`FirstGrantedWorkspace` returns `ErrNoRows`** (user has zero active grants in this tenant) → leave `u.WorkspaceID == uuid.Nil`. JWT signs without claim. Sentinel middleware will then 403 `no-workspace` on the next request — correct (the user has no business in this tenant any more).
5. **Pool query error (timeout, connection refused)** → log the error, leave `u.WorkspaceID == uuid.Nil`, let SignAccessToken proceed without the claim. Same fail-open stance as the existing `resolveDefaultWorkspace` at login (`auth/service.go:957-959`).

## Why fail-open on derivation error?

Refresh is in the hot path. A pool blip is much more common than a security-relevant condition. Failing closed on derivation error would log every user out on the slightest infrastructure hiccup — far worse user experience than the (already-tightened) sentinel fallback. The defence-in-depth still holds: sentinel `HasActiveRole` is the authoritative gate downstream and runs regardless of whether the JWT claim is present or omitted.

## Verification

Smoke account: **padmin** (`6cabe266-b2f4-43f9-879c-06020c789a0b`, sub `0001`). Verified data chain during prior session:

- `users.default_focus_node_id` = `ae2d4ff5-4c8d-4839-af89-7769067476ae` (Insurance node)
- `topology_nodes.workspace_id` for that node = `a4df2e21-8d9a-452b-b4f9-eded455381c8` (ACME Bank Corporate Workspace2)
- `users_roles_workspaces` for padmin = 1 active grant on workspace `a4df2e21-...`

Expected post-fix:
1. Padmin logs in at `http://localhost:5101/login`. Dev-debug panel (footer expand) shows `JWT workspace = scope workspace ✓ match`.
2. Padmin navigates to a `/value-*` page. Panel still shows match.
3. **Refresh the page.** Panel STILL shows `✓ match` with `user.workspace_id (JWT) = a4df2e21-...`, not `00000000-...`.
4. Backend logs do NOT contain the "FirstLiveWorkspace fallback" path firing on refresh (instrument with a one-shot debug log if needed).

Negative test (workspace switching): manually change focus via scope rail to a node in a different workspace (currently dev has only one workspace per tenant, so this needs a fixture or is deferred to a future story).

## Tests

**Unit (workspaceresolver):**
- `TestWorkspaceForFocusNode_returns_workspace_id_for_live_node`
- `TestWorkspaceForFocusNode_returns_ErrNoRows_for_archived_node`
- `TestWorkspaceForFocusNode_returns_ErrNoRows_for_cross_tenant_node` (tenant gate)
- `TestFirstGrantedWorkspace_returns_earliest_granted` (sorted by `created_at`)
- `TestFirstGrantedWorkspace_excludes_revoked_grants`
- `TestFirstGrantedWorkspace_returns_ErrNoRows_when_user_has_no_grants`
- `TestUserHasActiveGrantOnWorkspace_true_for_live_grant`
- `TestUserHasActiveGrantOnWorkspace_false_for_revoked_grant`

**Unit (sentinel — new signature):**
- Update existing case 8 ("Legacy JWT → falls back to FirstLiveWorkspace") to assert the stub receives `userID` matching `u.ID`.
- Add case 8b: "FirstLiveWorkspace returns ErrNoWorkspace when user has no grants" — verify 403 `no-workspace`.

**Integration (auth.Refresh — golden path):**
- `TestRefresh_repopulates_workspace_id_from_default_focus_node` — set up a user with `default_focus_node_id`, call `Refresh`, assert the returned JWT has `workspace_id` matching the topology_nodes lookup.
- `TestRefresh_falls_back_to_first_granted_when_focus_workspace_not_granted` — set up a user whose default_focus points at a workspace they no longer hold a grant on; assert fallback to first granted.
- `TestRefresh_signs_without_claim_when_user_has_zero_grants` — assert the JWT signs (does NOT error) and the claim is omitted.
- `TestRefreshFromSuccessor_repopulates_workspace_id` — same as the first, on the grace-window path.

**Compile gate:**
- `go build ./...` must pass (catches the FirstLiveWorkspace signature change everywhere).
- `go test ./backend/internal/sentinel/...` must stay GREEN with the new signature.

## What's NOT in scope

- Frontend changes — none. The fix is purely backend.
- `users_sessions` schema changes — explicitly out per the user's framing.
- Refactoring `auth.resolveDefaultWorkspace` to use the new `WorkspaceResolver` — Login still has `u.SubscriptionID` only, not `u.DefaultFocusNodeID` evaluated yet (Login is the canonical "first login of this device" path; default_focus_node_id may not be set yet). Could fold in later, not part of this fix.
- Cleaning up the `sentinel.FirstLiveWorkspace` fallback path. It remains as defence-in-depth for any future code path that somehow signs a JWT without the claim. It will now correctly narrow to user grants.
- SY003 regeneration — out per the HARD RULE: regenerate AFTER the fix lands.
- Phase 5 of the `mmff_vector → vector_artefacts` cutover. This fix is standalone and surgical; Phase 5 may rewire pool ownership later, at which point the `WorkspaceResolver` impl is the place that moves (its interface signature is stable, so call sites in `auth` survive untouched).

## Open carry-forwards

- **TD entry** in `docs/c_tech_debt.md`: rename "TD-SENT-WS-TABLE" learnings into a follow-up note that the legacy-fallback path was tightened to user-grants — record the date this lands.
- **Story entry** in `Vector_Scope.md` via `<scope> -a`.
- **SY003 regenerate** via `<report> -sy ...` AFTER merge.
