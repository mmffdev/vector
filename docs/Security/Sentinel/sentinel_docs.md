# Sentinel — System Documentation

> **Status:** **Closed 2026-05-24** — PLA062 frontend + backend lint contract delivered (S01–S24). Two follow-ups carved out and tracked in [`sentinel_tech_debt.md`](sentinel_tech_debt.md): **S26** (subtree-aware SQL clamp + per-package integration tests) and **TD-SENT-AUTH-EXTRACT** (credential-flow lift from `AuthContext.tsx` into `app/lib/auth.ts`). S25 (delete `topology.ClampMiddleware`) is the last numbered story remaining.
> **Spec source:** [PLA062 on Dev → Reporting → Plan tab](/dev/reporting?type=plan).
> **Purpose of this file:** The synopsis, the I/O, the reason, the process, the requirements, the outputs. Read this first if you're new to Sentinel.

---

## Synopsis

Sentinel is the **single source of truth** for who-the-user-is, which-tenant-they're-in, and which-topology-node-they're-focused-on. It collapses what used to be four overlapping React contexts (`AuthContext`, `ScopeContext`, `TenantContext`, the original read-only `Sentinel`, plus the `scopeReloadRegistry` escape hatch — 1,039 LOC + ~190 consumer call sites) into one surface:

- **Frontend:** `app/sentinel/` — one provider (`SentinelProvider`), one hook (`useSentinel()`), one namespaced state bag (`sentinel_user`, `sentinel_tenant`, `sentinel_role`, `sentinel_grants`, `sentinel_focus_node`, `sentinel_scope_up`, `sentinel_scope_down`, `sentinel_workspace_in_sync`, …) and action methods (`sentinel_switch_tenant`, `sentinel_switch_workspace`, `sentinel_set_focus`, `sentinel_set_default_focus`, `sentinel_set_home_follow_mode`, `sentinel_set_settings`, `sentinel_can`, `sentinel_reload`).
- **Backend:** `backend/internal/sentinel/` — a Go middleware mounted in front of every `/_site/admin/*` and `/samantha/v2/*` route. Reads the JWT, resolves the workspace (claim → first-live fallback, gated by `HasActiveRole`), resolves the focus node, calls the recursive-CTE subtree resolver, attaches a `sentinel.Clamp` struct (carrying `WorkspaceID`, `FocusNodeID`, `AllowedSubtreeIDs`) to the request context. Downstream handlers MUST read the clamp via `sentinel.FromCtx(ctx)` / `sentinel.WorkspaceIDFromCtx(ctx)`; bypassing it is lint-banned. The same package exposes the writer surface for per-user Sentinel preferences (`PUT /sentinel/focus`); the toggle for Pinned/Follow lives on `PUT /me/home-location-follow-mode`. As of 2026-05-24 `sentinel_set_focus(nodeId)` and `sentinel_set_default_focus(nodeId)` are end-to-end durable (see `sentinel_revision_history.md`).
- **Tests:** three RED-GREEN tiers — `sentinel.unit` (23 cases in `app/sentinel/__tests__/sentinel_provider.test.tsx` + 6 in `backend/internal/sentinel/handler_test.go` + 9 in `middleware_test.go`), `sentinel.page.<route>`, `sentinel.e2e` (`e2e/sentinel_cross_tenant_isolation.spec.mjs`) — runnable all-at-once or sliced by tag.

---

## I/O

Sentinel's contract with the rest of the Vector site, expressed as inputs (what it consumes) and outputs (what the site reads from it).

### Inputs

| Source | Field / endpoint | Purpose |
|---|---|---|
| `AuthContext.user` (FE) | `id` transition `null → present` | Trigger Sentinel re-boot on login; clear stale `url_focus` + `focus_override` so saved `users.default_focus_node_id` wins. |
| `Cookie: jwt` (BE, every protected request) | `user_id`, `subscription_id` (tenant), `workspace_id` claim | Identity + tenant + JWT-asserted workspace narrowing. |
| `URL ?meg=<node_id>` | Shareable scope-identity param (PLA-0053, canonical name) | One-shot session override of the focus node — read once on mount via `parseMegFromURL` (allow-listed in `app/lib/shareableParams.ts`); cleared on login transition. |
| `GET /sentinel/boot` (or bridge: `/auth/me` + `/topology/grants/me` when boot is 404) | `SentinelBootPayload` — `user`, `tenant`, `grants[]`, `tenant_root`, optional `settings` | Hydrates the full Sentinel state bag in one round trip (or two when falling back to the bridge). |
| `users.default_focus_node_id` (mig 243) | Persistent home topology node | Sole source of truth for the home location. Loaded into `sentinel_user.default_focus_node_id` on every boot; resolveFocusNode precedence is `focus_override → url_focus → user.default_focus_node_id → tenant_root`. |
| `users.home_location_follow_mode` (mig 244, default FALSE = Pinned) | Boolean | Gates whether `sentinel_set_focus` (rail clicks) also writes through to `default_focus_node_id`. |
| `users_roles_topology_nodes` + `topology_nodes` (recursive CTE) | Grants on nodes + descend-inheritance | Backend `Resolver.GrantOnNode` / `ResolveSubtree`; gates the `PUT /sentinel/focus` write path and produces `AllowedSubtreeIDs` for the request clamp. |
| `users_roles_workspaces` | Active role on workspace | Backend `HasActiveRole` forgery check — rejects requests where the JWT claims a workspace the user has no live role on. |

### Outputs

| Surface | Shape | Consumers |
|---|---|---|
| **`useSentinel()`** (FE hook) | `SentinelState` — see `app/sentinel/types.ts` | Every Vector page; replaces `useAuth` (for identity), `useScope`, `useTenant`, `useActiveWorkspace`, `useHasPermission`. |
| `sentinel_user` | `SentinelUser` ‑ `id`, `email`, `tenant_id`, `role`, `role_id`, `permissions[]`, `workspace_id`, `default_focus_node_id`, `home_location_follow_mode`, `mfa_enrolled`, `force_password_change` | Identity gating, profile pages (`/user/account-settings` reads via `useAuth` deliberately — see § Sentinel vs AuthContext for identity gating). |
| `sentinel_tenant` | `{ id, name }` | Tenant headers, switcher UI. |
| `sentinel_grants` | `ReadonlyArray<SentinelGrant>` | Scope rail, `HomeLocationSection` dropdown, `<ArtefactTree>`, `<ResourceTree>` grant-filtered renders. |
| `sentinel_focus_node` | `string \| null` (resolved from `focus_override → url_focus → user.default_focus_node_id → tenant_root`) | The "current scope" pin every artefact list reads. |
| `sentinel_scope_direction` | `"ascend" \| "descend"` | Tree-panel toggle. |
| `sentinel_settings` | `SentinelWorkspaceSettings` (theme, tenant_name, forward-compat) | Workspace-admin → workspace-details, theme bootstrap. |
| `sentinel_workspace_in_sync` | `boolean` (derived) | Loading-gate predicate that closes the workspace-switch race. |
| `sentinel_loading` | `boolean` | Boot-in-flight; pages should defer artefact reads until false. |
| `sentinel_can(code)` | `boolean` | Permission gating (replaces `useHasPermission`). |
| **Action methods** | (see § Synopsis bullet) | All state mutations. The provider owns the atomic reducer dispatch; consumers never mutate locally. |
| **`URL ?meg=<node_id>`** | Written on every `sentinel_set_focus`, on boot, on workspace switch | Sharable scope identity. Cleared on login transition so saved home wins. |
| **`sentinel.FromCtx(ctx)`** (BE) | `*Clamp` — `WorkspaceID`, `FocusNodeID`, `AllowedSubtreeIDs`, `TenantID` | Every artefact-touching handler in `backend/internal/{artefactitems,artefactpriorities,artefacttypes,portfoliomodels,flows,workitems,risks,…}/`. Bypass is lint-banned by `backend/internal/lintchecks/sentinel_clamp_test.go`. |
| **`sentinel.WorkspaceIDFromCtx(ctx)`** (BE) | `string` | Drop-in facade for handlers that need only the workspace id. |
| **`PUT /sentinel/focus`** | `{ focus_node_id: <uuid>\|null } → 204` (`401`/`400`/`403` problem+json on error) | Frontend `putFocus` helper; called by `sentinel_set_focus` (only when in Follow mode) and `sentinel_set_default_focus` (always). Server re-validates grant via `GrantOnNode` (recursive-CTE descend-inheritance). |
| **`PUT /me/home-location-follow-mode`** | `{ follow: <bool> } → 204` | `sentinel_set_home_follow_mode` toggle on `/user/account-settings`. |
| **`POST /sentinel/switch-tenant`** | `{ tenant_id } → SentinelBootPayload` | `sentinel_switch_tenant`; re-mints JWT for new tenant, returns the full boot payload (atomic reducer apply). |
| **`POST /sentinel/switch-workspace`** | `{ workspace_id } → SentinelBootPayload` | `sentinel_switch_workspace`; re-mints JWT with new `workspace_id` claim within current tenant. |
| **`PUT /sentinel/settings`** | `SentinelWorkspaceSettings → SentinelWorkspaceSettings` | `sentinel_set_settings`; persists workspace-level prefs. |
| **`sentinel_api_call(input, init)`** (FE) | Response | Generic site-API wrapper with auto-reboot on terminal 401 — consumers needing arbitrary endpoints with the 401 hook should use this rather than raw `fetch`. |

### Sentinel vs AuthContext (identity gating)

`/user/account-settings` deliberately reads identity from `useAuth()` rather than `useSentinel()`. Reason: the page is per-user profile, not tenant/workspace-scoped — if Sentinel boot fails (idle session, tenant-resolution problem, workspace-clamp gap), the user is still authenticated and the page must render so they can sign out / fix their account. Sentinel is the right source for any *scoped* read; `useAuth` is correct only for credential-flow identity gating on user-account-management pages. All other pages must use `useSentinel()`.

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

- `app/sentinel/` — frontend surface (provider, hook, types, API client, scope picker, login-transition reboot effect).
- `backend/internal/sentinel/` — backend middleware + ctx accessor + Resolver interface + `Handler.PutFocus` + ProblemJSON error catalogue + recursive-CTE subtree SQL.
- `backend/internal/users/prefs.go` — `Handler.SetHomeLocationFollowMode` (PUT /me/home-location-follow-mode), the per-user toggle for Pinned/Follow mode.
- `db/mmff_vector/schema/243_users_default_focus_node_id.sql` + `244_users_home_location_follow_mode.sql` — persistent home-location substrate columns.
- `app/components/HomeLocationSection.tsx` — UI for the Home Location dropdown + Pinned/Follow toggle on `/user/account-settings`.
- `dev/scripts/lint_no_direct_workspace_id.py`, `lint_no_old_context_imports.py` — frontend ratchets.
- `backend/internal/lintchecks/sentinel_clamp_test.go` — backend ratchet.
- `e2e/sentinel_cross_tenant_isolation.spec.mjs` — cross-tenant proof (RED at S23 close; GREEN gated on two-tenant fixture seed + S26 SQL clamp). The original brief mentioned two sibling specs (`sentinel_workspace_switch_atomicity.spec.mjs`, `sentinel_focus_clamp.spec.mjs`); both their behavioural contracts are covered by the `sentinel.unit` Cases 2 + 4a/b/c + 10 in `app/sentinel/__tests__/sentinel_provider.test.tsx` (which exercise the same atomicity + precedence properties without needing a browser session), so neither e2e spec was added separately.
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
| `useActiveWorkspace()` | `useSentinel().sentinel_user?.workspace_id` (hook deleted at S18) |
| direct `user.workspace_id` read | `sentinel_user.workspace_id` |
| `?focus=` URL param (Sentinel S08 era) | `?meg=` URL param (PLA-0053 canonical; renamed in `dca96bac`) |
| backend `auth.UserFromCtx(ctx)` in artefact-touching handlers | `sentinel.FromCtx(ctx)` / `sentinel.WorkspaceIDFromCtx(ctx)` |

## How to extend Sentinel

Two extension axes exist:

1. **New `sentinel_*` field on the state bag.** Add to `app/sentinel/types.ts`, update reducer in `SentinelProvider.tsx`, add a unit-test assertion, document in this file's § Synopsis. Must be derivable from existing inputs OR fetched via a defined `sentinel_api.ts` call.
2. **New ProblemJSON error code.** Add to `backend/internal/sentinel/errors.go` with the `/errors/sentinel/<slug>` type URL, document in this file, register in OpenAPI specs.

Anything else — new tenant-isolation feature, new permission gate, new compartmentation primitive — gets its own story and goes through the RED-GREEN protocol. No drive-bys.
