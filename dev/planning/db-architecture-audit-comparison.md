# DB Architecture Audit — Cross-Reference of Opus vs Sonnet

> **Date:** 2026-04-25
> **Inputs:** `db-architecture-audit-v7-migration.md` (Opus, ~985 lines) and `db-architecture-audit-sonnet.md` (Sonnet, ~853 lines).
> **Purpose:** validate the database audit findings by triangulating two independent passes. Items confirmed by both models are robust; items found by only one need further scrutiny.

---

## 1. Executive Summary

The two audits are **broadly aligned on the architecture's shape and the dominant systemic risks**, and they diverge mainly on *scope and severity*, not on direction.

- **Both models agree on the central thesis**: cross-DB referential integrity is the #1 systemic risk; tenant isolation is hand-rolled (no RLS); MFA scaffold columns are unsafe; UUID v7 should be selectively adopted (not a wholesale rewrite); the polymorphic-archive path is the next live hazard.
- **Where they diverge most**: Opus proposes a 6-phase, ~15-table v7 migration plan over 10–12 calendar weeks; Sonnet limits v7 to **4 tables** with no schema migration at all (app-side generator, default left in place). Severity ratings on individual debt items also drift by one tier in several places.
- **Each surfaced findings the other missed.** Opus caught **operational time-bombs** (broken `db/ops` script, stale `provision_tenant_defaults()` seed, hardcoded library-role passwords, missing partial-unique on adoption mirrors, missing migration 027). Sonnet caught **lifecycle hazards** (sessions/password_resets CASCADE on user delete, JWT dual-accept with no sunset, adoption-saga watchdog gap, no `users.archived_at`).
- **Confidence in the joint output**: where both agree, the finding is high-confidence and actionable now. Where one is silent, the other's finding still merits a check — particularly Opus's broken-on-disk seed/ops files (latent S2 that bites the next dev) and Sonnet's CASCADE / JWT-sunset concerns (latent S2/S3 that compound at scale).

The shared bottom line: **don't ship the first archive handler, the first MFA enrolment path, or the first cross-DB writer without addressing the corresponding finding** — both audits independently land on this same set of gates.

---

## 2. Agreements

Findings where both audits independently reached the same conclusion. These should be treated as the high-confidence core of the joint audit.

### 2.1 Cross-DB referential integrity is the dominant systemic risk

- **Opus said:** *"The dominant architectural risk is cross-DB referential integrity. … Five separate features now lean on app-enforced, cross-DB references … each with its own variant of the same writer-validate / reconciler-sweep contract, and none of them yet has its writer in production."* (§1)
- **Sonnet said:** *"Cross-DB referential integrity is entirely app-enforced and partially trustless. … Some have writer guards; none have a database-level safety net beyond the cross-DB cleanup queue."* (§1.1 #1)
- **Verdict:** Both agree — **this is the #1 architecture risk**. A single shared cross-DB writer service plus a periodic reconciliation job is required, not optional.

### 2.2 No RLS — tenant isolation is one missing predicate from breach

- **Opus said:** *"No RLS policies defined. All tenant filtering is hand-rolled in Go handlers. … This is the biggest single defence-in-depth gap."* (§5.2)
- **Sonnet said:** *"Tenant isolation is purely application-layer. … the blast radius of a single missing predicate is total cross-tenant breach."* (§5.2)
- **Verdict:** Both agree. Both also agree on **piloting RLS on a low-risk table first** before broad rollout (Opus: `audit_log` + `error_events` Phase A; Sonnet: `user_nav_prefs`). Tactical pick differs; strategic call is identical.

### 2.3 MFA columns store plaintext secrets

- **Opus said:** *"`users.mfa_secret` and `users.mfa_recovery_codes` plaintext. Acceptable while MFA is dormant. Trigger: First MFA enrolment lands."* (TD-DB-020, S2)
- **Sonnet said:** *"MFA columns are a ticking bomb. … If MFA ships against this shape we will store TOTP shared secrets in cleartext and recovery codes unhashed."* (§6.2, TD-SEC-001, S1)
- **Verdict:** Both agree the columns are unsafe and any MFA wiring PR must be blocked until they're hardened. They differ on severity (see §3.2 below) but the corrective action is the same.

### 2.4 `audit_log` is append-only by convention only

- **Opus said:** *"`audit_log` is append-only by convention only — no BEFORE UPDATE/DELETE trigger. `item_state_history`, `error_events`, `library_release_log` all have this trigger; `audit_log` doesn't."* (TD-DB-010, with a fully-drafted 30-line migration in §11.5)
- **Sonnet said:** *"`audit_log` is append-only by convention (mig 001 does not add a trigger). Recommendation: add the same BEFORE UPDATE/DELETE trigger."* (§6.7, TD-SEC-003)
- **Verdict:** Both agree — promote convention to enforcement. Cost is ~30 lines; benefit is defence-in-depth on the table that *is* the audit trail.

### 2.5 First parent-archive handler is high-stakes

- **Opus said:** *"No archive/delete handler exists for `workspace`, `portfolio`, or `product`. … the first such handler must call `Refs.CleanupChildren(ctx, tx, kind, id)` before the parent UPDATE. The dispatch trigger does not enforce this — it only catches inserts."* (§3.4, TD-DB Severity S2 latent)
- **Sonnet said:** *"Polymorphic archive cleanup not yet exercised. First parent-archive handler PR — CI canary backstops; first archive handler must wire `Refs.CleanupChildren`."* (TD-DB-002, S2)
- **Verdict:** Both agree. Code-review gate: don't approve a workspace/portfolio/product archive PR without `Refs.CleanupChildren` and a per-relationship lifecycle test.

### 2.6 v4 → v7 should be selective, additive, and never backfilled

- **Opus said:** *"Do not rewrite existing UUIDs. … new rows get v7; existing rows stay v4. Both fit `UUID(16)`."* (§2.5, §10.3)
- **Sonnet said:** *"Don't migrate existing rows. v4 → v7 backfill on a UUID PK invalidates every FK that references it; the cost is enormous."* (§2.3)
- **Verdict:** Both agree. **No backfill, ever.** Mixed v4/v7 in the same column is fine (UUID is UUID); the index slowly self-cleans as v7 rows accumulate.

### 2.7 v7 timestamp leakage means user-visible-ID tables stay v4

- **Opus said:** *"For `users`, `sessions`, `password_resets`, default to v4 … until/unless a specific motivation appears."* (§6.3) and *"Do not migrate seeded library bundle UUIDs."* (§2.5)
- **Sonnet said:** *"`pages`, `user_custom_pages` — URLs expose IDs publicly per route convention. Creation-time leak undesirable. Keep v4."* (§2.2.3)
- **Verdict:** Both agree — any UUID that appears in a URL, a JWT, or an external contract stays v4. The disagreement is on which tables count (§5 below); the principle is shared.

### 2.8 Append-only history tables are correctly trigger-enforced (except `audit_log`)

- **Opus said:** *"`item_state_history`, `error_events`, `library_release_log` already have BEFORE UPDATE/DELETE triggers — copy that pattern."* (§1, §6.2)
- **Sonnet said:** *"`item_state_history` (mig 006), `error_events` (mig 028), `library_release_log` … all have BEFORE UPDATE/DELETE triggers raising `check_violation`. This is exactly correct."* (§6.6)
- **Verdict:** Both agree. The pattern is sound; `audit_log` is the only outlier.

### 2.9 `pending_library_cleanup_jobs` worker must ship before any caller enqueues

- **Opus said:** *"Wire the `pending_library_cleanup_jobs` worker before the first writer ships. This is the only mechanism that prevents adopt/archive sagas from leaving cross-DB orphans."* (§1, headline #4)
- **Sonnet said:** Implicitly agrees by treating the queue as the cross-DB-cleanup primitive (§3.4, §8.5) and naming retention/janitor concerns as follow-on work (TD-DB-011).
- **Verdict:** Both agree the queue is the right design and the worker is a hard prerequisite. Sonnet is slightly less prescriptive on the urgency.

### 2.10 Several FK columns lack supporting indexes

Both audits independently surface a similar set of missing indexes:

- **Both name:** `entity_stakeholders.user_id`, `item_state_history (subscription_id, item_id)` composite, `audit_log.user_id` (Sonnet), `entity_stakeholders (entity_kind, entity_id)` (Opus).
- **Verdict:** Both agree. The Q2-2026-pass index migration is uncontroversial.

### 2.11 Soft-archive / hard-delete pattern is internally consistent

Both audits independently verify that *business data soft-archives, reference data deletes via migration, user-private content hard-deletes* — and that the codebase actually follows this rule. (Opus §7.4; Sonnet §7.3.) **Verdict: pattern is sound.**

### 2.12 Tenant column coverage is complete

Both audits walked the table list and confirmed `subscription_id NOT NULL` is present (or correctly derived through a parent FK) on every business table. (Opus §5.1; Sonnet §5.1.) **Verdict: confirmed.**

### 2.13 MMFF library role/grant matrix is well-designed

Both audits independently praise `db/library_schema/002_roles.sql` + `006/007` grants as least-privilege, with the `library_release_log` INSERT-only-by-grant *and* INSERT-only-by-trigger as exemplary defence-in-depth. (Opus §6.5; Sonnet §6.8.) **Verdict: confirmed strong.**

### 2.14 `mmff_vector` runs as a single privileged role

- **Opus said:** *"`mmff_vector` has only the `mmff_dev` application role (full DDL/DML). Not least-privilege."* (TD-DB-016, S3)
- **Sonnet:** Does not directly call out the role concentration but implies it via the contrast with the library DB grant praise.
- **Verdict:** Opus surfaced explicitly; Sonnet implicitly. Both treat it as deferred work.

---

## 3. Disagreements

### 3.1 Scope of the v7 migration: ~15+ tables vs 4 tables

- **Opus said:** Migrate v7 progressively across **~15 tables** in 6 phases over 10–12 calendar weeks (~6 dev-weeks). Includes `audit_log`, `error_events`, `item_state_history`, `library_release_log`, `pending_library_cleanup_jobs`, all five adoption mirrors, and the portfolio stack. (§10)
- **Sonnet said:** Migrate **only 4 tables** (`audit_log`, `error_events`, `library_release_log`, `pending_library_cleanup_jobs`) via app-side generator with the existing `gen_random_uuid()` default kept as a backstop. ~1 engineering week. (§10)
- **On review:** Sonnet's narrower scope is the better starting point for the next 1–2 quarters. Opus's own §10.1 actually says *"defer"* — Opus's full plan is presented as a roadmap, not a near-term ask. Sonnet's tighter scope minimizes coordination cost and matches the *"v4 → v7 is an enhancement, not a fix"* framing both share. Opus's per-table analysis (§2.3) remains valuable as a *future* roadmap once the four-table beachhead has soaked. **Both have merit; Sonnet's plan should ship first, with Opus's broader plan held as a deferred Phase-2.**

### 3.2 MFA severity: S2 vs S1

- **Opus said:** TD-DB-020, **S2**, *"Acceptable while MFA is dormant."*
- **Sonnet said:** TD-SEC-001, **S1**, *"Block any MFA wiring PR until done. … This is not optional debt."*
- **On review:** Sonnet is more correct *as a posture*. The schema is the contract; if the columns sit in production with this shape and the next MFA-enabling PR doesn't fix them simultaneously, the leak is instant. The trigger is *"first MFA wire-up PR,"* and S1 forces that PR to fix first. S2 lets it slip. **Promote to S1.**

### 3.3 `audit_log` trigger severity: S2 vs S3

- **Opus said:** TD-DB-010, **S2** ("any future code path or accidental migration that mutates audit rows").
- **Sonnet said:** TD-SEC-003, **S3** ("promote to S2 if any audit-log mutation incident").
- **On review:** Opus is more correct. The cost of the trigger is ~30 lines and zero runtime; the benefit is that a single bad migration cannot rewrite audit rows. S3 is "record only" (per the project's tech-debt taxonomy); S2 is "cap now" — and given the trivial pay-down cost, this is closer to S2 than S3. Either way, it should ship in the next quick-wins PR. **Lean S2.**

### 3.4 `sessions` / `password_resets` CASCADE on user delete

- **Opus said:** *"`sessions.user_id` CASCADE — ✅ Correct (sign out everywhere on hard-delete). `password_resets.user_id` CASCADE — ✅."* (§3.2)
- **Sonnet said:** *"`sessions ON DELETE CASCADE` deletes audit-relevant rows when a user is deleted. … If a user IS deleted, every session and refresh-token-hash trail vanishes. Severity: med."* (§1.1 #5, §6.4) — recommends switching to `RESTRICT` and forcing explicit revoke-then-delete.
- **On review:** Sonnet has the sharper read. Opus implicitly assumes the hard-delete path is wanted and complete; Sonnet observes that hard-delete should be rare/audited, and CASCADE silently destroys forensic data when it does happen. The right model is *"users are soft-archived; if a real GDPR erasure runs, it must explicitly snapshot forensic data first and then revoke sessions"* — which is what RESTRICT would force. **Sonnet is more correct.** This is a real S3 finding worth tracking.

### 3.5 v7 generation mechanism: extension vs app-side

- **Opus said:** *"Application-side generation, schema sets default to `gen_random_uuid()` for back-compat … The Go layer adopts `uuid.NewV7()`"* (§2.4) — but the Phase-1 migration plan installs `pg_uuidv7` and wraps it as `mmff_uuidv7()` (§10.2).
- **Sonnet said:** *"Recommendation: Option B [app-side]. Lower coordination cost; the backstop default avoids correctness regressions if a path is missed."* (§10.2)
- **On review:** This is more apparent than real — Opus's prose recommends app-side, but the migration plan installs the extension as Phase 1. The cleanest synthesis is **Sonnet's app-side approach** (no extension, no replica/backup-restore tax) with Opus's per-call-site Go helper. The extension is a future option once Postgres 17.x ships native v7. **Both have merit; ship Sonnet's plan first.**

### 3.6 `audit_log.subscription_id SET NULL` anomaly

- **Opus said:** *"⚠ Inconsistent with the 'RESTRICT subscription deletes' pattern. Today no path hard-deletes a subscription, so this rule is unreachable. If/when a hard-delete path ships, it will silently null out the audit trail's subscription_id — losing the which-tenant dimension."* (§3.2, §5.4) — recommends RESTRICT.
- **Sonnet said:** Does not flag this.
- **On review:** Opus is correct. It's a latent S3 — unreachable today (every business FK on `subscriptions` is RESTRICT) but a real foot-gun if a hard-delete ever ships. Worth a one-line `c_schema.md` annotation now plus a migration when the FK pattern is next swept. **Adopt Opus's finding.**

### 3.7 RLS pilot: which table?

- **Opus said:** Three tranches starting with `audit_log` + `error_events` (append-only, simple shapes). (§5.2)
- **Sonnet said:** Single low-volume pilot on `user_nav_prefs` (high enough volume to matter, low enough impact to roll back). (§5.2)
- **On review:** Both have merit. Opus's pick stresses RLS on already-trigger-protected append-only tables — the *least-risky* shape, but also the *most-policy-restrictive* (since the writer is the only path). Sonnet's pick stresses a typical mutable per-user table — closer to the steady-state RLS pattern. **Recommendation: pilot on `user_nav_prefs` first (Sonnet) to validate the request-context middleware against a normal CRUD shape, then move to `audit_log` / `error_events` (Opus's plan) once the middleware is proven.**

### 3.8 Severity of "JWT dual-accept has no sunset"

- **Opus said:** Notes the rename in passing but does not register debt.
- **Sonnet said:** TD-DB-010, S3, *"hard sunset within 6 months of mig 017 deploy."* (§1.1 #7, §11.2)
- **On review:** Sonnet is correct to register this. Dual-accept JWT shims are exactly the kind of "temporary" code that becomes permanent — and a shim that accepts an *old token claim shape* is a long-tail security/liability concern. **Adopt Sonnet's finding.**

---

## 4. Unique Findings

Findings only one model surfaced. Each is annotated with a check on whether it should be incorporated.

### 4.1 Found by Opus only

**4.1.1 `db/ops/cleanup_perm_test_tenants.sql` is broken (TD-DB-012).** References pre-rename `tenants` / `tenant_id`; will fail if anyone runs it. (§7.1)
- **On review:** Real and high-value catch. Latent S2 — bites the next dev who runs the permission test cleanup. **Incorporate as quick-win #1.**

**4.1.2 `provision_tenant_defaults()` seed function body is stale (TD-DB-013).** `db/seed/001_default_workspace.sql` references `tenant_id` / `tenants` post-mig-017. Function on disk will mis-create on a fresh DB rebuild. (§7.2)
- **On review:** Real, high-value, and easily missed. Latent S2 — fresh-DB rebuilds break. **Incorporate as quick-win #2.**

**4.1.3 Hardcoded library role passwords (`change_me_admin`, etc.).** `db/library_schema/002_roles.sql` ships with placeholder passwords that the file's own header says must be rotated via `ALTER ROLE` in deployment. (§6.4)
- **On review:** Real pre-launch security item. Cross-references `project_pre_launch_security` memory. **Incorporate into the pre-launch security checklist.**

**4.1.4 Missing partial-unique on adoption mirrors (TD-DB-014).** None of the five `subscription_*` mirror tables has `UNIQUE (subscription_id, source_library_id) WHERE archived_at IS NULL`. An orchestrator bug or retry-without-idempotency could insert duplicate mirror rows. (§7.7)
- **On review:** Real, subtle, and the kind of thing that only manifests under retry. **High-value catch — incorporate as a Q2 migration.**

**4.1.5 Migration 027 silently missing (TD-DB-018).** Numbering is non-contiguous; nothing in `c_schema.md` flags it. (§4.7) Includes a one-liner CI canary.
- **On review:** Process gap, low harm but worth fixing. **Add the canary; cost is one shell line.**

**4.1.6 Vocabulary CHECK gaps (TD-DB-019).** `users.auth_method`, `pages.kind`, `entity_stakeholders.role` are TEXT without CHECK; closed vocabularies should be pinned. (§4.3)
- **On review:** Sonnet hinted at this in §4.3 but didn't itemize. Opus gives the explicit list. **Incorporate.**

**4.1.7 Redundant indexes (TD-DB-015).** `idx_users_email` (non-unique) is redundant with `users_email_tenant_unique`; `idx_sessions_token_hash` is redundant with the UNIQUE constraint on `token_hash`. (§4.1)
- **On review:** Minor IO/storage tax; low-priority quick-win. **Incorporate but defer.**

**4.1.8 `subscription_layers (allows_children OR is_leaf)` CHECK.** Combination `(allows_children=false AND is_leaf=false)` is non-sensical. (§4.5)
- **On review:** Defence-in-depth; cheap. **Incorporate.**

**4.1.9 `library_releases.audience_tier` array CHECK.** Cheap function-based CHECK that elements are in `{free, pro, enterprise}`. (§4.4)
- **On review:** Catches publish-path typos; trivial cost. **Incorporate.**

**4.1.10 Single-PR proposal: `audit_log` append-only trigger.** Opus included a full 30-line drop-in migration (§11.5).
- **On review:** This is the highest-leverage single-PR change either audit identifies. **Ship it as the very next migration (031).**

### 4.2 Found by Sonnet only

**4.2.1 sessions / password_resets CASCADE concern.** See §3.4 above — Sonnet's finding, not Opus's.
- **On review:** Real. **Incorporate.**

**4.2.2 JWT dual-accept needs a hard sunset (TD-DB-010, Sonnet's numbering).** See §3.8 above.
- **On review:** Real. **Incorporate.**

**4.2.3 Adoption-saga watchdog cron.** `subscription_portfolio_model_state` rows can be left at `status='in_progress'` if the app crashes mid-saga; need a watchdog that flips abandoned rows to `failed` after N hours. (§7.6)
- **On review:** Real and concrete. Pairs naturally with the cross-DB reconciler work. **Incorporate as a Q2 deliverable.**

**4.2.4 `users.archived_at` missing (TD-DB-008).** Only `is_active BOOLEAN` exists; no soft-archive timestamp. Bites GDPR/erasure work. (§6.4)
- **On review:** Real. Low-cost, high-future-value. **Incorporate.**

**4.2.5 `pending_library_cleanup_jobs` retention policy (TD-DB-011).** Rows in terminal `dead` state grow unbounded. (§1.3 #10, §11.3)
- **On review:** Real. Defer until volume warrants. **Incorporate as a janitor task.**

**4.2.6 Mig 012 idempotency hazard.** The pages-partial-unique cleanup DML in mig 012 is non-idempotent and risky if re-run after manual fix-ups. (§1.1 #6)
- **On review:** Niche but real ops concern. **Document in `c_postgresql.md`.**

**4.2.7 `subscription_sequence` hot-lock at scale.** Composite PK is correct, but a single `(subscription_id, 'item_key')` row could become a hot lock under high write contention. (§7.5)
- **On review:** Scaling watch-item; not actionable today. **Incorporate as `c_tech_debt.md` watch-item.**

**4.2.8 `user_nav_prefs.position` DEFERRABLE uniqueness must not be dropped.** A future migration that accidentally rewrites this without `DEFERRABLE` breaks reordering inside a transaction. (§7.7)
- **On review:** Real subtle constraint to preserve. **Add as a CI canary or migration-review note.**

**4.2.9 FDW / logical-replication option for cross-DB.** Sonnet enumerates three options for stronger cross-DB integrity (FDW, logical replication, periodic reconciliation) and recommends reconciliation. Opus only recommends reconciliation. (§8.5)
- **On review:** Sonnet's enumeration is more useful long-term. **Incorporate into the cross-DB reconciler design discussion.**

**4.2.10 Multi-region cross-DB cleanup queue assumption.** The cleanup queue assumes both DBs are in the same Postgres cluster; multi-region breaks this. (§8.6)
- **On review:** Forward-looking; document the assumption. **Add to `c_deployment.md`.**

---

## 5. v7 Migration: Head-to-Head

Per-table comparison of v7 verdicts. Format: ✅ migrate / 🟡 defer / ❌ keep v4 / ⚪ no UUID PK.

### `mmff_vector`

| Table | Opus | Sonnet | Match? | Note |
|---|---|---|---|---|
| `subscriptions` | ❌ seed; ✅ new | ❌ keep v4 | Mostly | JWT-embedded; both effectively keep v4. |
| `users` | ✅ | ❌ keep v4 | **Disagree** | Opus prioritises B-tree locality; Sonnet prioritises URL/log exposure. **Sonnet is right** — user IDs do appear in URLs and admin tooling. |
| `sessions` | 🟡 | ✅ | Disagree | Opus worries about creation-time leak; Sonnet treats them as leaves (tokens are hashed, IDs not user-visible). **Sonnet is right at face; Opus's concern is theoretical.** |
| `password_resets` | 🟡 | ✅ | Same shape | Both note the URL carries the raw token, not the row id. Either decision is defensible. |
| `user_workspace_permissions` | ✅ | (not in v7 list) | Drift | Opus expands; Sonnet defers. **Sonnet's narrower scope is more conservative.** |
| `audit_log` | ✅ (biggest win) | ✅ | **Agree** | The unambiguous "yes." |
| `subscription_sequence` | ⚪ | ⚪ | Agree | Composite PK. |
| `company_roadmap`, `workspace`, `portfolio`, `product` | ✅ | ❌ keep v4 | **Disagree** | Sonnet flags URL exposure; Opus accepts it. **Sonnet is right** — these IDs surface in `/item/<uuid>` URLs. |
| `entity_stakeholders` | ✅ | 🟡 | Drift | Sonnet says low-volume; Opus says polymorphic-but-OK. **Sonnet is right** — no read-pattern win. |
| `portfolio_item_types`, `execution_item_types` | ✅ | 🟡 | Drift | Configuration tables; low volume. **Sonnet's defer is correct.** |
| `canonical_states` | ⚪ | ⚪ | Agree | TEXT PK. |
| `item_type_states` | ✅ | 🟡 | Drift | Configuration. **Sonnet's defer is correct.** |
| `item_type_transition_edges` | ✅ | 🟡 | Drift | Configuration. **Sonnet's defer is correct.** |
| `item_state_history` | ✅ (2nd-biggest win) | ✅ | **Agree** | Both name as a v7 winner. Both note the append-only trigger blocks any backfill. |
| `pages` | 🟡 | ❌ keep v4 | Mostly agree | URL exposure. Sonnet is firmer; Opus is hedged. **Sonnet is right.** |
| `page_tags`, `page_roles`, `page_entity_refs` | ⚪ / ⚪ / ⚪ | ⚪ / 🟡 | Agree | Composite or TEXT PK. |
| `user_nav_prefs`, `user_nav_groups` | ✅ | 🟡 | Drift | Low volume. **Sonnet's defer is correct.** |
| `user_custom_pages` | ✅ | ❌ keep v4 | **Disagree** | URL exposure (`/p/<uuid>`). **Sonnet is right.** |
| `user_custom_page_views` | ✅ | 🟡 | Drift | Low volume. **Sonnet's defer is correct.** |
| `pending_library_cleanup_jobs` | ✅ (claim-pattern) | ✅ | **Agree** | Both name as a winner. |
| `library_acknowledgements` | ⚪ | (not addressed) | Agree | Composite PK. |
| `subscription_portfolio_model_state` | 🟡 | (not addressed) | OK | One-active-row; v7 buys nothing. |
| All five adoption mirrors | ✅ | (not addressed) | Drift | Opus argues B-tree locality during adoption batch insert. **Reasonable but defer until the four-table beachhead has soaked.** |
| `error_events` | ✅ (biggest read-pattern win after `audit_log`) | ✅ | **Agree** | Both name as a winner. |

### `mmff_library`

| Table | Opus | Sonnet | Match? |
|---|---|---|---|
| `portfolio_models` (and bundle children) | ❌ seed; 🟡 new | ❌ keep v4 | Mostly agree — cross-DB referenced; both defer. |
| `library_releases` / `_actions` | ✅ | (not in v7 list) | Drift — Opus expands; Sonnet narrower. |
| `library_release_log` | ✅ (append-only) | ✅ | **Agree.** |
| `error_codes` | ⚪ | ⚪ | Agree (TEXT PK). |

### Summary

- **Both unambiguously agree on:** `audit_log`, `error_events`, `item_state_history`, `library_release_log`, `pending_library_cleanup_jobs` — the **5-table joint beachhead**. (Sonnet only listed 4 explicitly; `item_state_history` is the implicit fifth because both audits name it as a v7 winner that can flip-default-only.)
- **The disagreement is everywhere else.** Opus migrates ~15 tables; Sonnet stops at the joint beachhead. The independent-review verdict matches **Sonnet's narrower scope**: keep v4 anywhere a UUID surfaces in a URL, JWT, or external contract. Opus's broader scope is a future Phase-2 once the beachhead has soaked.

---

## 6. Tech Debt Priority Comparison

Both audits propose new debt entries. Side-by-side severity ratings:

| Theme | Opus ID/Sev | Sonnet ID/Sev | Severity match? |
|---|---|---|---|
| Cross-DB writers unconsolidated | TD-DB-011 / S2 | (covered narratively) | Implicit agree |
| Broken `cleanup_perm_test_tenants.sql` | TD-DB-012 / **S2** | (not found) | Opus only |
| Stale `provision_tenant_defaults()` seed | TD-DB-013 / **S2** | (not found) | Opus only |
| Adoption-mirror missing partial-unique | TD-DB-014 / **S2** | (not found) | Opus only |
| Redundant indexes | TD-DB-015 / S3 | (covered §4.1) | Both — S3 |
| `mmff_vector` single role | TD-DB-016 / S3 | (implicit) | Opus only explicit |
| No RLS | TD-DB-017 / S3 | (covered §5.2) | Both — S3 |
| Missing migration 027 | TD-DB-018 / S3 | (not found) | Opus only |
| TEXT-as-enum CHECK gaps | TD-DB-019 / S3 | (TD-DB §4.3 partial) | Both — S3 |
| MFA plaintext secrets | **TD-DB-020 / S2** | **TD-SEC-001 / S1** | **Disagree (S2 vs S1)** |
| Production seed contamination | TD-DB-021 / S2 | (covered via memory ref) | Both flagged |
| Partitioning runway | TD-DB-022 / S3 | TD-DB-006 / S3 | Both — S3 |
| `audit_log` append-only trigger | TD-DB-010 / **S2** | TD-SEC-003 / **S3** | **Disagree (S2 vs S3)** |
| `item_state_history` orphan latency | (covered §3.4) | TD-DB-001 / S2 | Both — S2 |
| First archive handler hazard | (covered §3.4) | TD-DB-002 / S2 | Both — S2 |
| `item_type_states` cleanup not in registry | (covered §3.4) | TD-DB-003 / S2 | Both — S2 |
| `sessions`/`password_resets` CASCADE | (called ✅ correct) | TD-DB-004 / S3 | **Disagree** |
| Cross-DB reconciliation cron | (in §10 / §11) | TD-DB-005 / S3 | Both — S3 (Opus implicit higher) |
| `users.archived_at` missing | (not found) | TD-DB-008 / S3 | Sonnet only |
| UUIDv7 strategy undecided | (whole §10) | TD-DB-009 / S3 | Both — S3 (decision item) |
| JWT dual-accept no sunset | (not found) | TD-DB-010 / S3 | Sonnet only |
| Cleanup-queue retention | (not found) | TD-DB-011 / S3 | Sonnet only |
| LDAP-locked-fields no DB enforcement | (covered §6.6) | TD-SEC-002 / S2 | Both — Opus left at S3, Sonnet at S2 |
| Adoption-saga watchdog | (not found) | (in §7.6, no ID) | Sonnet only |

**Severity disagreements that matter:**

1. **MFA secrets**: Opus S2, Sonnet S1. **Sonnet is more correct** — see §3.2.
2. **`audit_log` trigger**: Opus S2, Sonnet S3. **Opus is more correct** — see §3.3.
3. **`sessions` CASCADE**: Opus says ✅ correct, Sonnet says S3. **Sonnet's S3 is more correct** — see §3.4.

Everything else is within one tier and reflects genuine judgment calls rather than missed analysis.

---

## 7. Consolidated Recommendations

A merged, prioritised punch-list. Each item annotated with source: **[Opus]**, **[Sonnet]**, or **[Both]**.

### 7.1 Quick wins (≤ 1 dev-week each, do in order)

1. **[Opus]** Repair `db/ops/cleanup_perm_test_tenants.sql` (rename `tenants → subscriptions`, `tenant_id → subscription_id`). ~1 hour.
2. **[Opus]** Repair `db/seed/001_default_workspace.sql`'s `provision_tenant_defaults()` body (same rename). ~2 hours.
3. **[Both]** Add the `audit_log` append-only trigger (Opus has the drop-in migration). New mig 031. ~2 hours. **Severity: S2 (Opus's read).**
4. **[Opus]** Add partial-unique on all five adoption mirrors `(subscription_id, source_library_id) WHERE archived_at IS NULL`. New mig 032. ~3 hours.
5. **[Opus]** Add CHECKs on `users.auth_method`, `pages.kind`, `entity_stakeholders.role` (and `subscription_layers (allows_children OR is_leaf)`, `library_releases.audience_tier <@ ARRAY[...]`). New mig 033. ~4 hours.
6. **[Opus]** Drop redundant `idx_users_email` and `idx_sessions_token_hash`. New mig 034. ~1 hour.
7. **[Opus]** CI canary for contiguous migration numbering (assert no missing 027-style gaps). ~1 hour.
8. **[Both]** Pre-launch security: rotate dev seed bcrypt hashes, rotate library role passwords, document the production fixture-scrub. Cross-cuts the `project_pre_launch_security` memory. ~1 dev-day.

### 7.2 Medium-term (1–4 dev-weeks each, this quarter)

1. **[Both]** Centralise cross-DB writes behind one Go service (extend `backend/internal/entityrefs` or sibling). Route every adoption-mirror INSERT through `LoadLibraryRow(ctx, kind, id)`.
2. **[Both]** Implement the `pending_library_cleanup_jobs` worker before any caller enqueues.
3. **[Both]** Cross-DB reconciliation cron (weekly walk of `subscription_portfolio_model_state.adopted_model_id` and the 5 mirror `source_library_*` columns; alert via `error_events`).
4. **[Sonnet]** Adoption-saga watchdog cron — flip `in_progress` rows older than N hours to `failed`.
5. **[Both — Sonnet S1, Opus S2]** Encrypt MFA secrets at rest (KMS-encrypted bytea); split recovery codes into a hashed-only side table. Block any MFA wiring PR until done.
6. **[Sonnet]** Ship the JWT dual-accept sunset migration with a hard cutover date.
7. **[Both]** Index pass migration covering `entity_stakeholders.user_id`, `(entity_kind, entity_id)`, `audit_log.user_id`, `item_state_history (subscription_id, item_id, transitioned_at DESC)`, `user_workspace_permissions (user_id, subscription_id)`, `page_entity_refs (entity_kind, entity_id)`.
8. **[Both]** UUIDv7 beachhead: Sonnet's plan, four tables (`audit_log`, `error_events`, `library_release_log`, `pending_library_cleanup_jobs`), app-side generation via `idgen.NewV7()`, Go helper, no schema migration. ~1 engineering week.
9. **[Sonnet]** Change `sessions.user_id` and `password_resets.user_id` to `ON DELETE RESTRICT`; document explicit revoke-then-delete procedure for any GDPR work.
10. **[Sonnet]** Add `users.archived_at` (alongside the existing `is_active`) to give a real soft-archive timestamp.

### 7.3 Long-term (1+ months each)

1. **[Both]** RLS pilot. Joint-review verdict: start with `user_nav_prefs` (Sonnet's pick) to validate the request-context middleware, then move to `audit_log` + `error_events` (Opus's plan).
2. **[Both]** RLS Phases B & C — `*_state`, `*_history`, then full portfolio stack.
3. **[Opus]** UUIDv7 Phase-2 (Opus's broader plan) — adoption mirrors, then portfolio stack — only after the four-table beachhead has soaked 30+ days. **Skip user-visible-ID tables** (`pages`, `user_custom_pages`, work-item tables when built, `users` per Sonnet's verdict).
4. **[Both]** Time-based partitioning of `audit_log`, `error_events`, `item_state_history` once any passes ~10M rows.
5. **[Opus]** Split `mmff_vector_app` / `mmff_vector_migrate` roles for least-privilege.
6. **[Both]** LDAP-locked-fields trigger when LDAP enabling work begins.
7. **[Sonnet]** `pending_library_cleanup_jobs` retention policy + janitor cron for `dead` rows.
8. **[Both]** Outbox consolidation when the second outbox-shaped table proposes itself.
9. **[Both]** Materialised views for admin/billing dashboards if read latency becomes user-visible.
10. **[Sonnet]** Document the cross-DB cleanup-queue's same-cluster assumption in `c_deployment.md`; revisit if multi-region becomes a real plan.

### 7.4 Anti-goals (from both audits)

- **[Both]** Do not rewrite existing UUIDs in-place. Additive migration only.
- **[Both]** Do not migrate seeded library bundle UUIDs (`portfolio_models`, `portfolio_model_layers`, etc.) — they are contracts for adoption.
- **[Both]** Do not enable RLS in `FORCE` mode on the portfolio stack as a single PR — staged rollout only.
- **[Both]** Do not ship the first archive handler for `workspace`/`portfolio`/`product` without `Refs.CleanupChildren()` in the same PR.
- **[Both]** Do not adopt `pg_uuidv7` until Postgres 17.x is the production version *and* a maintenance window is allotted.
- **[Sonnet]** Do not hard-DELETE `error_events.code` against `error_codes` cross-DB; reconciliation cron is the right tool, not a real FK.

### 7.5 Concrete next-PR proposal

If we land **one PR** out of the entire combined output, both audits independently land in the same place:

> **The `audit_log` append-only trigger** (Opus's TD-DB-010 / Sonnet's TD-SEC-003).

It is 30 lines of SQL (full migration in Opus §11.5), catches a documented invariant the DB doesn't enforce, has zero risk (writer code already obeys the rule), and sets the pattern for future cross-DB integrity work.

---

## 8. Final Assessment

### 8.1 Quality comparison

| Area | Stronger | Reason |
|---|---|---|
| Operational time-bombs (broken on-disk files) | **Opus** | Found `cleanup_perm_test_tenants.sql` and `provision_tenant_defaults()` stale post-rename; Sonnet missed both. Found missing migration 027. Found hardcoded library-role passwords. |
| Lifecycle / hard-delete hazards | **Sonnet** | Spotted `sessions`/`password_resets` CASCADE problem Opus accepted as fine. Spotted JWT dual-accept with no sunset. Spotted missing `users.archived_at`. Spotted adoption-saga watchdog gap. |
| v7 migration scoping | **Sonnet** | Tighter scope (4 tables, app-side, no extension) is the right starting beachhead. Opus's per-table analysis is excellent material for a future Phase-2 once the beachhead has soaked. |
| v7 migration depth of analysis | **Opus** | Per-table verdict + rationale across all ~35 tables. Sonnet's analysis was shallower outside the 4-table list. |
| Tech-debt rigour | **Opus** | 13 numbered TD-DB items with severity, area, debt, trigger. Sonnet has 13 entries too, but several are less concrete. |
| Tech-debt severity calibration | **Mixed** | Opus correctly elevates `audit_log` trigger to S2; Sonnet correctly elevates MFA to S1; Sonnet correctly catches `sessions` CASCADE that Opus accepted. |
| Concrete drop-in code | **Opus** | Provides full 30-line migration for `audit_log` trigger and full SQL/CI-canary snippets throughout. Sonnet has fewer ready-to-paste artefacts. |
| Cross-DB ergonomics | **Sonnet** | Enumerates three options (FDW, logical replication, periodic reconciliation) and justifies the choice. Opus only names reconciliation. |
| Subtle constraint preservation | **Sonnet** | Catches `user_nav_prefs.position` `DEFERRABLE` requirement that future migrations could accidentally drop. Opus did not flag. |
| Indexes / schema health | **Roughly tied** | Both surface a similar set of missing indexes. Opus is more explicit about what's already covered ("✅ covered by `idx_users_tenant_id`"). |
| Tenant isolation analysis | **Tied** | Both walk the table list; both reach the same conclusions. |
| Polymorphic-FK analysis | **Tied** | Both correctly identify the *first archive handler* as the live hazard. |
| Future-state architecture (partitioning, RLS staging, outbox) | **Opus** | Slightly more ambitious vision; explicit phasing. Sonnet is more "watch-item" oriented. |
| Multi-region / deployment assumptions | **Sonnet only** | Multi-region cross-DB caveat is Sonnet-unique. |

### 8.2 Combined confidence

- **Findings confirmed by both audits** (§2 above): **high confidence** — robust enough to act on directly. These are the bedrock of the joint output.
- **Disagreements where one audit is clearly more correct on review** (§3 above — MFA severity, `sessions` CASCADE, v7 scope, audit_log trigger severity): **medium-high confidence after this comparison resolved them**.
- **Unique findings, especially the operational time-bombs from Opus and the lifecycle hazards from Sonnet** (§4 above): **medium-high confidence** — each was missed by the other model, suggesting a real risk of being missed by reviewers in general. Worth verifying once before acting (the Opus broken-on-disk files are particularly important to confirm with `git diff`/inspection).
- **Severity calibration**: the joint review elevated MFA to S1 (Sonnet's call) and elevated `audit_log` trigger to S2 (Opus's call). Both elevations look correct.

### 8.3 What this comparison validates

1. **The thesis is right**: cross-DB integrity, MFA, RLS, and the first archive handler are the four hard gates before any new feature ships against the existing schema. Two independent passes converged on this set.
2. **The v7 question is settled** by triangulation: ship Sonnet's narrow, app-side, no-extension plan first; defer Opus's broader plan as Phase-2. No backfill ever.
3. **The next single PR is uncontested**: `audit_log` append-only trigger.
4. **Two real operational fixes exist on disk that haven't been done** (broken `db/ops` script + stale seed function). Quick-wins #1 and #2 in §7.1.

### 8.4 What this comparison did NOT validate

- The **exact cardinality and read-latency claims** in either audit. Both are inferences from migration files; neither ran `EXPLAIN ANALYZE` on a populated DB. Acting on the index recommendations should include a verification step on a live snapshot.
- The **trigger function bodies named in passing** ("Postgres function-recompile may have updated the body" — Opus §7.2). Verify with `\sf provision_tenant_defaults` against a fresh-rebuilt DB.
- The **claim that `pg_uuidv7` is not in Postgres 17 core**. Both agree on this but neither cites a primary source; verify before scheduling extension install.
- The **handler-side claims** (e.g., "sessions IDs are never returned to clients"). Both audits explicitly flag these as needing handler-side verification.

---

*End of comparison.*
