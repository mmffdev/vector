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

### TD-SEN-01 — Production Resolver implementation deferred from S04 to S05

**Severity.** S3 (planned deferral, not surprise debt — close before S05 ships).
**Trigger.** S05 (mount middleware + tear out topology.Clamp) — at that point the middleware needs a real DB-backed Resolver, not just an interface.
**Discovered by.** S04 GREEN attempt.
**Standard-ref.** NIST 800-53 AC-3 — same control set; this is an implementation deferral, not a control gap (no production traffic touches the middleware yet).
**Description.** S04 originally specified `sentinel/sql.go` + `sentinel/resolver.go` carrying the recursive-CTE SQL for descendants + ancestors. The test surface was satisfied by the Resolver INTERFACE plus a test stub. To keep S04 sized as "GREEN the RED test", the production resolver (vaPool-backed, reading `artefacts_topology`) is pushed into S05 where it will be wired up at the same time the middleware mounts on real routes. The interface + middleware code + error handling are all final-form already; only the SQL-backed resolver implementation is the gap.
**Compensating control.** Middleware will not be mounted in `cmd/server/main.go` until S05, so no production request hits the unimplemented resolver. Test coverage is unchanged: tests use the in-test stub; the production code path is unreachable.
**Pay-down plan.** S05 ships `sentinel/resolver.go` (Resolver impl wrapping `vaPool`) + `sentinel/sql.go` (recursive-CTE SQL mirroring topology's `sqlDescendantNodeIDsTemplate` + `sqlAncestorNodeIDsTemplate` patterns). S05's AC will be expanded to cover this. When S05 lands, this TD-SEN-01 entry moves to "Resolved entries" below.

---

## Resolved entries

(none — target state)

---

## Notes

- If this file accumulates entries during the build, that is a **process failure**, not a success. Each entry represents a place where the RED-GREEN protocol was relaxed or where a story shipped with a known compromise.
- The story that surfaces a debt entry should NOT be marked done on `sentinel_backlog.md` until either (a) the debt is fixed in scope, or (b) the debt is logged here with a pay-down plan AND the user has explicitly approved the deferral.
- Any S1 entry at close-out blocks PLA062 from being marked done.
