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

(none — target state restored at S05 close-out)

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
