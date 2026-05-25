# JWT `workspace_id` claim survives refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-derive `WorkspaceID` on every refresh from `users.default_focus_node_id → topology_nodes.workspace_id` validated against `users_roles_workspaces`, so the JWT preserves the user's picked workspace across refresh instead of silently reverting to the tenant's earliest-created workspace via the sentinel fallback.

**Architecture:** New `backend/internal/workspaceresolver/` package owns the cross-pool derivation (vector_artefacts for `topology_nodes`, mmff_vector for `users_roles_workspaces`). `auth.Service` grows a nil-safe `WorkspaceResolver` field mirroring the existing `PermissionResolver` pattern. `auth.Refresh` and `auth.refreshFromSuccessor` call it between `FindUserByID` and `SignAccessToken`. Separately, `sentinel.FirstLiveWorkspace` is tightened to JOIN `users_roles_workspaces` so the fallback path also narrows to user-granted workspaces (closes the same bug class for any code path that still relies on the fallback).

**Tech Stack:** Go 1.23, pgx/v5, chi router. No new dependencies.

**Sources:** Spec at [docs/superpowers/specs/2026-05-25-jwt-workspace-claim-refresh-design.md](../specs/2026-05-25-jwt-workspace-claim-refresh-design.md). Handoff at `/var/folders/.../handoff-XXXXXX.md.96Oh0viYzQ`. Verified against `f0091092`.

---

## Task ordering rationale

We work outside-in: first tighten the sentinel fallback (smallest blast radius, no new package, catches the bug for legacy-token paths immediately). Then introduce the `workspaceresolver` package + interface in `auth`. Then wire it into `Refresh` + `refreshFromSuccessor`. Then live-verify with padmin. Each task is independently buildable + commits cleanly.

---

## Task 1: Tighten `sentinel.FirstLiveWorkspace` to user-granted workspaces

**Files:**
- Modify: `backend/internal/sentinel/sql.go` (lines 80-96)
- Modify: `backend/internal/sentinel/types.go` (line 94 — interface signature)
- Modify: `backend/internal/sentinel/resolver.go` (lines 153-163 — impl)
- Modify: `backend/internal/sentinel/middleware.go` (line 143 — call site)
- Modify: `backend/internal/sentinel/middleware_test.go` (lines 109, 161-166, 462, 515 — stub + 2 cases)
- Test: `backend/internal/sentinel/middleware_test.go` (new case 8b)

### Step 1.1: Update the failing test to reflect the new contract (case 8 with userID arg)

Modify `backend/internal/sentinel/middleware_test.go`:

- [ ] **Update the `firstLiveWorkspaceFn` field type** at line 109:

```go
// BEFORE
firstLiveWorkspaceFn func(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error)

// AFTER
firstLiveWorkspaceFn func(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error)
```

- [ ] **Update the `FirstLiveWorkspace` method on `stubResolver`** at lines 161-166:

```go
// AFTER
func (s *stubResolver) FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error) {
    if s.firstLiveWorkspaceFn == nil {
        return fixtureWorkspaceInA, nil
    }
    return s.firstLiveWorkspaceFn(ctx, tenant, userID)
}
```

- [ ] **Update case 7's `firstLiveWorkspaceFn` signature** at line 462:

```go
// AFTER — note: this fn must never actually be called in case 7, but its signature must match
firstLiveWorkspaceFn: func(_ context.Context, _, _ uuid.UUID) (uuid.UUID, error) {
    firstLiveCalled = true
    t.Fatal("FirstLiveWorkspace must NOT be called when JWT carries workspace_id")
    return uuid.Nil, nil
},
```

- [ ] **Update case 8's `firstLiveWorkspaceFn`** at line 515 to assert userID:

```go
// AFTER
firstLiveWorkspaceFn: func(_ context.Context, tenant, userID uuid.UUID) (uuid.UUID, error) {
    firstLiveCalled = true
    if tenant != fixtureTenantA {
        t.Errorf("FirstLiveWorkspace called with tenant=%s, want %s", tenant, fixtureTenantA)
    }
    if userID != uuid.MustParse("99999999-aaaa-aaaa-aaaa-999999999999") {
        t.Errorf("FirstLiveWorkspace called with userID=%s, want fixtureUserA.ID", userID)
    }
    return fixtureWorkspaceInA, nil
},
```

### Step 1.2: Run the test to verify it FAILS to compile

- [ ] Run:

```bash
cd backend && go test ./internal/sentinel/... 2>&1 | head -30
```

Expected: compile errors — the interface signature on `Resolver.FirstLiveWorkspace` does not match the stub. This is the RED state.

### Step 1.3: Update the `Resolver` interface signature

Modify `backend/internal/sentinel/types.go` (line 94):

- [ ] Change the method signature on the `Resolver` interface:

```go
// BEFORE (line 94)
FirstLiveWorkspace(ctx context.Context, tenant uuid.UUID) (uuid.UUID, error)

// AFTER
FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error)
```

- [ ] Also update the doc comment immediately above (lines 89-94) to reflect the new contract:

```go
// FirstLiveWorkspace returns the actor's first live workspace in
// their tenant that they hold an active grant on, ordered by
// created_at ASC. Used as fallback when the JWT carries no
// workspace_id claim (legacy-token rollout window per PLA-0053 /
// story 00576, plus any code path that signs a JWT without the
// claim). The user-grant narrowing (added 2026-05-25 alongside the
// auth.Refresh re-derivation fix) prevents the fallback from
// returning a workspace the actor has no grant on — which then
// 403'd at HasActiveRole one step later.
//
// Returns ErrNoWorkspace when the user has zero active grants in
// the tenant.
FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error)
```

### Step 1.4: Update the SQL constant

Modify `backend/internal/sentinel/sql.go` (lines 80-96):

- [ ] Replace the constant + its doc comment:

```go
// sqlFirstLiveWorkspace returns the actor's first live workspace in
// their tenant that they hold an active grant on, ordered by
// created_at ASC (Default lands first). $1 = subscriptionID,
// $2 = userID.
//
// The JOIN against users_roles_workspaces (added 2026-05-25
// alongside the auth.Refresh JWT re-derivation fix) prevents the
// fallback from returning a workspace the user has no grant on
// — which then 403'd at sqlExistsActiveWorkspaceRole one step
// later. Column-prefix convention (PLA naming spec §2.3): every
// column on users_roles_workspaces carries the table-name prefix.
const sqlFirstLiveWorkspace = `
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
`
```

### Step 1.5: Update the `PoolResolver.FirstLiveWorkspace` impl

Modify `backend/internal/sentinel/resolver.go` (lines 153-163):

- [ ] Replace the method:

```go
// FirstLiveWorkspace implements Resolver. Maps the underlying
// sql.ErrNoRows to sentinel.ErrNoWorkspace so middleware can render
// the right ProblemJSON. Narrows by user-grant per the 2026-05-25
// fix — see sql.go for rationale.
func (r *PoolResolver) FirstLiveWorkspace(ctx context.Context, tenant, userID uuid.UUID) (uuid.UUID, error) {
    var id uuid.UUID
    err := r.MVPool.QueryRow(ctx, sqlFirstLiveWorkspace, tenant, userID).Scan(&id)
    if errors.Is(err, pgx.ErrNoRows) {
        return uuid.Nil, ErrNoWorkspace
    }
    return id, err
}
```

### Step 1.6: Update the middleware call site

Modify `backend/internal/sentinel/middleware.go` (lines 135-144):

- [ ] Replace `resolveWorkspace`:

```go
// resolveWorkspace picks the workspace per JWT claim > FirstLiveWorkspace
// fallback. The fallback exists for tokens predating PLA-0053 (story
// 00576, 2026-05-16) plus any future code path that signs without the
// claim. As of 2026-05-25 the fallback narrows to user-granted workspaces
// — see sentinel/sql.go for rationale.
func resolveWorkspace(req *http.Request, u *roletypes.User, r Resolver) (uuid.UUID, error) {
    if u.WorkspaceID != uuid.Nil {
        return u.WorkspaceID, nil
    }
    return r.FirstLiveWorkspace(req.Context(), u.SubscriptionID, u.ID)
}
```

### Step 1.7: Add case 8b — "FirstLiveWorkspace returns ErrNoWorkspace when user has no grants"

Append to `backend/internal/sentinel/middleware_test.go` (after case 8, before case 9):

- [ ] Add:

```go
// ---------------------------------------------------------------------
// Case 8b — Legacy JWT + user has no workspace grants → 403 no-workspace
// ---------------------------------------------------------------------
// Tightening sqlFirstLiveWorkspace to JOIN users_roles_workspaces means
// a user with zero active grants in the tenant now hits ErrNoWorkspace
// instead of being silently handed the tenant's earliest workspace.
// This is the contract the new 2026-05-25 fix preserves end-to-end:
// the fallback can no longer return a workspace the user can't see.

func TestMiddleware_Case8b_LegacyJWT_NoGrants_403NoWorkspace(t *testing.T) {
    resolver := &stubResolver{
        firstLiveWorkspaceFn: func(_ context.Context, _, _ uuid.UUID) (uuid.UUID, error) {
            return uuid.Nil, ErrNoWorkspace
        },
    }

    mw := Middleware(resolver)
    h := mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

    req := httptest.NewRequest("GET", "/anything", nil)
    req = req.WithContext(withFixtureUser(req.Context(), fixtureLegacyUserA()))
    rec := httptest.NewRecorder()
    h.ServeHTTP(rec, req)

    if rec.Code != http.StatusForbidden {
        t.Fatalf("expected 403, got %d (body=%q)", rec.Code, rec.Body.String())
    }
    if !strings.Contains(rec.Body.String(), "no-workspace") {
        t.Errorf("body missing no-workspace problem type: %q", rec.Body.String())
    }
}
```

If `strings` is not already imported, add it. Check imports at the top of the file first.

### Step 1.8: Run tests to verify GREEN

- [ ] Run:

```bash
cd backend && go test ./internal/sentinel/...
```

Expected: PASS, including the new case 8b. If any case fails to compile due to the FirstLiveWorkspace signature change, fix call sites in that test before continuing.

### Step 1.9: Verify the whole backend still builds

- [ ] Run:

```bash
cd backend && go build ./...
```

Expected: clean build. This is the cross-package compile gate that catches any other caller of `Resolver.FirstLiveWorkspace` (there shouldn't be any, but the gate is cheap insurance).

### Step 1.10: Commit

- [ ] Run:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && git add backend/internal/sentinel/sql.go backend/internal/sentinel/types.go backend/internal/sentinel/resolver.go backend/internal/sentinel/middleware.go backend/internal/sentinel/middleware_test.go
git diff --cached --stat
```

Inspect the staged-file list (HARD RULE — inspect index before every commit). Should be exactly 5 files in `backend/internal/sentinel/`. If anything else is staged, unstage it with `git reset HEAD <path>`.

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
fix(sentinel): narrow FirstLiveWorkspace to user-granted workspaces

Tighten sqlFirstLiveWorkspace to JOIN users_roles_workspaces so the
legacy-token fallback path can no longer return a workspace the actor
has no grant on (which then 403'd at HasActiveRole one step later).
Adds userID to the Resolver.FirstLiveWorkspace signature.

Companion to the upcoming auth.Refresh re-derivation fix that prevents
the fallback from firing on the common path in the first place.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create `workspaceresolver` package — SQL constants

**Files:**
- Create: `backend/internal/workspaceresolver/sql.go`

### Step 2.1: Create the SQL file

- [ ] Create `backend/internal/workspaceresolver/sql.go` with:

```go
// Package workspaceresolver derives a user's active workspace_id from
// the database when the JWT does not carry the claim — used by
// auth.Refresh + auth.refreshFromSuccessor between FindUserByID and
// SignAccessToken so the re-minted access token preserves the user's
// picked workspace across refresh instead of silently reverting to
// the tenant's earliest workspace via the sentinel fallback.
//
// Cross-pool design:
//   - users.default_focus_node_id lives in mmff_vector (mvPool)
//   - topology_nodes.workspace_id lives in vector_artefacts (vaPool)
//   - users_roles_workspaces lives in mmff_vector (mvPool)
//
// Postgres cannot FK across databases, so the derivation runs two
// queries instead of one JOIN. The package lives outside auth so
// auth doesn't grow a vaPool field; auth depends on a small
// WorkspaceResolver interface (defined in auth/service.go) and main.go
// injects the concrete PoolResolver from this package at boot.
package workspaceresolver

// sqlWorkspaceForFocusNode returns the workspace_id of the given live
// topology node, gated by tenant. $1 = focusNodeID, $2 = tenantID.
// Returns ErrNoRows when the node is archived, in another tenant, or
// has been deleted between the JWT being signed and now.
//
// topology_nodes.workspace_id is NOT NULL (vector_artefacts schema),
// so a successful return guarantees a non-nil uuid.
const sqlWorkspaceForFocusNode = `
    SELECT workspace_id
      FROM topology_nodes
     WHERE id = $1
       AND subscription_id = $2
       AND archived_at IS NULL
     LIMIT 1
`

// sqlFirstGrantedWorkspace returns the earliest-created live workspace
// in the tenant that the user holds an active grant on. $1 = userID,
// $2 = tenantID. Returns ErrNoRows when the user has zero active grants
// in the tenant (they have no business in this tenant any more — the
// caller leaves WorkspaceID == uuid.Nil and the JWT signs without the
// claim; sentinel.Middleware will 403 no-workspace on the next request,
// which is correct).
//
// Predicate mirrors the tightened sentinel.sqlFirstLiveWorkspace so a
// single source of truth governs "which workspaces can this user see".
const sqlFirstGrantedWorkspace = `
    SELECT mw.id
      FROM master_record_workspaces mw
      JOIN users_roles_workspaces urw
        ON urw.users_roles_workspaces_id_workspace = mw.id
       AND urw.users_roles_workspaces_id_user = $1
       AND urw.users_roles_workspaces_revoked_at IS NULL
     WHERE mw.subscription_id = $2
       AND mw.archived_at IS NULL
     ORDER BY mw.created_at ASC
     LIMIT 1
`

// sqlUserHasActiveGrantOnWorkspace returns TRUE when the user holds
// an active grant on the workspace. $1 = userID, $2 = workspaceID.
//
// Mirrors sentinel.sqlExistsActiveWorkspaceRole exactly — same predicate,
// different parameter order to match the WorkspaceResolver method
// signature (userID first, workspace second, since callers usually
// have userID in hand from the JWT and workspace from the derivation).
const sqlUserHasActiveGrantOnWorkspace = `
    SELECT EXISTS (
        SELECT 1
          FROM users_roles_workspaces
         WHERE users_roles_workspaces_id_user = $1
           AND users_roles_workspaces_id_workspace = $2
           AND users_roles_workspaces_revoked_at IS NULL
    )
`
```

### Step 2.2: Verify it compiles

- [ ] Run:

```bash
cd backend && go build ./internal/workspaceresolver/...
```

Expected: clean build (no errors — package has no Go code yet, just consts).

---

## Task 3: `workspaceresolver` package — PoolResolver implementation

**Files:**
- Create: `backend/internal/workspaceresolver/resolver.go`

### Step 3.1: Create the resolver

- [ ] Create `backend/internal/workspaceresolver/resolver.go` with:

```go
package workspaceresolver

import (
    "context"
    "errors"
    "fmt"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

// ErrNoWorkspace is returned by FirstGrantedWorkspace when the user
// holds zero active grants in the tenant. WorkspaceForFocusNode
// returns the underlying pgx.ErrNoRows so callers can distinguish
// "focus deleted / cross-tenant" from "user has no workspaces at all".
var ErrNoWorkspace = errors.New("user has no active workspace grants in this tenant")

// PoolResolver is the production implementation of the
// auth.WorkspaceResolver interface. Holds both database pools
// because the derivation crosses them (topology_nodes in
// vector_artefacts, users + users_roles_workspaces in mmff_vector).
//
// Construct via NewPoolResolver; passing nil pools is a programming
// error and surfaces as a nil-pointer panic on the first call.
type PoolResolver struct {
    VAPool *pgxpool.Pool // vector_artefacts (topology_nodes)
    MVPool *pgxpool.Pool // mmff_vector (users_roles_workspaces, master_record_workspaces)
}

// NewPoolResolver constructs a PoolResolver.
func NewPoolResolver(vaPool, mvPool *pgxpool.Pool) *PoolResolver {
    return &PoolResolver{VAPool: vaPool, MVPool: mvPool}
}

// WorkspaceForFocusNode returns the workspace_id of the given live
// topology node, gated by tenant. Returns pgx.ErrNoRows when the
// node is archived, in another tenant, or has been deleted.
func (r *PoolResolver) WorkspaceForFocusNode(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error) {
    var id uuid.UUID
    err := r.VAPool.QueryRow(ctx, sqlWorkspaceForFocusNode, focusNodeID, tenantID).Scan(&id)
    if err != nil {
        return uuid.Nil, err
    }
    return id, nil
}

// FirstGrantedWorkspace returns the earliest-created workspace in the
// tenant that the user holds an active grant on. Returns ErrNoWorkspace
// when the user has zero active grants in the tenant.
func (r *PoolResolver) FirstGrantedWorkspace(ctx context.Context, userID, tenantID uuid.UUID) (uuid.UUID, error) {
    var id uuid.UUID
    err := r.MVPool.QueryRow(ctx, sqlFirstGrantedWorkspace, userID, tenantID).Scan(&id)
    if errors.Is(err, pgx.ErrNoRows) {
        return uuid.Nil, ErrNoWorkspace
    }
    if err != nil {
        return uuid.Nil, fmt.Errorf("workspaceresolver.FirstGrantedWorkspace: %w", err)
    }
    return id, nil
}

// UserHasActiveGrantOnWorkspace returns true when the user holds an
// active (non-revoked) grant on the workspace.
func (r *PoolResolver) UserHasActiveGrantOnWorkspace(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error) {
    var ok bool
    err := r.MVPool.QueryRow(ctx, sqlUserHasActiveGrantOnWorkspace, userID, workspaceID).Scan(&ok)
    if err != nil {
        return false, fmt.Errorf("workspaceresolver.UserHasActiveGrantOnWorkspace: %w", err)
    }
    return ok, nil
}
```

### Step 3.2: Verify it compiles

- [ ] Run:

```bash
cd backend && go build ./internal/workspaceresolver/...
```

Expected: clean build.

### Step 3.3: Commit Tasks 2 + 3 together

- [ ] Run:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && git add backend/internal/workspaceresolver/sql.go backend/internal/workspaceresolver/resolver.go
git diff --cached --stat
```

Inspect — exactly 2 new files in `backend/internal/workspaceresolver/`. Unstage anything else.

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(workspaceresolver): cross-pool workspace derivation for auth refresh

New package owning the topology-node → workspace lookup that auth.Refresh
needs to re-derive the JWT workspace_id claim. Lives outside auth so
auth keeps a one-pool dependency surface; main.go injects the concrete
PoolResolver via a new WorkspaceResolver interface field on auth.Service
(added in the next commit, mirroring the existing PermissionResolver
pattern).

Three methods:
  - WorkspaceForFocusNode: topology_nodes lookup (vaPool)
  - FirstGrantedWorkspace: earliest-granted fallback (mvPool)
  - UserHasActiveGrantOnWorkspace: revocation check (mvPool)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Define `auth.WorkspaceResolver` interface + add field on Service

**Files:**
- Modify: `backend/internal/auth/service.go` (lines 53-55 area for interface; lines 57-86 area for Service struct)

### Step 4.1: Add the `WorkspaceResolver` interface

In `backend/internal/auth/service.go`, immediately AFTER the existing `PermissionResolver` interface definition (line 55 — the closing `}`), add:

- [ ] Insert:

```go
// WorkspaceResolver is the small surface auth.Service needs to re-derive
// the user's active workspace_id on Refresh. Mirrors PermissionResolver:
// auth depends on a tiny interface, main.go injects the concrete impl
// from backend/internal/workspaceresolver/ at boot, keeping auth free
// of a vaPool field and the auth → vector_artefacts dependency edge.
//
// Used by Refresh + refreshFromSuccessor between FindUserByID and
// SignAccessToken — see service.go:587 / service.go:680.
//
// Nil-safe: when Service.WorkspaceResolver is nil (tests that don't
// wire it), the re-derivation block in Refresh skips and SignAccessToken
// signs without the workspace_id claim — same behaviour as before this
// fix landed, so the sentinel fallback remains the defence-in-depth gate.
//
// Method contract:
//   - WorkspaceForFocusNode: tenant-gated lookup of topology_nodes.workspace_id.
//     Returns pgx.ErrNoRows when the focus node was deleted/archived/cross-tenant.
//   - FirstGrantedWorkspace: earliest-created live workspace the user holds
//     an active grant on. Returns workspaceresolver.ErrNoWorkspace when none.
//   - UserHasActiveGrantOnWorkspace: revocation check — true when the user
//     still holds a live (non-revoked) grant on the workspace.
type WorkspaceResolver interface {
    WorkspaceForFocusNode(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error)
    FirstGrantedWorkspace(ctx context.Context, userID, tenantID uuid.UUID) (uuid.UUID, error)
    UserHasActiveGrantOnWorkspace(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error)
}
```

### Step 4.2: Add the `WorkspaceResolver` field to `Service`

In `backend/internal/auth/service.go`, in the `Service` struct (line 57+), AFTER the `Resolver PermissionResolver` field at line 61, insert:

- [ ] Add field:

```go
type Service struct {
    Pool              *pgxpool.Pool
    Audit             *audit.Logger
    Mailer            *email.Service
    Resolver          PermissionResolver
    WorkspaceResolver WorkspaceResolver  // NEW: re-derives JWT workspace_id on Refresh (nil-safe)

    // ... rest unchanged ...
}
```

(Preserve the existing tags, comments, and field order otherwise. The only structural change is the one new field immediately after `Resolver`.)

### Step 4.3: Verify it compiles

- [ ] Run:

```bash
cd backend && go build ./internal/auth/...
```

Expected: clean build.

### Step 4.4: Commit Task 4

- [ ] Run:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && git add backend/internal/auth/service.go
git diff --cached --stat
```

Inspect — exactly 1 file. Unstage anything else.

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(auth): add WorkspaceResolver interface + nil-safe field on Service

Mirrors the existing PermissionResolver pattern. Concrete impl lives in
backend/internal/workspaceresolver/; wired by main.go in the next commit.
Nil-safe so existing tests that construct auth.NewService(...) without
the resolver continue to pass — the upcoming Refresh re-derivation block
checks for nil before calling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Re-derive `WorkspaceID` in `auth.Refresh`

**Files:**
- Modify: `backend/internal/auth/service.go` (lines 587-630 area — between FindUserByID and SignAccessToken)

### Step 5.1: Add a private helper for the derivation

In `backend/internal/auth/service.go`, AFTER `resolveDefaultWorkspace` (which ends around line 966), add:

- [ ] Insert:

```go
// deriveWorkspaceForRefresh re-populates u.WorkspaceID on refresh
// (Refresh + refreshFromSuccessor) so the re-minted access token
// carries the workspace_id claim instead of dropping it. Three-tier
// resolution:
//   Path A: u.DefaultFocusNodeID → topology_nodes.workspace_id,
//           validated against an active users_roles_workspaces grant.
//   Path B: workspaceresolver.FirstGrantedWorkspace (earliest-created
//           workspace the user holds an active grant on in this tenant).
//   Path C: leave u.WorkspaceID == uuid.Nil. SignAccessToken signs
//           without the claim; sentinel.Middleware will 403 no-workspace
//           on the next request, which is correct (user has no business
//           in this tenant any more).
//
// Fail-open on resolver errors: refresh is in the hot path and a pool
// blip is far more common than a security-relevant condition. Log and
// fall through to the next path or to Path C. The defence-in-depth still
// holds: sentinel.HasActiveRole is the authoritative gate downstream
// and runs regardless of whether the JWT claim is present.
//
// Nil-safe: when s.WorkspaceResolver is nil (tests that don't wire it),
// returns immediately leaving u.WorkspaceID == uuid.Nil — same behaviour
// as before this fix landed.
func (s *Service) deriveWorkspaceForRefresh(ctx context.Context, u *roletypes.User) {
    if s.WorkspaceResolver == nil {
        return
    }

    // Path A — derive from default focus node.
    if u.DefaultFocusNodeID != nil {
        wsID, err := s.WorkspaceResolver.WorkspaceForFocusNode(ctx, *u.DefaultFocusNodeID, u.SubscriptionID)
        if err == nil {
            // Validate the user still holds an active grant on this
            // workspace. If the grant was revoked since they last
            // logged in, fall through to Path B.
            ok, grantErr := s.WorkspaceResolver.UserHasActiveGrantOnWorkspace(ctx, u.ID, wsID)
            if grantErr == nil && ok {
                u.WorkspaceID = wsID
                return
            }
        }
        // pgx.ErrNoRows (focus deleted/archived/cross-tenant) or grant
        // check failure → fall through silently to Path B.
    }

    // Path B — first granted workspace fallback.
    if wsID, err := s.WorkspaceResolver.FirstGrantedWorkspace(ctx, u.ID, u.SubscriptionID); err == nil {
        u.WorkspaceID = wsID
        return
    }
    // Path C — leave uuid.Nil. JWT signs without claim.
}
```

### Step 5.2: Wire it into `Refresh`

In `backend/internal/auth/service.go`, in `Refresh` between line 587 (the `FindUserByID` call) and line 593 (the `GenerateRefreshToken` call), insert the derivation call:

- [ ] Modify around line 587-590:

```go
// BEFORE
u, err := s.FindUserByID(ctx, userID)
if err != nil {
    return nil, err
}

// Rotate: revoke old (stamping rotation metadata), insert new.
raw, newHash, err := GenerateRefreshToken()

// AFTER
u, err := s.FindUserByID(ctx, userID)
if err != nil {
    return nil, err
}

// Re-derive WorkspaceID — FindUserByID doesn't populate it (it's a
// per-session selection, not a column on users). Without this, every
// refresh would drop the workspace_id claim and the sentinel fallback
// would silently revert the user to the tenant's earliest-granted
// workspace. See deriveWorkspaceForRefresh for the three-tier rationale.
s.deriveWorkspaceForRefresh(ctx, u)

// Rotate: revoke old (stamping rotation metadata), insert new.
raw, newHash, err := GenerateRefreshToken()
```

### Step 5.3: Wire it into `refreshFromSuccessor`

In `backend/internal/auth/service.go`, in `refreshFromSuccessor` between line 680 (the `FindUserByID` call) and line 686 (the `SignAccessToken` call), insert the same:

- [ ] Modify around line 680-686:

```go
// BEFORE
u, err := s.FindUserByID(ctx, userID)
if err != nil {
    return nil, err
}
// Successor session is already live — stamp its id as the sid claim
// and re-emit the same cnf.jkt the parent rotation set on the row.
access, err := SignAccessToken(u, sessID, boundJKT)

// AFTER
u, err := s.FindUserByID(ctx, userID)
if err != nil {
    return nil, err
}
// Re-derive WorkspaceID — same rationale as Refresh, applies on the
// grace-window path too. See deriveWorkspaceForRefresh.
s.deriveWorkspaceForRefresh(ctx, u)

// Successor session is already live — stamp its id as the sid claim
// and re-emit the same cnf.jkt the parent rotation set on the row.
access, err := SignAccessToken(u, sessID, boundJKT)
```

### Step 5.4: Verify it compiles

- [ ] Run:

```bash
cd backend && go build ./...
```

Expected: clean build across all packages.

### Step 5.5: Run the auth test suite

- [ ] Run:

```bash
cd backend && go test ./internal/auth/...
```

Expected: PASS. Existing tests construct `auth.NewService(...)` without wiring `WorkspaceResolver`, so the nil-safe early return in `deriveWorkspaceForRefresh` means existing Refresh behaviour is unchanged from the test's perspective.

### Step 5.6: Commit Task 5

- [ ] Run:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && git add backend/internal/auth/service.go
git diff --cached --stat
```

Inspect — exactly 1 file. Unstage anything else.

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
fix(auth): re-derive WorkspaceID on Refresh so JWT preserves user pick

Login stamps u.WorkspaceID before SignAccessToken; Refresh does not, so
the access token re-minted on every refresh drops the workspace_id claim
and the sentinel fallback silently reverts the user to the tenant's
earliest-granted workspace.

Inserts a three-tier derivation between FindUserByID and SignAccessToken
in both Refresh and refreshFromSuccessor:

  A: default_focus_node_id → topology_nodes.workspace_id (validated)
  B: first granted workspace (earliest created_at)
  C: leave nil → JWT signs without claim → sentinel 403s no-workspace

Fail-open on resolver errors (refresh is hot-path; pool blips are far
more common than security conditions, and sentinel.HasActiveRole remains
the authoritative downstream gate).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire the resolver in `main.go`

**Files:**
- Modify: `backend/cmd/server/main.go` (line 175 area — auth service construction)

### Step 6.1: Add the import + wiring

In `backend/cmd/server/main.go`:

- [ ] **Add the import** to the existing import block (alphabetised among `mmffdev/vector-backend/internal/*` imports):

```go
"github.com/mmffdev/vector-backend/internal/workspaceresolver"
```

- [ ] **Wire the resolver** after `authSvc.Resolver = permResolver` (line 176). Insert immediately after that line:

```go
// Cross-pool workspace re-derivation for auth.Refresh — without this
// the JWT drops its workspace_id claim on every refresh and the
// sentinel fallback silently reverts the user to the tenant's
// earliest-granted workspace. The resolver needs both pools because
// topology_nodes lives in vector_artefacts and users_roles_workspaces
// lives in mmff_vector. Wired only when vaPool is up — pre-cutover
// environments without vector_artefacts skip this enhancement (the
// sentinel fallback still works; it just doesn't preserve user picks).
if vaPool != nil {
    authSvc.WorkspaceResolver = workspaceresolver.NewPoolResolver(vaPool, pool)
}
```

### Step 6.2: Verify it compiles + runs

- [ ] Run:

```bash
cd backend && go build ./cmd/server/...
```

Expected: clean build.

- [ ] Run the full test suite to catch any regression:

```bash
cd backend && go test ./...
```

Expected: PASS across all packages.

### Step 6.3: Commit Task 6

- [ ] Run:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && git add backend/cmd/server/main.go
git diff --cached --stat
```

Inspect — exactly 1 file.

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
wire(server): inject workspaceresolver.PoolResolver into auth.Service

Closes the JWT workspace_id refresh-loss bug end-to-end. Guarded on vaPool
being up so pre-cutover environments degrade gracefully to the sentinel
fallback path (which is now also user-grant-narrowed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Live verification with padmin

**Files:**
- None modified — this is a manual verification task.

### Step 7.1: Restart backend

- [ ] Restart the Go backend so it picks up the new code:

```bash
# Find the backend pid and restart per project conventions.
# The launcher manages this; if running locally, kill + relaunch with BACKEND_ENV=dev on :5100.
lsof -i :5100 | grep LISTEN
```

If the backend is launcher-managed, restart via the launcher. If local, kill `:5100` and re-run `go run ./cmd/server` with `BACKEND_ENV=dev`.

Confirm `localhost:5100` is responding before continuing.

### Step 7.2: Pre-flight DB check on padmin's expected derivation

- [ ] Run a sanity check that the data still matches the handoff's expected chain (the DB may have moved since the handoff was written):

```bash
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d mmff_vector -c \
  "SELECT id, default_focus_node_id FROM users WHERE id = '6cabe266-b2f4-43f9-879c-06020c789a0b';"
```

Expected: `default_focus_node_id = ae2d4ff5-4c8d-4839-af89-7769067476ae`.

- [ ] Then the cross-pool lookup:

```bash
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d vector_artefacts -c \
  "SELECT id, workspace_id FROM topology_nodes WHERE id = 'ae2d4ff5-4c8d-4839-af89-7769067476ae';"
```

Expected: `workspace_id = a4df2e21-8d9a-452b-b4f9-eded455381c8`.

- [ ] And the grant check:

```bash
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d mmff_vector -c \
  "SELECT users_roles_workspaces_id_workspace, users_roles_workspaces_revoked_at
     FROM users_roles_workspaces
    WHERE users_roles_workspaces_id_user = '6cabe266-b2f4-43f9-879c-06020c789a0b';"
```

Expected: at least one row with workspace `a4df2e21-...` and `revoked_at IS NULL`.

If any of these don't match, STOP and tell the user — the fixture has moved and verification needs a fresh smoke account.

### Step 7.3: Browser verification

- [ ] Open `http://localhost:5101/login` in the browser.

- [ ] Log in as `padmin@mmffdev.com` / `password`.

- [ ] Open the dev-debug panel (footer expand). Confirm `JWT workspace = scope workspace ✓ match` with `user.workspace_id (JWT) = a4df2e21-8d9a-452b-b4f9-eded455381c8`.

- [ ] Navigate to any `/value-*` page. Panel should still show ✓ match.

- [ ] **Refresh the page (Cmd-R).** Confirm:
  - Panel still shows `JWT workspace ✓ match`.
  - `user.workspace_id (JWT)` is still `a4df2e21-...`, NOT `00000000-0000-0000-0000-000000000000`.

If the JWT shows `00000000-...` after refresh, the fix did NOT land — re-check `main.go` wiring, restart, and verify pools are non-nil at boot.

### Step 7.4: Negative-path sanity check

- [ ] Tail the backend logs while refreshing 2-3 times. Confirm NO log line matching `sentinel.Middleware resolveWorkspace` or `FirstLiveWorkspace fallback`. (If there's no such log line — none is emitted by the current code — this step is a no-op; skip without writing instrumentation purely for this verification.)

### Step 7.5: Mark verification complete

This task has no commit — it's a manual gate. Move to Task 8.

---

## Task 8: Tech-debt note + scope entry + SY003 regenerate

**Files:**
- Modify: `docs/c_tech_debt.md` (add a one-liner under the TD-SENT-WS-TABLE area)
- Modify: `Vector_Scope.md` (via the `<scope> -a` skill)

### Step 8.1: Append a TD note

- [ ] Open `docs/c_tech_debt.md`, find the existing TD-SENT-WS-TABLE entry, and append a follow-up line noting that:
  - The legacy fallback path was tightened on 2026-05-25 (commit hash from Task 1).
  - `auth.Refresh` now re-derives `WorkspaceID` (commit hash from Task 5).
  - Together these close the JWT-loses-workspace-claim bug class.

The exact wording is per the existing TD-* style in that file — read 3-4 surrounding entries first to match the voice. If TD-SENT-WS-TABLE doesn't exist, add a fresh `TD-AUTH-JWT-WORKSPACE-CLAIM-REFRESH` entry instead.

### Step 8.2: Scope entry

- [ ] Add a scope entry via the `<scope> -a` skill describing the fix as completed. The skill will prompt for a title and acceptance criteria — use the spec's "Verification" section as the AC source.

### Step 8.3: Regenerate SY003

Per the HARD RULE in CLAUDE.md (substrate change → regenerate SY003):

- [ ] Run the `<report> -sy` skill with:

```
current state of all three Vector databases (mmff_vector, vector_artefacts, mmff_library) — complete table inventory grouped by role, with row counts, cross-DB FKs, naming collisions, dead-weight candidates, and every SQL touchpoint in the codebase. Sourced from live pg_stat_user_tables + information_schema introspection. Change-log entry: 2026-05-25 — JWT workspace_id claim now re-derived on auth.Refresh via new workspaceresolver package; sentinel.FirstLiveWorkspace tightened to user-granted workspaces.
```

This appends a new Change Log entry to SY003 (non-destructive POST to the same `SY003` ID).

### Step 8.4: Commit Task 8

- [ ] Run:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && git add docs/c_tech_debt.md Vector_Scope.md
git diff --cached --stat
```

Inspect — exactly the doc/scope files. Unstage anything else.

- [ ] Commit:

```bash
git commit -m "$(cat <<'EOF'
docs: register JWT workspace_id refresh-fix completion in TD + scope

TD note ties the cross-pool re-derivation work back to TD-SENT-WS-TABLE
(or the new entry if absent) so the procurement narrative shows both the
identified gap and the fix lineage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

SY003 is server-side; no commit needed for that step.

---

## Self-Review

**Spec coverage:**
- Re-derivation in Refresh → Task 5 ✓
- Re-derivation in refreshFromSuccessor → Task 5 ✓
- Sentinel SQL tightened to user-grant → Task 1 ✓
- WorkspaceResolver interface (auth side) → Task 4 ✓
- workspaceresolver package (concrete impl) → Tasks 2, 3 ✓
- main.go wiring → Task 6 ✓
- Test stub updates → Task 1 ✓
- New case 8b test → Task 1 ✓
- Live padmin verification → Task 7 ✓
- TD entry + scope + SY003 regen → Task 8 ✓

**Placeholder scan:** All steps contain concrete code, exact paths, exact commands. No "TBD" or "similar to". Task 7's "if there's no such log line" wording is intentional (verification of an absence) — kept explicit so the executor doesn't add log lines just for this verification.

**Type consistency:**
- `Resolver.FirstLiveWorkspace(ctx, tenant, userID)` — used identically in types.go, sql.go, resolver.go, middleware.go, middleware_test.go ✓
- `WorkspaceResolver.WorkspaceForFocusNode(ctx, focusNodeID, tenantID)` — used identically in auth/service.go interface + workspaceresolver/resolver.go impl + service.go call site ✓
- `WorkspaceResolver.FirstGrantedWorkspace(ctx, userID, tenantID)` — same ✓
- `WorkspaceResolver.UserHasActiveGrantOnWorkspace(ctx, userID, workspaceID)` — same ✓
- `workspaceresolver.ErrNoWorkspace` (NOT `sentinel.ErrNoWorkspace`) — package-scoped, no clash ✓
- SQL parameter order: `sqlFirstLiveWorkspace($1=sub, $2=user)` matches Resolver call `(tenant, userID)` ✓
- SQL parameter order: `sqlFirstGrantedWorkspace($1=user, $2=sub)` matches WorkspaceResolver call `(userID, tenantID)` ✓
