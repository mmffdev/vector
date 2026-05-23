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
| (pending S04) | | | |

#### GREEN

(pending S04)

