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

### TD-SEN-02 — `sentinel_switch_workspace` action missing (workspace-within-tenant switch)

**Severity.** S2 (workflow gap — blocks overlay/topology migration).
**Trigger.** S16 (remaining `(user)/*` pages migration) — at that point the overlay/topology page is the last consumer of the legacy `AuthContext.switchWorkspace`, and Sentinel needs a peer action so S22 can delete AuthContext.
**Discovered by.** S13 (`/topology` migration spike).
**Standard-ref.** NIST 800-53 AC-3 — same control axis as `sentinel_switch_tenant`, just at a finer grain.
**Description.** `sentinel_switch_tenant(tenantId)` swaps the whole identity (subscription_id, role, grants). The overlay/topology page needs the **finer** "switch workspace within current tenant" action — workspace_id changes, subscription_id stays. AuthContext's existing `switchWorkspace(workspaceID)` does this today via POST `/_site/auth/switch-workspace`. Sentinel needs a peer action `sentinel_switch_workspace(workspaceID)` plus backend `/sentinel/switch-workspace` (or reuse `/_site/auth/switch-workspace` through `sentinel_api`).
**Compensating control.** Until paid down, S13 ships only the two `workspace-admin/topology*` page migrations (which don't need switchWorkspace). The overlay/topology page stays on `useAuth().switchWorkspace` and migrates in S16 once this debt is paid.
**Pay-down plan.** Before S16: extend `SentinelState` with `sentinel_switch_workspace(workspaceID): Promise<void>`, implement via `sentinel_api.postSwitchWorkspace`, add a unit-test case (10) to `sentinel_provider.test.tsx` covering the atomicity contract (same as tenant switch but workspace-scoped). When S16 lands the overlay page migration, this entry moves to Resolved.

---

## Resolved entries

### TD-SEN-01 — Production Resolver implementation (RESOLVED at S05.3)

**Severity at log time.** S3 (planned deferral from S04 to S05).
**Resolution date.** 2026-05-24.
**Resolution.** Shipped `backend/internal/sentinel/sql.go` (recursive-CTE SQL templates for descendants + ancestors + tenant root + first-live workspace + has-active-role + user default focus) and `backend/internal/sentinel/resolver.go` (`PoolResolver` struct implementing the full `Resolver` interface against `vaPool` + `mvPool`). The middleware mounted in `cmd/server/main.go` at S05.4 uses `sentinel.NewPoolResolver(vaPool, pool)`. One small implementation detail deferred: `DefaultFocus` returns `(nil, nil)` until S06 ships the `users.default_focus_node_id` column — the SQL is prepared in `sqlUserDefaultFocus` constant but commented out in `PoolResolver.DefaultFocus` body; S06's one-line change is to uncomment.
**Commit.** (in S05 commit)

---

## Notes

- If this file accumulates entries during the build, that is a **process failure**, not a success. Each entry represents a place where the RED-GREEN protocol was relaxed or where a story shipped with a known compromise.
- The story that surfaces a debt entry should NOT be marked done on `sentinel_backlog.md` until either (a) the debt is fixed in scope, or (b) the debt is logged here with a pay-down plan AND the user has explicitly approved the deferral.
- Any S1 entry at close-out blocks PLA062 from being marked done.
