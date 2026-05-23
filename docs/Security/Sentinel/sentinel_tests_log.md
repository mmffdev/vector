# Sentinel — Tests Log (per-pass RED-GREEN record)

> **Purpose of this file:** Every test written under PLA062 records its RED state, every GREEN attempt, and the eventual GREEN. Audit trail for SOC2 procurement: "Show me the test, the failure, the fix, the proof."
> **Protocol:** [`sentinel_docs.md`](sentinel_docs.md) § Process.

---

## Per-test record schema

Every entry in this file follows this exact shape. Copy the template; don't improvise.

```markdown
### <test_name> (<story_id>)

**File.** `<absolute repo path>`
**Story.** [<story_id> in sentinel_backlog.md](sentinel_backlog.md#<anchor>)
**Tier.** `sentinel.unit` | `sentinel.page.<route>` | `sentinel.e2e`
**Assertions.** (what this test claims, in 1–3 sentences)

#### RED

**Date.** YYYY-MM-DD
**Run command.** `<exact CLI>`
**Output (verbatim).**

```
<paste verbatim, including stack traces, assertion messages, build errors>
```

**Cause.** (one sentence — why it's red: package doesn't exist / behaviour wrong / etc.)

#### GREEN attempts

| Attempt | Date | What changed | Output / verdict |
|---|---|---|---|
| 1 | YYYY-MM-DD | <one-line summary of the change> | <pass/fail + assertion that flipped> |
| 2 | … | … | … |

#### GREEN

**Date.** YYYY-MM-DD
**Run command.** `<exact CLI>`
**Output (verbatim).**

```
<paste verbatim — at minimum the PASS line and the assertion count>
```

**Attempts to green.** <integer>
**Commit.** <SHA short>
```

---

## Why verbatim

Procurement / SOC2 audit narrative depends on this file being **not** a paraphrase. "The test failed because of X" is a claim; the verbatim assertion message is evidence. We paste the actual `expected …, got …` lines, the actual stack trace, the actual `cannot find package "sentinel"` build error. The auditor reads what the test runner said.

## What does NOT go in this file

- Marketing language ("we caught it!").
- Summaries instead of verbatim output.
- Hidden failures — if a test was flaky or skipped, that gets its own entry with `tier = skip` and the reason.

---

## Tests

### TestMiddleware_Case7..9_* (S05.1 — workspace absorption)

**File.** `backend/internal/sentinel/middleware_test.go`
**Story.** [S05 in sentinel_backlog.md](sentinel_backlog.md#s05--mount-sentinelmiddleware-in-cmdservermaingo--tear-out-topologyclampmiddleware-mounts)
**Tier.** Go unit test.
**Assertions.** Three workspace-resolution cases added by the S05 Replace decision:
- Case 7: JWT carries workspace_id claim → `clamp.WorkspaceID` set to it; `FirstLiveWorkspace` MUST NOT be called; `HasActiveRole` MUST be called (forgery guard).
- Case 8: Legacy JWT without workspace_id → falls back to `resolver.FirstLiveWorkspace(tenant)`; `clamp.WorkspaceID` set to the fallback value.
- Case 9: `HasActiveRole(ws, user)` returns false → 403 `application/problem+json` with `type: "/errors/sentinel/no-workspace-role"`; inner handler MUST NOT run.

#### RED

**Date.** 2026-05-24
**Run command.** `cd backend && go test -v ./internal/sentinel/...`
**Output (verbatim — cases 1–6 still PASS; cases 7/8/9 FAIL because middleware does not yet resolve workspace).**

```
=== RUN   TestMiddleware_Case7_JWTWorkspaceClaim_SetsWorkspaceID
    middleware_test.go:461: HasActiveRole was NOT called — forgery guard skipped
    middleware_test.go:470: clamp.WorkspaceID = 00000000-0000-0000-0000-000000000000, want eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee
--- FAIL: TestMiddleware_Case7_JWTWorkspaceClaim_SetsWorkspaceID (0.00s)
=== RUN   TestMiddleware_Case8_LegacyJWT_FallsBackToFirstLive
    middleware_test.go:506: FirstLiveWorkspace was NOT called despite legacy JWT
--- FAIL: TestMiddleware_Case8_LegacyJWT_FallsBackToFirstLive (0.00s)
=== RUN   TestMiddleware_Case9_NoActiveRoleOnWorkspace_403ProblemJSON
    middleware_test.go:554: body.type = /errors/sentinel/focus-not-in-tenant, want /errors/sentinel/no-workspace-role
--- FAIL: TestMiddleware_Case9_NoActiveRoleOnWorkspace_403ProblemJSON (0.00s)
FAIL
FAIL	github.com/mmffdev/vector-backend/internal/sentinel	0.390s
```

**Cause.** Middleware (from S04) only did focus + subtree resolution. The workspace-clamp absorption decision (Replace, logged in `sentinel_revision_history.md` 2026-05-24) requires the middleware to also resolve workspace_id from the JWT, fall back to FirstLiveWorkspace for legacy tokens, and call HasActiveRole as the forgery guard. None of these steps existed in S04.

#### GREEN attempts

| Attempt | Date | What changed | Output / verdict |
|---|---|---|---|
| 1 | 2026-05-24 | Inserted workspace resolution between steps 1 (auth) and 4 (focus) in `Middleware`: `resolveWorkspace` helper (JWT > FirstLiveWorkspace), then `HasActiveRole` forgery guard. Added 3 new error sentinels (ErrNoWorkspace, ErrNoWorkspaceRole). Extended `Clamp` with `WorkspaceID` field. Extended `Resolver` interface with `FirstLiveWorkspace` + `HasActiveRole` methods; added matching methods to `stubResolver`. | **PASS all 9 cases first try** — see GREEN below. |

#### GREEN

**Date.** 2026-05-24
**Run command.** `cd backend && go test -v ./internal/sentinel/...`
**Output (verbatim).**

```
=== RUN   TestMiddleware_Case1_ValidJWTWithFocus_AttachesFullClamp
--- PASS: TestMiddleware_Case1_ValidJWTWithFocus_AttachesFullClamp (0.00s)
=== RUN   TestMiddleware_Case2_NoFocusFallsBackToUserDefault
--- PASS: TestMiddleware_Case2_NoFocusFallsBackToUserDefault (0.00s)
=== RUN   TestMiddleware_Case3_NoFocusNoDefaultFallsBackToTenantRoot
--- PASS: TestMiddleware_Case3_NoFocusNoDefaultFallsBackToTenantRoot (0.00s)
=== RUN   TestMiddleware_Case4_FocusOutsideTenant_403ProblemJSON
--- PASS: TestMiddleware_Case4_FocusOutsideTenant_403ProblemJSON (0.00s)
=== RUN   TestMiddleware_Case5_FocusNoAccess_403ProblemJSON
--- PASS: TestMiddleware_Case5_FocusNoAccess_403ProblemJSON (0.00s)
=== RUN   TestMiddleware_Case6_NoJWT_401ProblemJSON
--- PASS: TestMiddleware_Case6_NoJWT_401ProblemJSON (0.00s)
=== RUN   TestMiddleware_Case7_JWTWorkspaceClaim_SetsWorkspaceID
--- PASS: TestMiddleware_Case7_JWTWorkspaceClaim_SetsWorkspaceID (0.00s)
=== RUN   TestMiddleware_Case8_LegacyJWT_FallsBackToFirstLive
--- PASS: TestMiddleware_Case8_LegacyJWT_FallsBackToFirstLive (0.00s)
=== RUN   TestMiddleware_Case9_NoActiveRoleOnWorkspace_403ProblemJSON
--- PASS: TestMiddleware_Case9_NoActiveRoleOnWorkspace_403ProblemJSON (0.00s)
PASS
ok  	github.com/mmffdev/vector-backend/internal/sentinel	0.319s
```

**Attempts to green.** **1** (target ≤ 3).
**Full backend suite check.** `cd backend && go test ./...` — 29/32 packages PASS. 3 failures (`fields`, `lintchecks`, `workspaces`) are pre-existing DB-state / lint issues unrelated to S05 (none of the failing test files touched by this work — verified by `git status`).
**Commit.** (added in S05 commit)

---

### TestMiddleware_Case1..6_* (S03)

**File.** `backend/internal/sentinel/middleware_test.go`
**Story.** [S03 in sentinel_backlog.md](sentinel_backlog.md#s03--red-backendinternalsentinelmiddleware_testgo-before-the-package-exists)
**Tier.** Go unit test (parallel to `sentinel.unit` tier, but Go-side).
**Assertions.** Six cases pinning the backend Sentinel contract:
1. Valid JWT + `?focus=<uuid>` → 200, ctx carries full `Clamp{TenantID, FocusNodeID, ScopeUp, ScopeDown, AllowedSubtreeIDs[]}`.
2. Valid JWT, no `?focus`, user has default → 200, focus = user's persisted default.
3. Valid JWT, no `?focus`, no user default → 200, focus = tenant root.
4. Focus belongs to another tenant → 403 `application/problem+json`, `type: "/errors/sentinel/focus-not-in-tenant"`.
5. Focus user has no grant on → 403 `application/problem+json`, `type: "/errors/sentinel/focus-no-access"`.
6. No JWT on ctx → 401 `application/problem+json`, `type: "/errors/sentinel/unauthorized"`.

#### RED

**Date.** 2026-05-24
**Run command.** `cd backend && go test ./internal/sentinel/...`
**Output (verbatim).**

```
# github.com/mmffdev/vector-backend/internal/sentinel [github.com/mmffdev/vector-backend/internal/sentinel.test]
internal/sentinel/middleware_test.go:103:10: undefined: Clamp
internal/sentinel/middleware_test.go:108:7: undefined: FromCtx
internal/sentinel/middleware_test.go:129:8: undefined: Middleware
internal/sentinel/middleware_test.go:181:8: undefined: Middleware
internal/sentinel/middleware_test.go:218:8: undefined: Middleware
internal/sentinel/middleware_test.go:242:16: undefined: ErrFocusNotInTenant
internal/sentinel/middleware_test.go:246:8: undefined: Middleware
internal/sentinel/middleware_test.go:282:16: undefined: ErrFocusNoAccess
internal/sentinel/middleware_test.go:286:8: undefined: Middleware
internal/sentinel/middleware_test.go:320:8: too many errors
FAIL	github.com/mmffdev/vector-backend/internal/sentinel [build failed]
FAIL
```

**Cause.** Package `sentinel` is empty (only the test file exists). The six undefined symbols (`Clamp`, `FromCtx`, `Middleware`, `ErrFocusNotInTenant`, `ErrFocusNoAccess`, plus `stubResolver` reference satisfying a not-yet-existent `Resolver` interface) are all S04's job to create. This is the intended RED state for S03 — the test compiles cleanly when the symbols exist.

#### GREEN attempts

| Attempt | Date | What changed | Output / verdict |
|---|---|---|---|
| 1 | 2026-05-24 | Implemented `sentinel/types.go` (Clamp + Resolver interface), `sentinel/errors.go` (sentinels + writeProblem), `sentinel/ctx.go` (withClamp + FromCtx), `sentinel/middleware.go` (full middleware: auth check → focus resolution URL>default>tenant-root → ResolveSubtree → clamp attach), and added `stubResolver.ResolveSubtree/DefaultFocus/TenantRoot` methods on the test stub so it satisfies the new Resolver interface. | **PASS all 6 cases first try** — see GREEN below. |

#### GREEN

**Date.** 2026-05-24
**Run command.** `cd backend && go test -v ./internal/sentinel/...`
**Output (verbatim).**

```
=== RUN   TestMiddleware_Case1_ValidJWTWithFocus_AttachesFullClamp
--- PASS: TestMiddleware_Case1_ValidJWTWithFocus_AttachesFullClamp (0.00s)
=== RUN   TestMiddleware_Case2_NoFocusFallsBackToUserDefault
--- PASS: TestMiddleware_Case2_NoFocusFallsBackToUserDefault (0.00s)
=== RUN   TestMiddleware_Case3_NoFocusNoDefaultFallsBackToTenantRoot
--- PASS: TestMiddleware_Case3_NoFocusNoDefaultFallsBackToTenantRoot (0.00s)
=== RUN   TestMiddleware_Case4_FocusOutsideTenant_403ProblemJSON
--- PASS: TestMiddleware_Case4_FocusOutsideTenant_403ProblemJSON (0.00s)
=== RUN   TestMiddleware_Case5_FocusNoAccess_403ProblemJSON
--- PASS: TestMiddleware_Case5_FocusNoAccess_403ProblemJSON (0.00s)
=== RUN   TestMiddleware_Case6_NoJWT_401ProblemJSON
--- PASS: TestMiddleware_Case6_NoJWT_401ProblemJSON (0.00s)
PASS
ok  	github.com/mmffdev/vector-backend/internal/sentinel	0.336s
```

**Attempts to green.** **1** (target was ≤ 3; the test was specified precisely enough that the implementation went green on first compile).
**Neighbour regression check.** `go test ./internal/auth/... ./internal/topology/...` both PASS — no regressions in the substrate Sentinel duplicates.
**Commit.** (added in S04 commit)

