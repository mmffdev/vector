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

(none — target state)

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

---

## Notes

- If this file accumulates entries during the build, that is a **process failure**, not a success. Each entry represents a place where the RED-GREEN protocol was relaxed or where a story shipped with a known compromise.
- The story that surfaces a debt entry should NOT be marked done on `sentinel_backlog.md` until either (a) the debt is fixed in scope, or (b) the debt is logged here with a pay-down plan AND the user has explicitly approved the deferral.
- Any S1 entry at close-out blocks PLA062 from being marked done.
