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

### 2026-05-24 — Mid-build pivot: backend approach changes from "facade" to "Replace" (own substrate)

**PLA / story.** PLA062 / pre-S03 (between S02 commit `332bc138` and S03 start).
**Decision.** Investigation before writing S03 revealed that `backend/internal/topology/` already ships a working clamp substrate from PLA-0006 + PLA-0043: `topology.ClampMiddleware` (per-grant request clamp), `topology.WorkspaceClampMiddleware` (workspace narrowing), `topology.Clamp` struct + `withClamp` / `ClampFromCtx` helpers, `DescendantNodeIDs` / `AncestorNodeIDs` resolvers, and a `tenantRootID` lookup. Roughly 600 LOC of tested, in-production code.
Original PLA062 implicitly assumed Sentinel was greenfield. With the existing substrate visible, we picked **full Replace**: Sentinel owns the substrate end-to-end. The topology clamp middlewares get deprecated and deleted by a new closing story (S25). The handler-facing surface is exclusively `sentinel.*`; no handler ever imports `topology.ClampFromCtx`.
**Alternatives considered.**
- **Reuse** — sentinel as thin facade calling existing `topology.ClampMiddleware` + `Subtree`/`DescendantNodeIDs`/`AncestorNodeIDs`. Lightest effort (~150 LOC for S04), zero duplication. Rejected because: handlers would still need to know two namespaces during the transition, and the audit story is muddier ("clamp is in topology AND sentinel; sentinel mostly delegates" is harder to defend than "clamp is sentinel, full stop").
- **Hybrid** — sentinel owns the public middleware face, topology's middleware gets renamed lowercase and stays as the SQL-level workhorse. Achieves single-public-namespace at lower duplication cost (~300 LOC for S04, no S25 needed). Rejected by explicit user direction (2026-05-24) — the procurement narrative is stronger with full Replace, even at 2× effort.
**Cost of decision.** S04 grows from ~150 LOC to ~600 LOC (duplicate the substrate). S05 grows from "mount sentinel.Middleware" to "mount sentinel.Middleware AND tear out 6+ topology middleware mounts in `cmd/server/main.go`". Adds a new closing story S25 (delete `topology.ClampMiddleware` + `topology.WorkspaceClampMiddleware` once S21 proves Sentinel is the sole gate end-to-end). Estimated +4-6 hours over original.
**Standard-ref.** Same as PLA062 entry below — NIST 800-53 AC-3/AC-4, SOC 2 CC6.1/CC6.6, CMMC L2 AC.L2-3.1.1. The choice does not change the controls; it changes the surface that implements them.
**Commit(s).** (none yet — recorded before S03 starts.)
**Touched files / surfaces (projected).**
- `backend/internal/sentinel/` — full substrate (`types.go`, `middleware.go`, `workspace_middleware.go`, `ctx.go`, `errors.go`, `resolver.go`, `sql.go`, plus test files mirroring topology's coverage)
- `backend/cmd/server/main.go` — `topology.*Middleware` mounts replaced by `sentinel.Middleware`
- `backend/internal/topology/` — middleware files deleted at S25 (substrate-resolver functions like `DescendantNodeIDs` / `AncestorNodeIDs` may stay or move into sentinel/, TBD at S25)
- `docs/Security/Sentinel/sentinel_backlog.md` — S25 added; S03/S04/S05 AC expanded to reflect substrate ownership

---

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
