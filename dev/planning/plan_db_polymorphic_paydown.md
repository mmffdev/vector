# Plan: Polymorphic FK pay-down (TD-001)

> **Status:** ready to execute. Pay-down for register entry [TD-001](../../docs/c_tech_debt.md#register).
> **Scope:** the four polymorphic relationships in `mmff_vector` only — `entity_stakeholders`, `item_type_states`, `item_state_history`, `page_entity_refs`. Broader DB hardening lives in [plan_db_enterprise_hardening.md](./plan_db_enterprise_hardening.md) (this plan ≈ Stage 8 of that one, executed early because the trigger conditions are imminent).
> **Authors:** Claude + user, 2026-04-23.

## Why now (not later)

The original tech-debt assessment said "wait for second writer or first orphan incident." The user has decided to **pay it down before it grows** — the rationale being that:

1. `bookmarks.go` is one workspace/portfolio/product archive handler away from silently producing orphans in production.
2. Three more relationships (`entity_stakeholders`, `item_type_states`, eventually `item_state_history`) will land writers within the next phases. Each one written without the discipline below is debt with compound interest.
3. The cap (doc + canary) only catches orphans **after** they exist. The pay-down moves enforcement to the moment of write.

## Strategy: cap → enforce → migrate

Three layers, smallest cost first. We do not need to migrate all four to per-kind tables to be safe — most of the safety comes from the enforcement layer.

| Layer | What it buys | Cost |
|---|---|---|
| **A. Cap** (already done) | Detection: orphans become visible the moment they appear. | Hours. Done. |
| **B. Enforce** | Prevention at write: dispatch trigger + cleanup registry function + Go service layer make it impossible to insert an orphan or to archive a parent without cleaning children. | ~2 days. |
| **C. Migrate** | Structural: swap polymorphic for per-kind link tables on the relationships that justify it. Real Postgres FKs, real `ON DELETE CASCADE`, no app-enforced RI for that relationship. | ~3 days per relationship. |

We commit to A and B for all four relationships. We commit to C only for `entity_stakeholders` (the highest-value relationship, with the broadest parent vocabulary). The other three stay enforced-polymorphic — they're internal-only, narrower vocabularies, and the cost-benefit doesn't yet justify the migration.

---

## Backlog

Tick boxes as work lands. Each item is small enough to commit independently. Update this file in the same commit as the work.

### Phase 0 — Pre-flight (today)

- [x] **0.1** Cap doc shipped: [docs/c_polymorphic_writes.md](../../docs/c_polymorphic_writes.md)
- [x] **0.2** Canary test shipped: [backend/internal/dbcheck/orphans_test.go](../../backend/internal/dbcheck/orphans_test.go)
- [x] **0.3** TD-001 registered: [docs/c_tech_debt.md](../../docs/c_tech_debt.md)
- [x] **0.4** Run the canary against the live DB; record baseline orphan counts. **Result (2026-04-23):** zero across `entity_stakeholders`, `item_type_states`, `page_entity_refs`. `item_state_history` skipped (no parent tables). Clean baseline.
- [x] **0.5** Verify CHECK vocabulary against doc. **Result (2026-04-23):** `entity_stakeholders` ✓, `item_type_states` ✓, `item_state_history` ✓. `page_entity_refs` CHECK is `{portfolio, product}` only — doc & cleanup registry & canary all incorrectly listed `workspace`. Fixed all three; live writer (`bookmarks.go`) confirms workspace bookmarking is not implemented. Canary re-run after fix: still zero.

### Phase 1 — Database-level enforcement (~3 days)

Vocabulary and dispatch enforcement at the Postgres layer. App code is one line of defence; this is the second.

- [x] **1.1** Migration: add or tighten `CHECK` constraints on `entity_kind` / `item_type_kind` columns to match the documented vocabulary exactly. **Result (2026-04-23):** verified existing CHECKs already match the corrected doc post-0.5; no tightening needed. `entity_stakeholders` = `{company_roadmap, workspace, portfolio, product}`; `item_type_states` = `{portfolio, execution}`; `page_entity_refs` = `{portfolio, product}`.
- [x] **1.2** Migration: write `dispatch_polymorphic_parent(kind text, id uuid)` plpgsql function — looks up the parent table by kind, returns `(tenant_id uuid, archived_at timestamptz)` or raises `foreign_key_violation` if the parent is missing. **Shipped in [013_polymorphic_dispatch_triggers.sql](../../db/schema/013_polymorphic_dispatch_triggers.sql).** Two dispatch fns: `dispatch_polymorphic_parent` (entity_stakeholders/page_entity_refs vocab) and `dispatch_item_type_parent` (item_type_states vocab — the latter has its own kind enum `{portfolio, execution}` aliasing different parent tables).
- [x] **1.3** Migration: `BEFORE INSERT OR UPDATE` trigger on `entity_stakeholders` that calls the dispatch function and asserts `parent.tenant_id = NEW.tenant_id`. Reject otherwise. **Shipped.**
- [x] **1.4** Same trigger pattern for `page_entity_refs`. (Even though `bookmarks.go` already pre-validates, the trigger is defence in depth — and protects future writers we haven't built yet.) **Shipped — also rejects writes against pages with NULL tenant.**
- [x] **1.5** Same trigger pattern for `item_type_states`. (Dormant, but cheap to add now.) **Shipped.**
- [x] **1.6** **Skip** `item_state_history` trigger until the parent tables (`portfolio_item`, `execution_item`) exist. Add a comment in the migration explaining the gap. **Comment added at end of migration 013.**
- [x] **1.7** Test: lifecycle integration tests per relationship — insert with valid parent (passes), insert with missing parent (rejected), insert with cross-tenant parent (rejected as not-found), insert with archived parent (rejected). Pattern after `backend/internal/nav/service_test.go`. **Shipped (2026-04-23) in [backend/internal/dbcheck/dispatch_triggers_test.go](../../backend/internal/dbcheck/dispatch_triggers_test.go).** 8 subtests covering all three live relationships — missing parent, archived parent, cross-tenant, cross-kind, valid happy path. All run inside per-test transactions and roll back. Skip cleanly when tunnel is down.
- [x] **1.8** Confirm canary still passes after triggers land. **Result (2026-04-23):** `TestNoPolymorphicOrphans` green across all three live relationships (item_state_history skipped — no parent tables).

### Phase 2 — Go service layer (~1 day)

Codify the writer pattern from `c_polymorphic_writes.md` so every future writer is short, correct, and idiomatic.

- [ ] **2.1** Create `backend/internal/entityrefs/service.go` (or co-locate per relationship if the team prefers). Implement `Insert(ctx, tx, kind, id, callerTenant, …) error` and `DeleteByParent(ctx, tx, kind, id) error` per the doc. Loader sets `kind`; `parentTableFor(kind)` is hard-coded — never user input.
- [ ] **2.2** Refactor `backend/internal/nav/bookmarks.go` to use the new service for its `page_entity_refs` insert. Behaviour unchanged; just routed through the shared writer.
- [ ] **2.3** Implement `cleanupPolymorphicChildren(ctx, tx, kind, id) error` as a registry function. Source of truth is the table in `c_polymorphic_writes.md` — duplicate the map in code with a comment pointing back to the doc.
- [ ] **2.4** Unit tests for `cleanupPolymorphicChildren` covering each parent kind. Use a tx-rollback harness so no live data churn.
- [ ] **2.5** Update `c_polymorphic_writes.md` Go pattern section to reflect the actual service shape (it's currently a sketch).

### Phase 3 — Wire cleanup into archive handlers (~1 day)

The bit that closes the loop. Every parent's archive/delete handler MUST call the registry.

- [ ] **3.1** Audit existing archive handlers for `workspace`, `portfolio`, `product`, `company_roadmap`, `portfolio_item_types`, `execution_item_types`. List them with file:line in this checklist as a sub-bullet under each item.
- [ ] **3.2** For each existing handler: add `cleanupPolymorphicChildren(ctx, tx, kind, id)` inside the same transaction, before the parent UPDATE/DELETE. Single PR per handler is fine; one PR for all is fine; the test must cover each.
- [ ] **3.3** For each *missing* handler (parent kinds with no archive handler today): add a code comment at the table's primary write-site noting "archive handler MUST call cleanupPolymorphicChildren — see c_polymorphic_writes.md". This is a cap on the next person who writes the handler.
- [ ] **3.4** Lifecycle integration test per (parent kind × child relationship) cell: archive parent, assert child rows gone in same tx. Cells without parent handlers yet are skipped with `t.Skip("no archive handler for X yet — see plan_db_polymorphic_paydown.md 3.3")`.
- [ ] **3.5** Run canary; confirm zero orphans. Run lifecycle tests; confirm green.

### Phase 4 — Migrate `entity_stakeholders` to per-kind tables (~3 days, optional)

Only the relationship that earns it. Defer if the lifecycle tests + dispatch triggers make Phase 4 feel like over-engineering.

- [ ] **4.1** Decision gate: is anyone still pushing back on "polymorphic FK" in security reviews? If no, defer Phase 4 indefinitely and move TD-001 to *resolved (capped + enforced)*. If yes, proceed.
- [ ] **4.2** Migration (expand): create `company_roadmap_stakeholders`, `workspace_stakeholders`, `portfolio_stakeholders`, `product_stakeholders` — each with proper FK + `ON DELETE CASCADE` + `(tenant_id, …)` composite indexes. Backfill from `entity_stakeholders` partitioned by `entity_kind`.
- [ ] **4.3** App layer: dual-read (new tables first, fall back to old) for soak period.
- [ ] **4.4** App layer: dual-write (write to both during soak).
- [ ] **4.5** Soak period (≥1 week with traffic). Compare row counts.
- [ ] **4.6** Migration (contract): drop `entity_stakeholders` table. Drop the dispatch trigger for it. Remove dual-read/dual-write code.
- [ ] **4.7** Update `c_polymorphic_writes.md` to remove `entity_stakeholders` from the table of relationships. Update `cleanupPolymorphicChildren` registry to drop those rows (Postgres now handles cascade).
- [ ] **4.8** Update canary — drop the `entity_stakeholders` quadrant.

### Phase 5 — Resolve TD-001 (~30 min)

- [ ] **5.1** Update [docs/c_tech_debt.md](../../docs/c_tech_debt.md) TD-001 row: mark resolved with date. Note which layer landed (B-only vs B+C).
- [ ] **5.2** Strikethrough TD-001 in the register for one cycle, then remove.
- [ ] **5.3** Final canary run + lifecycle suite — green across the board.
- [ ] **5.4** Surface to user with the standard format: *"Debt: TD-001 resolved — polymorphic FKs enforced via dispatch trigger + service layer + archive cleanup. entity_stakeholders [migrated to per-kind / kept polymorphic]; item_type_states + page_entity_refs + item_state_history (when its parent tables ship) stay polymorphic with full enforcement."*

---

## Decision points (call out as they arrive)

| Decision | When | Default |
|---|---|---|
| Phase 4 yes/no | After Phase 3 lands and triggers prove themselves for ~2 weeks | Defer until an external review actually flags it |
| Co-locate `entityrefs` service vs split per relationship | Phase 2.1 | Co-locate (less code, single registry source) |
| Lift `item_state_history` append-only trigger for cleanup deletes vs add tombstone column | When `portfolio_item` / `execution_item` parent tables ship | Tombstone column — preserves audit trail |
| Drop the canary after Phase 3 | Never — it's the floor; cheap to keep | Keep |

## Risks

- **R1:** Dispatch trigger adds write latency. Mitigation: it's a single PK lookup against an indexed table; benchmark in 1.7 — abort if >5% on a representative load.
- **R2:** Trigger raises a confusing error if a developer forgets to set `tenant_id` in `NEW`. Mitigation: error message includes `kind`, `id`, both tenant ids — fail loud.
- **R3:** Phase 3 misses a handler. Mitigation: 3.1 audit + 3.4 per-cell test catches it; canary catches it post-deploy as defence in depth.
- **R4:** Phase 4 backfill takes a lock window. Mitigation: standard expand-contract — only the contract step needs a brief lock, everything else is online.

## Effort summary

| Phase | Days | Cumulative |
|---|---|---|
| 0 | 0.5 | 0.5 |
| 1 | 3 | 3.5 |
| 2 | 1 | 4.5 |
| 3 | 1 | 5.5 |
| 4 (optional) | 3 | 8.5 |
| 5 | 0.5 | 9 |

**Without Phase 4: ~5–6 engineering days.** Closes TD-001 to *resolved (enforced)*.
**With Phase 4: ~9 engineering days.** Closes TD-001 to *resolved (migrated)*.

## Working agreement for this plan

- **One commit per backlog box** wherever practical. Larger boxes (e.g. 1.7) can be one PR with multiple commits.
- **Tick the box in the same commit** as the work — the plan file and the change ship together.
- **Run the canary before and after every commit** in Phases 1 and 3. Treat any non-zero count as an incident.
- **No phase starts** until the previous phase's last box is ticked and verified.
- **Surface progress** at end of each phase using the standard debt-update line.
