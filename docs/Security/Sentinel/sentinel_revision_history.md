# Sentinel — Revision History (architectural decisions)

> **Purpose of this file:** Dated record of every architectural decision in the Sentinel system. Procurement / SOC2 audit narrative: "Show me when each control was introduced and why."
> **Granularity:** One entry per PLA, plus one entry per significant in-flight decision (e.g. when a story surfaces a design pivot).

---

## Entry template

```markdown
### YYYY-MM-DD — <one-line title>

**PLA / story.** <PLA### or S<NN>>
**Decision.** <what was decided, in 2–4 sentences>
**Alternatives considered.** <what was rejected and why>
**Standard-ref.** <NIST / SOC 2 / CMMC clause if applicable>
**Commit(s).** <SHA short(s)>
**Touched files / surfaces.** <bullet list>
```

---

## History (newest first)

### 2026-05-24 — Doc tree scaffolded; PLA062 starts

**PLA / story.** PLA062 / S01.
**Decision.** Sentinel becomes the single source of truth for identity / tenant / scope. Hard cut over four React contexts (`AuthContext`, `ScopeContext`, `TenantContext`, original read-only `Sentinel`, plus `scopeReloadRegistry`). RED-GREEN test pyramid (unit + page-integration + cross-tenant e2e) drives every story; no shims, no compat layers.
**Alternatives considered.**
- Soft cut with `@deprecated` shims for one release cycle — rejected: creates exactly the kind of lingering shim the brief forbids.
- Keep AuthContext separate, only collapse Scope/Tenant — rejected: leaves the 17 direct `user.workspace_id` reads behind; doesn't close the procurement-narrative gap.
- Page-level integration tests only (no unit / no e2e) — rejected: misses the workspace-switch race (state-machine concern) and doesn't satisfy SOC2 cross-tenant evidence requirement.
**Standard-ref.** NIST 800-53 AC-3, AC-4; SOC 2 Type II CC6.1, CC6.6; DoD CMMC L2 AC.L2-3.1.1; NIST 800-63B AAL2 session re-binding.
**Commit(s).** (this commit)
**Touched files / surfaces.**
- `docs/Security/Sentinel/sentinel_docs.md` (new)
- `docs/Security/Sentinel/sentinel_backlog.md` (new)
- `docs/Security/Sentinel/sentinel_tests_log.md` (new)
- `docs/Security/Sentinel/sentinel_tech_debt.md` (new)
- `docs/Security/Sentinel/sentinel_revision_history.md` (new — this file)
- `.claude/CLAUDE.md` (pointer added under Working-practices index)

---
