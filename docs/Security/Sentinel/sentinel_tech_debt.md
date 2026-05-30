# Sentinel — Tech-Debt Register (own register, separate from `docs/c_tech_debt.md`)

> **Purpose of this file:** Catch any defect / shortcut / temporary workaround discovered DURING the Sentinel build that cannot be fixed in scope of its own story. Severity + trigger + standard-ref per entry.
> **Target close-out state:** **zero entries.** Per user directive on PLA062: "This will not produce any tech debt at all." This file exists as a safety net, not a parking lot.
> **Why a separate file:** Sentinel is the procurement-grade tenant isolation surface. Any debt against it is a different shape from generic Vector tech debt — it has SOC2 / NIST / defence-finance implications and needs its own audit trail.

---

## Entry template

```markdown
### TD-SEN-<NN> — <one-line title>

**Severity.** S1 (must fix before close-out) | S2 (fix during v2 work) | S3 (nice-to-have)
**Trigger.** <the condition that promotes this from sleeping to active — e.g. "first cross-tenant audit", "next workspace-switch race report", "story X migration">
**Discovered by.** <story id that surfaced it>
**Standard-ref.** NIST 800-53 AC-3 | SOC 2 CC6.1 | CMMC L2 AC.L2-3.1.1 | … (per the requirements catalogue)
**Description.** <2–4 sentences — what's wrong, why it's debt vs immediate fix>
**Compensating control.** <what currently protects against the gap until paid down>
**Pay-down plan.** <story or PLA ref that will close it, or "open">
```

---

## Active entries

### TD-SENT-CLAMP-SQL — Subtree-aware SQL clamp on synchronous user reads (MOSTLY RESOLVED 2026-05-24)

**Severity.** S2 → S3 (most surfaces wired; one async-worker gap remains).
**Trigger.** First cross-tenant compromise audit, OR procurement evidence request asking for "show me the SQL that filters by subtree", OR fixture seed + Playwright RED→GREEN flip on S23.
**Discovered by.** S21 (carved out mid-build with user approval); paid down across S26 phase 1 + phase 2a.
**Standard-ref.** NIST 800-53 AC-4 (information flow enforcement) — handler-level workspace gate (`sentinel.WorkspaceIDFromCtx`) satisfies AC-3; AC-4's data-flow control is now layer-2-wired on the synchronous user-read surface.
**Resolution (synchronous reads).** S26 shipped `sentinel.SubtreeClause` + `sentinel.ApplyClampToIDs` in `backend/internal/sentinel/clamp_sql.go` (4 unit tests GREEN). Wired into:
- `artefactitems/service.go` — `ListWorkItems`, `ListFacets`, `SummariseWorkItems` (mandatory SQL clause splice); `getWorkItemImpl` (post-SELECT filter on the static SELECT). The legacy `?scope=` URL further-narrowing path now intersects with the Sentinel clamp via `ApplyClampToIDs` so a hostile caller can't widen scope by passing an ancestor node.
- `search/service.go` `Search` — mandatory clause splice on the full-text query, so search hits are bounded to the requesting user's subtree.

**Audit-survey findings (S26 phase 2 — what was checked).**
Five other packages were investigated for SQL artefact reads; none turned out to need wiring on the **synchronous-user-read** axis:
- `portfoliomodels/sql.go` — 5 `FROM artefacts` hits, all admin write paths (DELETE/UPDATE/COUNT/SEED for adoption + master-reset + dev tools). They legitimately operate workspace-wide; subtree-clamping them would break the admin tool.
- `flows/sql.go:324` `sqlCountArtefactsOnFlowState` — workspace-admin "remove flow state" impact preview. Admin needs the full count to make the delete decision; subtree-clamp inappropriate.
- `artefacttypes`, `artefactpriorities` — catalogue tables, no `topology_node_id` column. Workspace clamp from S05 is sufficient.
- `artefactitemsv2` — no `topology_node_id` references.
**Async-worker gap (carved out to TD-SENT-CLAMP-ASYNC).** Two artefact readers run from async / non-request paths and use `context.Background()`, so `sentinel.FromCtx` returns the zero clamp:
- `notifications/resolvers/artefactitems.go` — `@artefact/<uuid>` mention renderer.
- `searchworker/sql.go` — TSVECTOR + embedding indexing pipeline.
Both need the **recipient's** clamp (or the indexing-pass-time tenant), propagated separately from the request context. New TD entry below.
**Pay-down plan (this entry).** None — closed for the synchronous-read surface.

**Hardening 2026-05-30 — empty-subtree fail-CLOSED (`SubtreeResolved` flag).** Audit of the clamp helpers found an asymmetric fail-OPEN: every call site keyed the clamp off `len(c.AllowedSubtreeIDs) > 0`, so a *resolved-but-empty* subtree (a caller with a valid clamp that reaches zero nodes) emitted **no** WHERE clause and fell through to a workspace-wide read — fail-open, the wrong default for a Trust-No-One / server-is-the-gate surface (NIST AC-4, SOC 2 CC6.1). Root cause: the empty slice was overloaded across three distinct states — (1) no middleware in the chain, (3) resolved-to-zero-nodes, (4) deliberate `WithBypassedSubtreeClamp` post-write read — and only state 3 should fail closed. Fix: added `Clamp.SubtreeResolved bool` (`backend/internal/sentinel/types.go`), set `true` only on the middleware success path (`middleware.go` step 7) and `false` on bypass (`ctx.go` `WithBypassedSubtreeClamp`). Rewrote both helpers (`clamp_sql.go`) to four-state logic: `!SubtreeResolved` → no-op (states 1+4); `SubtreeResolved && len==0` → `AND FALSE` / empty ID set (state 3, fail-closed); else → `= ANY(...)` / intersection (state 2). The single-row read `getWorkItemImpl` (`artefactitems/service.go`) was the fifth site — rewrote its post-SELECT membership check off `SubtreeResolved` so state 3 → `ErrNotFound` and the bypass stays a no-op. New unit tests in `clamp_sql_test.go` pin states 3 + 4 for both helpers; `go build`/`vet`/`test ./internal/sentinel/...` + `./internal/artefactitems/...` GREEN. **Provably safe today** — `sentinel.Middleware` rejects every zero-ID path before the clamp is built (`ErrFocusNotInTenant`/`ErrFocusNoAccess` → 403) and `ResolveSubtree` always seeds the focus node, so state 3 is currently unreachable; this is defence-in-depth so the contract holds by construction if a future middleware change ever lets an empty resolution through. No residual debt.

### TD-SENT-CLAMP-ASYNC — Subtree clamp on async worker / mention-render paths

**Severity.** S3 (narrow surface, narrow exposure, narrow audience).
**Trigger.** A user receives a notification rendering a mention to an artefact OUTSIDE their reachable subtree (e.g. cross-team @mention that the receiver doesn't have grants on), OR procurement evidence request asking how async render-time + indexer-time reads honour the clamp.
**Discovered by.** S26 phase 2 audit (surveyed all `FROM artefacts` readers).
**Standard-ref.** NIST 800-53 AC-4 (information flow enforcement) — async render paths are technically outside the request lifecycle, but the rendered output flows back to a user, so AC-4 still applies.
**Description.** Two `artefacts` table readers run from non-request contexts and use `context.Background()`:
1. `backend/internal/notifications/resolvers/artefactitems.go` — the `@artefact/<uuid>` mention renderer. Reads `sqlSelectArtefactLabel` to render mentions in notification text. Tenant-scoped (`subscription_id = $2`), but no subtree clamp.
2. `backend/internal/searchworker/sql.go` — the TSVECTOR + embedding indexing pipeline. Reads every live artefact in a tenant to build the search index. Naturally runs unclamped because the index serves all users in the tenant.
The notifications path is the user-facing one: if a user is `@`-mentioned in a comment that references an artefact outside their grants, the mention renderer surfaces the label ("EPIC-42 / Title") into the user's inbox even though they couldn't open the artefact directly. Information leak via the mention pipeline.
The indexer is admin-side: it builds the index from the full set; the per-user clamp happens at READ time (the `Search` clamp wired by S26 phase 2a). Indexer reading unclamped is correct.
**Compensating control.**
1. `sqlSelectArtefactLabel` is tenant-clamped (`subscription_id = $2`) so cross-tenant labels can't leak. Only same-tenant cross-subtree leakage is possible.
2. The mention text itself ("EPIC-42 / Title") is short enough that the leak surface is the title field of a row the recipient can't open. Most operational content (description, comments, fields) is NOT exposed.
3. Notification recipients are themselves grant-scoped to their tenant — the bug is intra-tenant cross-subtree, not cross-tenant.
**Pay-down plan.**
1. Pipeline change: when a notification is rendered, look up the recipient's clamp via the same `PoolResolver.ResolveSubtree` the middleware uses. Pass `recipientClamp.AllowedSubtreeIDs` to the mention resolver.
2. Or simpler: drop the mention rendering when the recipient lacks a grant on the referenced node — emit the bare "@artefact/UUID" string. Procurement-defensible, single-place fix, no new infrastructure.
Open — separate initiative, not numbered under PLA062.

---

### TD-SENT-AUTH-EXTRACT — AuthContext.tsx still owns the credential flow

**Severity.** S2 (cosmetic / migration debt, not a security gap).
**Trigger.** Any future change to the credential flow (e.g. WebAuthn migration, OIDC SSO), OR procurement narrative review where "the auth context still exists" prompts a question.
**Discovered by.** S22 (carved out at close-out with user approval).
**Standard-ref.** None directly — this is migration hygiene, not a control gap. Sentinel still owns the authoritative identity state (`sentinel_user`); AuthContext is the credential-flow vestige (login, mfaLogin, logout, refresh, switchWorkspace, DPoP keypair lifecycle, hard-logout sessionStorage banner, session_alive cookie).
**Description.** 9 files still import from `app/contexts/AuthContext.tsx` — the route-group layouts (root, (user), (overlay)), the credential pages (login, change-password), the legacy nav rails (rail_1, AccountFlyout), and two contexts that depend on `useAuth().user` readiness (NavPrefsContext, PageAccessContext). All are listed in `dev/registries/no_old_context_imports_exempt.json`. The clean fix is a multi-step refactor: lift the credential flow into a framework-agnostic `app/lib/auth.ts` (~250 LOC), migrate the 9 consumers to import from there + read user state from Sentinel, then delete AuthContext.
**Compensating control.** The lint exemption registry IS the audit trail — every remaining consumer is documented with its specific reason. `lint:no-old-context-imports` still hard-fails on any NEW import from AuthContext outside this allowlist. The credential flow itself is unchanged from pre-PLA062 (no security regression).
**Pay-down plan.** Open — separate initiative, not numbered under PLA062.

---

---

## Resolved entries

### TD-SEN-03 — Workspace-settings writer surface absorbed by Sentinel (RESOLVED mid-S14)

**Severity at log time.** S2 (workflow gap — blocked workspace-details migration).
**Resolution date.** 2026-05-24.
**Resolution.** Per user direction (2026-05-24 scope-expansion), Sentinel absorbed the workspace-settings writer surface: new `sentinel_settings: SentinelWorkspaceSettings | null` state slice + `sentinel_set_settings(s)` action that does optimistic update + server PUT + post-PUT reconciliation in one call. Test case 11 in `sentinel_provider.test.tsx` pins the contract. `workspace-admin/workspace-details/page.tsx` migrated mid-S14 — replaced `useTenant().setSettings` with `useSentinel().sentinel_set_settings`. The remaining concern (Sentinel scope creep beyond identity) is noted in the revision-history entry for future architects: if Sentinel grows beyond ~500 LOC of state, revisit splitting `WorkspaceSettingsContext` out as a peer.
**Commit.** (mid-S14, lands with the S14 cluster commit)

### TD-SEN-02 — `sentinel_switch_workspace` action shipped (RESOLVED mid-S14)

**Severity at log time.** S2 (workflow gap — blocked overlay/topology migration).
**Resolution date.** 2026-05-24.
**Resolution.** Shipped `sentinel_switch_workspace(workspaceId): Promise<void>` action paired with the `postSwitchWorkspace` HTTP wrapper and `/sentinel/switch-workspace` backend endpoint contract. Test case 10 in `sentinel_provider.test.tsx` pins atomicity (tenant_id unchanged, workspace_id + grants refresh in one dispatch). Pay-down happened earlier than planned (mid-S14 rather than pre-S16) because S14 was already paused for the TD-SEN-03 absorption — bundling kept the Sentinel scope-expansion to one revision-history entry.
**Commit.** (mid-S14, lands with the S14 cluster commit)

### TD-SEN-01 — Production Resolver implementation (RESOLVED at S05.3)

**Severity at log time.** S3 (planned deferral from S04 to S05).
**Resolution date.** 2026-05-24.
**Resolution.** Shipped `backend/internal/sentinel/sql.go` (recursive-CTE SQL templates for descendants + ancestors + tenant root + first-live workspace + has-active-role + user default focus) and `backend/internal/sentinel/resolver.go` (`PoolResolver` struct implementing the full `Resolver` interface against `vaPool` + `mvPool`). The middleware mounted in `cmd/server/main.go` at S05.4 uses `sentinel.NewPoolResolver(vaPool, pool)`. One small implementation detail deferred: `DefaultFocus` returns `(nil, nil)` until S06 ships the `users.default_focus_node_id` column — the SQL is prepared in `sqlUserDefaultFocus` constant but commented out in `PoolResolver.DefaultFocus` body; S06's one-line change is to uncomment.
**Commit.** (in S05 commit)

### TD-SEN-04 — PUT /sentinel/focus handler (RESOLVED as PLA062 follow-up)

**Severity at log time.** S2 (write-side counterpart to a shipped read-side resolver — `app/sentinel/sentinel_api.ts:166` `putFocus()` was already calling the route; the handler 404'd silently, so a user's choice of home topology node never survived sign-out).
**Resolution date.** 2026-05-24.
**Standard-ref.** NIST 800-53 AC-3 — handler re-validates the actor's grant on the node before storing it, so a user cannot persist a default pointing at a node they have no access to.
**Resolution.** Shipped `backend/internal/sentinel/handler.go` (`Handler.PutFocus`), two new SQL constants in `sql.go` (`sqlUpdateUserDefaultFocus` + `sqlUserHasGrantOnNodeOrAncestor`), and two new `Resolver` interface methods (`GrantOnNode` + `SetUserDefaultFocus`) wired against the existing `PoolResolver`. Mounted at `PUT /_site/sentinel/focus` under a new `/sentinel` route group with `RequireAuth + RequireFreshPassword + httprate + userWriteLimiter + sentinelMW`. Validation rules: (a) authenticated actor required (401 on missing), (b) when `focus_node_id` is non-null, actor must hold an active grant on the node OR any ancestor in their tenant — same descend-inheritance predicate `topology.sqlAncestorsHasGrantOnTargetOrAncestor` already uses for PLA-0043 scope reads — 403 `/errors/sentinel/focus-no-access` otherwise, (c) when `focus_node_id` is null, column clears unconditionally. 6 unit tests GREEN in `handler_test.go` (4 contract cases from the brief + 2 bonus contract pins for unauth + malformed-JSON paths); all 9 existing middleware tests still pass. Closes the persistence gap so `sentinel_set_focus(nodeId)` is now end-to-end durable.
**Commit.** (this commit)

---

## Notes

- If this file accumulates entries during the build, that is a **process failure**, not a success. Each entry represents a place where the RED-GREEN protocol was relaxed or where a story shipped with a known compromise.
- The story that surfaces a debt entry should NOT be marked done on `sentinel_backlog.md` until either (a) the debt is fixed in scope, or (b) the debt is logged here with a pay-down plan AND the user has explicitly approved the deferral.
- Any S1 entry at close-out blocks PLA062 from being marked done.
