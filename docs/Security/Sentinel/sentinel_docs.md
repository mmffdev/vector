# Sentinel — System Documentation

> **Status:** **Closed 2026-05-24** — PLA062 frontend + backend lint contract delivered (S01–S24). Two follow-ups carved out and tracked in [`sentinel_tech_debt.md`](sentinel_tech_debt.md): **S26** (subtree-aware SQL clamp + per-package integration tests) and **TD-SENT-AUTH-EXTRACT** (credential-flow lift from `AuthContext.tsx` into `app/lib/auth.ts`). S25 (delete `topology.ClampMiddleware`) is the last numbered story remaining.
> **Spec source:** [PLA062 on Dev → Reporting → Plan tab](/dev/reporting?type=plan).
> **Purpose of this file:** The synopsis, the reason, the process, the requirements, the outputs. Read this first if you're new to Sentinel.

---

## Synopsis

Sentinel is the **single source of truth** for who-the-user-is, which-tenant-they're-in, and which-topology-node-they're-focused-on. It collapses what used to be four overlapping React contexts (`AuthContext`, `ScopeContext`, `TenantContext`, the original read-only `Sentinel`, plus the `scopeReloadRegistry` escape hatch — 1,039 LOC + ~190 consumer call sites) into one surface:

- **Frontend:** `app/sentinel/` — one provider (`SentinelProvider`), one hook (`useSentinel()`), one namespaced state bag (`sentinel_user`, `sentinel_tenant`, `sentinel_role`, `sentinel_grants`, `sentinel_focus_node`, `sentinel_scope_up`, `sentinel_scope_down`, `sentinel_workspace_in_sync`, …) and action methods (`sentinel_switch_tenant`, `sentinel_set_focus`, `sentinel_can`, `sentinel_reload`).
- **Backend:** `backend/internal/sentinel/` — a Go middleware mounted in front of every `/_site/admin/*` and `/samantha/v2/*` route. Reads the JWT, resolves the focus node, calls `topology.Service.ResolveSubtree`, attaches a `sentinel.Clamp` struct to the request context. Downstream handlers MUST read the clamp via `sentinel.FromCtx(ctx)`; bypassing it is lint-banned.
- **Tests:** three RED-GREEN tiers — `sentinel.unit`, `sentinel.page.<route>`, `sentinel.e2e` — runnable all-at-once or sliced by tag.

## Reason

Procurement / SOC2 / defence / finance buyers ask: **"Show me the single source of truth for which tenant a request is scoped to."** Today's answer depends on which of four React hooks the consumer asks (with 17 places reading the raw JWT claim and bypassing the resolved grant entirely). That is unshippable.

Sentinel makes the answer one sentence: "Every protected request passes through `sentinel.Middleware`; every frontend page reads from `useSentinel()`; both are pinned by `lint:sentinel-clamp-required` (Go) and `lint:no-direct-workspace-id` + `lint:no-old-context-imports` (TS). Cross-tenant data leaks are blocked by `e2e/sentinel_cross_tenant_isolation.spec.mjs`."

## Process — RED-GREEN-driven, hard-cut, zero tech debt

Every story in [`sentinel_backlog.md`](sentinel_backlog.md) follows this protocol:

1. **RED** — Write the failing test first. Run it. Observe the failure (compile error, assertion mismatch, build break). Capture the verbatim output to [`sentinel_tests_log.md`](sentinel_tests_log.md).
2. **GREEN** — Write the smallest implementation that turns the test green. Run it. Capture verbatim output.
3. **Log attempts.** If the implementation didn't go green first try, log every attempt: what was wrong, what was changed, until green.
4. **Commit.** Each story is one commit on `main`. The commit message references the story number.
5. **Strikethrough.** After the commit lands, the story's `<li>` in PLA062 (on Dev → Reporting) gets wrapped in `<s>...</s>` and a Change Log entry is prepended noting the completion date + commit SHA.

No story is "done" until: test GREEN + commit landed + PLA062 strikethrough applied.

### Hard rules

- **No compatibility shims.** When a story migrates a call site, the old import is deleted in the same commit. No `@deprecated` layers.
- **No tech debt accumulation.** Any defect discovered during a story that cannot be fixed in scope of that story is logged in [`sentinel_tech_debt.md`](sentinel_tech_debt.md) with severity + trigger. Target close-out state: zero entries.
- **The clamp is the gate.** Server-side. The frontend `sentinel_*` is convenience; the backend `sentinel.Middleware` is the authority. Trust-No-One: never trust the frontend's claim of `sentinel_tenant`.

## Requirements (procurement / SOC2 / defence / finance bar)

- **NIST 800-53 mod/high** — AC-3 (access enforcement), AC-4 (information flow enforcement), AC-6 (least privilege). Sentinel's backend clamp is the access-enforcement gate; the e2e cross-tenant spec is evidence.
- **NIST 800-63B AAL2/AAL3** — session re-binding on workspace switch. Sentinel's atomic `sentinel_switch_tenant` action satisfies this.
- **SOC 2 Type II CC6.1, CC6.6** — logical access controls + restriction of access to authorized data. The lint ratchets are the preventive control; the e2e spec is the detective control.
- **DoD CMMC L2/L3** — multi-tenant isolation evidence. Sentinel's audit narrative on Dev → Reporting → PLA062 is the procurement artefact.
- **JSP 440** — defence-grade compartmentation. The (deferred to v2) topology access islands story is the future affordance for compartmented programmes.
- **FFIEC 2021 / PCI-DSS 4.0** — data segregation across tenants. Same control set as above.

## Outputs

- `app/sentinel/` — frontend surface (provider, hook, types, API client, scope picker).
- `backend/internal/sentinel/` — backend middleware + ctx accessor + ProblemJSON error catalogue.
- `dev/scripts/lint_no_direct_workspace_id.py`, `lint_no_old_context_imports.py` — frontend ratchets.
- `backend/internal/lintchecks/sentinel_clamp_test.go` — backend ratchet.
- `e2e/sentinel_cross_tenant_isolation.spec.mjs` — cross-tenant proof.
- `e2e/sentinel_workspace_switch_atomicity.spec.mjs` — race-window proof.
- `e2e/sentinel_focus_clamp.spec.mjs` — focus-precedence proof.
- This documentation tree: `sentinel_docs.md` (this file), [`sentinel_backlog.md`](sentinel_backlog.md), [`sentinel_tests_log.md`](sentinel_tests_log.md), [`sentinel_tech_debt.md`](sentinel_tech_debt.md), [`sentinel_revision_history.md`](sentinel_revision_history.md).

## What replaces what

| Before | After |
|---|---|
| `app/contexts/AuthContext.tsx` | `app/sentinel/SentinelProvider.tsx` (identity slice) |
| `app/contexts/ScopeContext.tsx` | `app/sentinel/SentinelProvider.tsx` (scope slice) |
| `app/contexts/TenantContext.tsx` | `app/sentinel/SentinelProvider.tsx` (tenant slice) |
| `app/contexts/Sentinel.tsx` (old) | `app/sentinel/useSentinel.ts` |
| `app/contexts/scopeReloadRegistry.ts` | (deleted — race closed structurally) |
| `useAuth()` | `useSentinel()` (destructure `sentinel_user`, `sentinel_role`, `sentinel_can`) |
| `useScope()` | `useSentinel()` (destructure `sentinel_focus_node`, `sentinel_grants`) |
| `useTenant()` | `useSentinel()` (destructure `sentinel_tenant`) |
| `useHasPermission(code)` | `useSentinel().sentinel_can(code)` |
| `useActiveWorkspace()` | `useSentinel().sentinel_tenant` + `.sentinel_focus_node` |
| direct `user.workspace_id` read | `sentinel_tenant.id` |
| backend `auth.UserFromCtx(ctx)` in artefact-touching handlers | `sentinel.FromCtx(ctx)` |

## How to extend Sentinel

Two extension axes exist:

1. **New `sentinel_*` field on the state bag.** Add to `app/sentinel/types.ts`, update reducer in `SentinelProvider.tsx`, add a unit-test assertion, document in this file's § Synopsis. Must be derivable from existing inputs OR fetched via a defined `sentinel_api.ts` call.
2. **New ProblemJSON error code.** Add to `backend/internal/sentinel/errors.go` with the `/errors/sentinel/<slug>` type URL, document in this file, register in OpenAPI specs.

Anything else — new tenant-isolation feature, new permission gate, new compartmentation primitive — gets its own story and goes through the RED-GREEN protocol. No drive-bys.
