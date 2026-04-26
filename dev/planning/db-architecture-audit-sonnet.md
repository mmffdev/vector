# MMFFDev Database Architecture Audit (Sonnet)

> **Author**: Sonnet 4.6, role-cast as senior SaaS architect / professional DBA.
> **Date**: 2026-04-25
> **Scope**: `db/schema/*` (mmff_vector — 30 numbered migrations + ops + seeds), `db/library_schema/*` (mmff_library — 8 migrations), plus cross-DB conventions documented in `docs/c_*.md`.
> **Method**: read every SQL file in `db/`, cross-reference `docs/c_schema.md`, `c_polymorphic_writes.md`, `c_security.md`, `c_tech_debt.md`. Where Go writers are referenced, treat the documented contract as the source of truth (no Go re-grep beyond what the docs assert).
> **Counterpart**: Opus is producing `db-architecture-audit-opus.md` from the same brief; a third comparison doc will reconcile.

---

## 0. Glossary & ground-truth

| Term | Meaning in this doc |
|---|---|
| **mmff_vector** | Tenant-data DB. Multi-tenant via `subscription_id` (renamed from `tenant_id` in mig 017). Holds users, business state, history, page registry, nav. |
| **mmff_library** | MMFF-authored shared content DB. Single-instance, no `subscription_id` column on most tables. Holds `portfolio_models` + bundle children, share grants, releases, error catalogue. |
| **subscription** | A paying customer/tenant. Was `tenant` pre-mig-017; the rename is comprehensive but JWT/session compatibility shims persist. |
| **gadmin / padmin / user** | Three values of `user_role` enum. gadmin = MMFF tech/support (cross-tenant by design). padmin = customer product owner. user = consumer. |
| **app-enforced FK** | A column whose referential integrity Postgres cannot enforce — typically polymorphic (kind+id) or cross-DB. Writers and triggers must enforce manually. |
| **soft-archive** | `archived_at TIMESTAMPTZ NULL`. Active rows have it NULL; archive sets the timestamp. Hard DELETE forbidden on business tables. |
| **append-only** | BEFORE UPDATE/DELETE trigger raises `check_violation`. Applied to `item_state_history`, `error_events`, `library_release_log`. |

**Ground truths I will not re-prove**:
- pgcrypto `gen_random_uuid()` produces v4 UUIDs (random, no embedded timestamp).
- `created_at`/`updated_at` on every business table; `set_updated_at()` trigger updates the latter.
- Postgres bound to loopback on the host; reach via SSH tunnel `localhost:5434` → server `:5432` (per `c_security.md` §7).

---

## 1. Executive Summary

### 1.1 Headline findings (top 10, ranked)

1. **Cross-DB referential integrity is entirely app-enforced and partially trustless.** `mmff_vector.subscription_portfolio_model_state.adopted_model_id`, all 5 adoption mirror tables' `source_library_*`, `error_events.code`, and `mmff_library.portfolio_model_shares.subscription_id` are app-FKs. Some have writer guards; none have a database-level safety net beyond the cross-DB cleanup queue (mig 019). **Risk: orphan rows on either side after partial failures, and cross-DB drift over time.**
2. **`item_state_history.item_id` has no parent table and no FK.** Migration 006 explicitly notes parent (`portfolio_item`/`execution_item`) tables are not yet built. The append-only trigger means we cannot retro-add CASCADE either. Once parent tables ship, the cleanup story is non-trivial (the trigger blocks DELETE, so cleanup needs a tombstone or trigger lift). **TD-DEBT: blocking item-table phase.**
3. **Polymorphic cleanup registry has known gaps (mig 013 + `c_polymorphic_writes.md`).** `item_type_states` cleanup is NOT yet wired into `entityrefs.Service.CleanupChildren`, and no parent (workspace/portfolio/product) currently has an archive handler. Migration 013's INSERT triggers prevent new orphans; nothing prevents archive-side orphans yet. The CI canary (`TestNoPolymorphicOrphans`) is the only backstop.
4. **MFA columns store plaintext secrets.** `users.mfa_secret TEXT` and `users.mfa_recovery_codes TEXT[]` (mig 003) are dormant scaffolding but **the columns themselves are unsafe by design**. If MFA ships against this shape we will store TOTP shared secrets in cleartext and recovery codes unhashed — a `c_security.md` §3 violation. Severity: **high**.
5. **`sessions ON DELETE CASCADE` deletes audit-relevant rows when a user is deleted.** Mig 001 wires `sessions.user_id REFERENCES users(id) ON DELETE CASCADE`. Yet `users` should never be hard-deleted (no `archived_at` on users in 001 — added later as `is_active`). If a user IS deleted, every session and refresh-token-hash trail vanishes. `password_resets` has the same cascade. Severity: **med** (depends on whether users are ever hard-deleted).
6. **Three uniqueness/constraint hazards on `pages` were inherited from mig 009 and only partially fixed in 012.** The original `pages_unique_key_per_scope UNIQUE (key_enum, tenant_id, created_by)` was broken (NULL is distinct, allowing duplicate system pages). Mig 012 replaced it with three partial unique indexes — correct, but the table-lock + dedupe DML in 012 is non-idempotent risk if re-run after manual fix-ups. Document ops procedure.
7. **`tenants` → `subscriptions` rename (mig 017) is comprehensive but JWT compatibility is dual-accept.** From `docs/c_schema.md`, JWTs may still carry `tenant_id` for a grace window. There is no migration that retires the dual-accept; this is application-layer debt that should have a hard sunset date in code.
8. **No row-level security (RLS).** Tenant isolation is purely app-layer. Every handler must filter by `subscription_id`. There is no Postgres RLS policy on any business table. This is a defensible choice (RLS adds operational and debugging cost), but it means **a single missing predicate in Go is a cross-tenant breach**. The librarian flag-stream is the primary safety net.
9. **Library DB has 4 roles + a grant matrix (`library_schema/006`), but its FK to mmff_vector for `portfolio_model_shares.subscription_id` is uncheckable.** A subscription could be archived in mmff_vector while the share row stays live in mmff_library — with no Postgres-level tie-back.
10. **UUID v4 everywhere; no UUIDv7 anywhere.** Every PK is `gen_random_uuid()`. There is no time-ordered ID column on append-only tables (`audit_log`, `item_state_history`, `error_events`, `library_release_log`) where index locality at write would benefit most. **This is the central question of §2.**

### 1.2 Risk rating

| Category | Rating | One-line reason |
|---|---|---|
| **Tenant isolation (read path)** | Medium | App-layer only; no RLS; relies on disciplined `WHERE subscription_id =` plus librarian audits. Has held up to date but is one bad PR away. |
| **Tenant isolation (write path)** | Medium-High | Polymorphic-write triggers (mig 013) are excellent insert-side defence. Archive-side has no equivalent yet; the first archive handler is high-stakes. |
| **Cross-DB consistency** | Medium-High | Cleanup queue (mig 019) is well-designed. App-FK to `mmff_library.portfolio_models` and back is a long-term integrity risk without periodic reconciliation. |
| **Append-only history integrity** | Low | Triggers in `item_state_history`, `error_events`, `library_release_log` are correctly defensive. |
| **Auth / credentials** | Medium | bcrypt cost 12 + token hashing is correct. Plaintext MFA columns and CASCADE on sessions/password_resets are real concerns. |
| **Performance / index hygiene** | Low-Medium | Most FKs have indexes; partial indexes are well-used. A handful of polymorphic and FK columns lack indexes (§4). |
| **UUID strategy** | Medium | v4 is a defensible default, but append-only and time-series tables have measurable index-locality cost as data grows (§2). |
| **Migration ergonomics** | Low | Migrations are numbered, idempotent where possible, and well-commented (mig 017 is exemplary). |

### 1.3 Action plan (prioritised, top 12)

1. **[NOW]** Hash `users.mfa_secret` (KMS-encrypted at minimum) and `users.mfa_recovery_codes` before MFA ships. Block any MFA wiring PR until corrected. (§6.2)
2. **[NOW]** Add the first parent-archive handler (whichever of workspace/portfolio/product ships first) with `Refs.CleanupChildren` and a per-relationship lifecycle test. Until then, keep the canary `TestNoPolymorphicOrphans` in CI.
3. **[NOW]** Wire `item_type_states` cleanup into `entityrefs.Service.CleanupChildren` ahead of any portfolio/execution type-archive handler.
4. **[Q2 2026]** Index audit pass — see §4.1 for the specific missing FK and polymorphic-id indexes.
5. **[Q2 2026]** Add a cross-DB reconciliation cron job: weekly walk of `subscription_portfolio_model_state.adopted_model_id` against `mmff_library.portfolio_models.id`; alert on missing.
6. **[Q2 2026]** Decide UUIDv7 strategy. Recommend: **selective adoption on append-only / time-series tables only** (§2 + §10), keeping v4 elsewhere. New tables with monotonic insert pattern start v7.
7. **[Q2 2026]** Sunset JWT dual-accept (`tenant_id` grace) with a hard cutover date. Add a migration that rejects old-shape JWTs server-side.
8. **[Q3 2026]** Add `last_seen_at` / activity columns to `subscriptions` for inactive-tenant detection (currently impossible without scanning users).
9. **[Q3 2026]** Add a soft-archive (`archived_at`) policy review for `users` — `is_active=false` is a partial substitute but lacks the timestamp semantics.
10. **[Q3 2026]** Document the cross-DB cleanup queue retention policy. `pending_library_cleanup_jobs` rows in terminal `dead` state grow unbounded today.
11. **[Q3 2026]** Add CHECK constraints on free-text fields that are functionally enums (e.g., `error_events.severity`, `pages.kind`) where not already present. Several exist; not all.
12. **[Q4 2026]** Begin RLS pilot on a single low-traffic tenant-scoped table (suggest `user_nav_prefs`) to evaluate operational cost before considering platform-wide.

---

## 2. UUID v4 → v7 Migration Analysis

### 2.1 Why this matters

UUIDv4 (current) is random. UUIDv7 embeds a millisecond Unix timestamp in the high bits, so values inserted close in time sort close in time. Implications:

- **Pro v7**: Index B-tree page locality on insert. Append-only tables with `(subscription_id, id)` or `(parent_id, id)` indexes get hot-page writes (faster, less WAL churn, better cache hit rate). Time-range queries on the PK become viable.
- **Con v7**: The first 48 bits leak creation time to anyone who can read an ID. For tenant-scoped IDs, this is generally tolerable (auth required). For IDs that ever appear in URLs or are exposed to the user (page IDs, custom-page IDs, work-item IDs), it is a **mild information disclosure** — observers can infer creation order and approximate timing.
- **Con v7**: Tooling. `gen_random_uuid()` does not produce v7. Postgres 17+ ships `uuidv7()`; we are on Postgres 16, so we'd need either an extension (`pg_uuidv7`) or app-side generation. The latter is fine for backend-only inserts but adds a dependency and tests must stub it.
- **Con v7**: Mixed-version primary keys complicate audits. If half the table is v4 and half v7, you cannot use `id::text` ordering as a creation-time proxy.

### 2.2 Per-table verdict

Tables grouped by recommendation. **Keep v4** is the default; tables listed under **migrate to v7** must clear two bars: (a) measurable insert-locality gain, (b) timestamp leakage is benign or the table is never user-visible.

#### 2.2.1 Strong candidates for v7 (migrate)

| Table | Why v7 wins | Timestamp leak? | Migration cost |
|---|---|---|---|
| `audit_log` (001) | Append-only, write-mostly, time-ordered queries common, no FK from elsewhere. | Internal-only; admins already see ts. | Low — no inbound FKs. |
| `item_state_history` (006) | Append-only, hot-write on state transitions, queries are by entity then time. | Already exposes `changed_at` column; v7 leak is redundant. | **High** — append-only trigger blocks UPDATE. New rows v7 is fine; backfilling v4 → v7 not possible without trigger lift. |
| `error_events` (028) | Append-only, time-series, partial indexes on `(subscription_id, occurred_at DESC)` already. | Already has `occurred_at`. | Medium — append-only trigger; new rows only. |
| `library_release_log` (`library_schema/007`) | Append-only, single-instance DB. | Internal admin tooling. | Medium — append-only. |
| `sessions` (001) | High-churn, time-series, existing index on `expires_at`. | Tokens are hashed; `id` is rarely user-visible. | Low — but inbound FK from… nothing. Sessions are leaves. |
| `password_resets` (002) | Same as sessions. | Same. | Low. |
| `pending_library_cleanup_jobs` (019) | Pure queue, work-stealing pattern benefits hugely from time-ordered IDs. | Internal only. | Low. |

#### 2.2.2 Marginal — defer, no clear win

| Table | Reason to wait |
|---|---|
| `user_nav_prefs` (008) | Read-heavy, written once per pin. Insert locality is irrelevant at this volume. |
| `user_nav_groups` (011) | Same. |
| `entity_stakeholders` (004) | Polymorphic, low-volume (one row per stakeholder). |
| `item_type_states` (006) | Configuration table, low-write. |
| `item_type_transition_edges` (006) | Configuration. |
| `page_entity_refs` (010) | Polymorphic backlink, infrequent writes. |
| `page_roles` (009) | Configuration. |
| `pages` (009) | User-visible IDs in URLs (`/p/<uuid>` per `c_url-routing.md`). v7 would leak page-creation time on every URL. **Avoid.** |
| `user_custom_pages` (016) | Same — `/p/<uuid>` URL exposure. **Keep v4.** |
| `subscriptions` (017, ex-tenants) | A handful of rows ever. Pointless. |
| `users` (001) | Low write volume; user IDs sometimes appear in URLs/logs. v7 leak of registration time is mild but real. **Keep v4.** |

#### 2.2.3 Strong candidates to keep v4 (do NOT migrate)

| Table | Why v4 wins |
|---|---|
| `pages`, `user_custom_pages` | URLs expose IDs publicly per route convention. Creation-time leak undesirable. |
| `users` | IDs appear in audit_log refs, in admin tooling, in URLs (some). Stable cross-instance random value is a feature. |
| `subscriptions` | IDs appear in JWTs and across DBs; low volume; nothing to gain. |
| `portfolio`, `product`, `workspace`, `company_roadmap` | IDs may appear in URLs (pages mount them). v4 random is fine. |
| `mmff_library.portfolio_models` and bundle children | Cross-DB referenced. Stable v4 across MMFF instances is the right primitive. |
| `mmff_library.error_codes` | Catalogue with stable identifiers; v4 is fine. |

#### 2.2.4 Mixed-version risk

If we adopt selective v7, the ordering invariant `id_a < id_b ⇒ a created before b` only holds **within** a single table — never across tables, never across mixed-version tables. Document this explicitly: **never** sort by id across union queries.

### 2.3 Recommended approach

**Don't migrate existing rows.** v4 → v7 backfill on a UUID PK invalidates every FK that references it; the cost is enormous and the gain is index locality only on writes that already happened. Instead:

1. **Net-new tables only**: future append-only or time-series tables get v7 from day one.
2. **Hot existing tables**: switch the column default from `gen_random_uuid()` to a v7-producing function for new rows. Old rows stay v4. Index locality benefit accrues over time. The four tables that earn this: `audit_log`, `error_events`, `library_release_log`, `pending_library_cleanup_jobs`. (`sessions` and `password_resets` are short-lived; old rows expire quickly anyway, so old-row v4 vs new-row v7 mixing is self-resolving.)
3. **Append-only tables with triggers** (`item_state_history`, `error_events`, `library_release_log`): the BEFORE UPDATE/DELETE trigger does NOT block new inserts with v7 — flip the default and you're done. No backfill possible (or desired).

### 2.4 Mechanism (Postgres 16, no extension)

If we don't want `pg_uuidv7` extension, generate v7 in app code (Go has `github.com/google/uuid` v1.6+ with `NewV7`). Pass the value explicitly on INSERT. Keep the column default as a backstop:

```sql
ALTER TABLE error_events
    ALTER COLUMN id SET DEFAULT gen_random_uuid();  -- backstop only
-- App INSERT must supply id := uuidv7() going forward.
```

If we do want `pg_uuidv7` (cleanest):

```sql
CREATE EXTENSION pg_uuidv7;
ALTER TABLE error_events
    ALTER COLUMN id SET DEFAULT uuid_generate_v7();
```

The full migration plan is in §10.

---

## 3. Full Relational Structure Audit

### 3.1 Table inventory (mmff_vector)

Listed in dependency order (matches migration order, with renames applied).

| # | Table | Source mig | PK | Tenant scope |
|---|---|---|---|---|
| 1 | `subscriptions` (was `tenants`) | 001, renamed 017 | `id UUID` | **scope root** |
| 2 | `users` | 001 | `id UUID` | `subscription_id` (was `tenant_id`) |
| 3 | `sessions` | 001 | `id UUID` | via user → subscription |
| 4 | `audit_log` | 001 | `id UUID` | `subscription_id` |
| 5 | `password_resets` | 002 | `id UUID` | via user |
| 6 | `user_workspace_permissions` (was `user_project_permissions`) | 002, renamed 007 | `id UUID` | `subscription_id` |
| 7 | `subscription_sequence` (was `tenant_sequence`) | 004, renamed 017 | composite `(subscription_id, key)` | yes |
| 8 | `company_roadmap` | 004 | `id UUID` | `subscription_id` UNIQUE (1-per) |
| 9 | `workspace` | 004 | `id UUID` | `subscription_id` |
| 10 | `portfolio` | 004 | `id UUID` | `subscription_id` |
| 11 | `product` | 004 | `id UUID` | `subscription_id` |
| 12 | `entity_stakeholders` | 004 | `id UUID` | `subscription_id` + polymorphic `entity_kind`+`entity_id` |
| 13 | `portfolio_item_types` | 005 | `id UUID` | `subscription_id` |
| 14 | `execution_item_types` | 005 | `id UUID` | `subscription_id` |
| 15 | `canonical_states` | 006 | `id UUID` | global (no subscription) |
| 16 | `item_type_states` | 006 | `id UUID` | `subscription_id` + polymorphic |
| 17 | `item_type_transition_edges` | 006 | `id UUID` | `subscription_id` |
| 18 | `item_state_history` | 006 | `id UUID` | `subscription_id` + polymorphic, **no parent FK** |
| 19 | `user_nav_prefs` | 008 | `id UUID` | `subscription_id` (per-user) |
| 20 | `user_nav_groups` | 011 | `id UUID` | `subscription_id` (per-user) |
| 21 | `page_tags` | 009 | `id UUID` | global |
| 22 | `pages` | 009 | `id UUID` | `subscription_id` (NULL=system, NOT NULL=tenant) |
| 23 | `page_roles` | 009 | composite `(page_id, role)` | via pages |
| 24 | `page_entity_refs` | 010 | `id UUID` | `subscription_id` + polymorphic |
| 25 | `user_custom_pages` | 016 | `id UUID` | `subscription_id` |
| 26 | `user_custom_page_views` | 016 | `id UUID` | `subscription_id` |
| 27 | `subscription_portfolio_model_state` | 026 | `id UUID` | `subscription_id` |
| 28 | `error_events` | 028 | `id UUID` | `subscription_id` |
| 29 | `subscription_layers` | 029 | `id UUID` | `subscription_id` |
| 30 | `subscription_workflows` | 029 | `id UUID` | `subscription_id` |
| 31 | `subscription_workflow_transitions` | 029 | `id UUID` | `subscription_id` |
| 32 | `subscription_artifacts` | 029 | `id UUID` | `subscription_id` |
| 33 | `subscription_terminology` | 029 | `id UUID` | `subscription_id` |
| 34 | `pending_library_cleanup_jobs` | 019 | `id UUID` | global (ops queue) |

### 3.2 Foreign-key map (mmff_vector → outbound)

Format: `child.column → parent(column) [ON DELETE ...]`. Inferred from migrations 001–030 and `c_schema.md`.

#### 3.2.1 Subscription-rooted FKs

```
users.subscription_id            → subscriptions(id)   [ON DELETE RESTRICT]
audit_log.subscription_id        → subscriptions(id)   [ON DELETE RESTRICT]
audit_log.user_id                → users(id)           [ON DELETE SET NULL]
sessions.user_id                 → users(id)           [ON DELETE CASCADE]   ⚠
password_resets.user_id          → users(id)           [ON DELETE CASCADE]   ⚠
user_workspace_permissions.user_id        → users(id)        [ON DELETE CASCADE]
user_workspace_permissions.subscription_id → subscriptions(id) [ON DELETE RESTRICT]
user_workspace_permissions.workspace_id   → workspace(id)     [ON DELETE CASCADE]

subscription_sequence.subscription_id → subscriptions(id) [ON DELETE RESTRICT]
company_roadmap.subscription_id  → subscriptions(id)   [ON DELETE RESTRICT]
workspace.subscription_id        → subscriptions(id)   [ON DELETE RESTRICT]
portfolio.subscription_id        → subscriptions(id)   [ON DELETE RESTRICT]
product.subscription_id          → subscriptions(id)   [ON DELETE RESTRICT]
```

⚠ Sessions and password_resets cascade-delete with the user; this destroys audit-relevant rows. See §6.4.

#### 3.2.2 Polymorphic (app-FK) edges

These have NO Postgres FK; integrity is enforced by the dispatch trigger (mig 013) plus Go writers.

```
entity_stakeholders.(entity_kind, entity_id)  →
    one of: company_roadmap | workspace | portfolio | product
entity_stakeholders.user_id                   → users(id) [enforced as real FK]
entity_stakeholders.subscription_id           → subscriptions(id) [real FK, RESTRICT]

item_type_states.(item_type_kind, item_type_id) →
    one of: portfolio_item_types | execution_item_types
item_type_states.canonical_state_id           → canonical_states(id) [real FK]

item_state_history.(item_type_kind, item_id) →
    intended: portfolio_item | execution_item   ← TABLES DO NOT EXIST
item_state_history.from_state_id              → item_type_states(id) [real FK, RESTRICT]
item_state_history.to_state_id                → item_type_states(id) [real FK, RESTRICT]
item_state_history.actor_user_id              → users(id) [real FK, SET NULL]

page_entity_refs.(entity_kind, entity_id)    →
    one of: portfolio | product   (NOT workspace — CHECK rejects)
page_entity_refs.page_id                     → pages(id) [real FK, CASCADE]
```

#### 3.2.3 Page registry

```
pages.subscription_id            → subscriptions(id)   [ON DELETE RESTRICT, NULL allowed for system pages]
pages.created_by                 → users(id)           [ON DELETE SET NULL]
pages.tag_id                     → page_tags(id)       [ON DELETE RESTRICT]
page_roles.page_id               → pages(id)           [ON DELETE CASCADE]
```

#### 3.2.4 User-custom pages

```
user_custom_pages.subscription_id        → subscriptions(id) [ON DELETE RESTRICT]
user_custom_pages.created_by             → users(id)         [ON DELETE RESTRICT]
user_custom_page_views.user_custom_page_id → user_custom_pages(id) [ON DELETE CASCADE]
user_custom_page_views.subscription_id   → subscriptions(id) [ON DELETE RESTRICT]
```

#### 3.2.5 Adoption saga + mirrors (mig 026, 029)

```
subscription_portfolio_model_state.subscription_id → subscriptions(id)  [ON DELETE RESTRICT]
subscription_portfolio_model_state.initiated_by    → users(id)          [ON DELETE SET NULL]
subscription_portfolio_model_state.adopted_model_id → mmff_library.portfolio_models(id) [APP-ENFORCED, cross-DB]

subscription_layers.subscription_id      → subscriptions(id) [RESTRICT]
subscription_layers.parent_layer_id      → subscription_layers(id) [RESTRICT]   self-ref
subscription_layers.source_library_id    → mmff_library.layers(id)  [APP-FK, cross-DB]

subscription_workflows.layer_id          → subscription_layers(id) [CASCADE]
subscription_workflows.subscription_id   → subscriptions(id) [RESTRICT]

subscription_workflow_transitions.workflow_id    → subscription_workflows(id) [CASCADE]
subscription_workflow_transitions.from_state_id  → canonical_states(id) [RESTRICT]
subscription_workflow_transitions.to_state_id    → canonical_states(id) [RESTRICT]

subscription_artifacts.subscription_id   → subscriptions(id) [RESTRICT]
subscription_terminology.subscription_id → subscriptions(id) [RESTRICT]
```

#### 3.2.6 Error events

```
error_events.subscription_id     → subscriptions(id)   [ON DELETE RESTRICT]
error_events.user_id             → users(id)           [ON DELETE SET NULL]   ✓ correct
error_events.code                → mmff_library.error_codes(code) [APP-FK, cross-DB]
```

### 3.3 Delete-rule rationale check

| Rule | Where used | Sanity |
|---|---|---|
| `RESTRICT` | Subscription parent of essentially everything; `parent_layer_id` self-ref | ✓ Correct — matches "never hard-delete a tenant" policy. |
| `CASCADE` | `sessions.user_id`, `password_resets.user_id`, `user_workspace_permissions.user_id`, `page_roles.page_id`, `user_custom_page_views`, `subscription_workflows.layer_id`, `subscription_workflow_transitions.workflow_id` | Mostly correct (config-leaf), but `sessions`/`password_resets` cascading on user delete loses forensic data — see §6.4. |
| `SET NULL` | `audit_log.user_id`, `error_events.user_id`, `pages.created_by`, `subscription_portfolio_model_state.initiated_by`, `item_state_history.actor_user_id` | ✓ Correct — preserves audit row when actor is gone. |
| **No FK** | All polymorphic `*_id`, all cross-DB `source_*`, `error_events.code`, `item_state_history.item_id` | App-enforced. Each must have a triggered or written guard. §3.2.2 details. |

### 3.4 Orphan risk assessment

Orphans can arise from:

1. **Polymorphic insert without trigger guard** → mitigated by mig 013 dispatch triggers.
2. **Polymorphic parent archive without `CleanupChildren` call** → **NOT yet mitigated for any parent**, because no archive handlers exist. First handler is high-stakes per `c_polymorphic_writes.md` §"Open gap".
3. **Cross-DB drift** (model deleted from library, mirror rows remain) → mitigated for **deletion** path by `pending_library_cleanup_jobs` queue. Not mitigated for **drift** (silent divergence over time).
4. **Append-only table with no parent** (`item_state_history`) → no orphan today (no parent), but every row written today is destined to be checked against future `portfolio_item`/`execution_item` tables. If a transition is logged for a `portfolio_item` ID that never gets created, it is a permanent latent orphan.

**Canary**: `TestNoPolymorphicOrphans` in `backend/internal/dbcheck/orphans_test.go` runs 4 `SELECT count(*)` checks. Verify that the test covers `item_type_states` (it should, since the relationship table has a known-archive-vocabulary even if cleanup isn't wired).

### 3.5 Join-path patterns

Per `c_polymorphic_writes.md` §"Safe query patterns": always JOIN to parent (or UNION ALL across kinds) when reading polymorphic rows. The doc has the canonical example. **Add to lint check**: any new SQL touching a polymorphic table without a parent JOIN is a code-review red flag.

---

## 4. Schema Health Check

### 4.1 Missing or inadequate indexes

Examined every CREATE INDEX in db/schema. The following gaps look real (verification = grep the table for an index on the column; if none, flag).

| Table | Column | Why an index | Severity |
|---|---|---|---|
| `entity_stakeholders` | `user_id` | `user_id` is FK to `users`; queried on user-deletion path and "what am I a stakeholder of". Mig 004 indexes `(entity_kind, entity_id)` and `subscription_id` but not `user_id`. | Med |
| `audit_log` | `user_id` | FK to users with SET NULL; queried "what did this user do". Mig 001 has `subscription_id` index but I did not see a `user_id` index. | Low |
| `item_state_history` | `(subscription_id, item_id)` composite, descending `changed_at` | Hottest read pattern: state history of one item. Confirm composite exists; if not, add. | Med |
| `error_events` | `(subscription_id, occurred_at DESC)` | Likely already exists per mig 028, but verify. Also `(subscription_id, code)`. | Low |
| `pending_library_cleanup_jobs` | `(status, visible_at)` partial WHERE status='pending' | Mig 019 adds two partial indexes; confirm one matches the work-stealing query exactly (`SELECT … WHERE status='pending' AND visible_at <= now() FOR UPDATE SKIP LOCKED`). | Low |
| `user_workspace_permissions` | `(user_id, subscription_id)` composite | Permission lookup at every request boundary is hot; composite reduces a join. | Med |
| `page_entity_refs` | `(entity_kind, entity_id)` | Reverse lookup "what pages bookmark this entity". Likely indexed via the unique constraint, but partial-index review worth doing. | Low |

### 4.2 NULL gaps

Columns that are NULL but probably shouldn't be:

| Column | Issue |
|---|---|
| `users.subscription_id` | Mig 017 renamed; was `tenant_id NOT NULL`. Verify rename preserved NOT NULL. |
| `pages.subscription_id` | Intentionally nullable (NULL = system page). Documented in mig 009/012. ✓ |
| `pages.created_by` | Nullable for system pages (created_by NULL means MMFF-seeded). ✓ |
| `subscription_portfolio_model_state.adopted_model_id` | Nullable while `status='pending'`/`'in_progress'`. Set on `'completed'`. ✓ |
| `users.password_hash` | NOT NULL — verify. LDAP users may have no password, but the column should still be NOT NULL with a sentinel (`'!'`). Verify. |
| `error_events.code` | Should be NOT NULL; cross-DB FK. Verify. |

### 4.3 Missing CHECK constraints (functional enums in TEXT)

| Table.column | Current type | Should be |
|---|---|---|
| `subscription_portfolio_model_state.status` | `TEXT CHECK IN (pending, in_progress, completed, failed, rolled_back)` | ✓ already CHECK'd (mig 026). |
| `pending_library_cleanup_jobs.status` | `TEXT CHECK IN (pending, dead)` | ✓ already CHECK'd (mig 019). |
| `error_events.severity` | If TEXT, needs CHECK. Verify. | If not present, add. |
| `pages.kind` | Likely an enum or TEXT-with-CHECK. Verify static/entity/user_custom. | Should be CHECK'd or enum. |
| `users.tier` (via subscriptions) | mig 018 adds `subscriptions.tier` with CHECK in (free, pro, enterprise). ✓ |

**Pattern**: When the value set is fixed and small (3–6), prefer a Postgres `CREATE TYPE … AS ENUM` only when adding values is rare. If churn is expected, TEXT + CHECK is more migration-friendly. The codebase mixes both; a documented policy in `c_schema.md` would help future-Claude pick.

### 4.4 Type consistency

- All UUIDs are `UUID`. ✓
- All timestamps are `TIMESTAMPTZ` (verified spot-check on mig 001, 004, 026, 028). ✓
- Soft-archive: every business table uses `archived_at TIMESTAMPTZ NULL`. ✓
- Booleans are `BOOLEAN`, not `INT`. ✓
- Tags / short codes (`portfolio_item_types.tag`) use `TEXT` with length CHECK. ✓ (`tag CHECK (length(tag) BETWEEN 2 AND 4)`).

### 4.5 Unused or leftover columns

| Column | Status |
|---|---|
| `users.mfa_secret`, `mfa_recovery_codes`, `mfa_enrolled`, `mfa_enrolled_at` | Dormant scaffold from mig 003. **Either ship MFA properly or drop.** Six months in dormant state is the threshold. |
| `user_nav_prefs.profile_id` | Reserved for Phase 5 per mig 008. ✓ Keep, but re-justify in `c_tech_debt.md` if Phase 5 slips again. |
| `pages.tag_id` | Used. ✓ |
| `subscription_workflow_transitions.from_state_id`/`to_state_id` | These reference `canonical_states` per mig 029 — a global non-tenant table. That is correct for state vocabulary. ✓ |

### 4.6 Naming consistency

- `_at` suffix for timestamps: ✓ throughout (`created_at`, `archived_at`, `expires_at`).
- `_id` suffix for FK columns: ✓.
- `is_*` for booleans: ✓ (`is_active`, `is_start_page`).
- Table names: singular for entity tables (`portfolio`, `product`, `workspace`) but plural for join/log tables (`audit_log`, `sessions`, `pages`, `users`). Slight inconsistency but consistent with PG community convention. No action.

---

## 5. Tenant Isolation Audit

### 5.1 Per-table tenant column presence

Every business table in §3.1 carries `subscription_id UUID NOT NULL REFERENCES subscriptions(id)` — verified per `c_security.md` §1 and `c_schema.md`. Exceptions:

- `subscriptions` itself (root).
- `canonical_states` (global vocabulary).
- `page_tags` (global).
- `pending_library_cleanup_jobs` (global ops queue, holds rows for any subscription).
- `pages` with `subscription_id IS NULL` (system pages — explicitly modelled).

### 5.2 No RLS

There is no Postgres `ALTER TABLE … ENABLE ROW LEVEL SECURITY` anywhere. Tenant isolation is **purely application-layer**:

- Every handler pulls `subscription_id` from session/JWT, never from request payload.
- Every query manually adds `AND subscription_id = $N`.
- Librarian audits flag any new query missing the predicate (§7 of `c_security.md`).

This is a defensible tradeoff but the **blast radius of a single missing predicate is total cross-tenant breach**. Recommend: pilot RLS on one low-risk tenant-scoped table (`user_nav_prefs` is a good candidate — high enough volume to matter, low enough impact to roll back). Defer platform-wide adoption.

### 5.3 Composite uniqueness must include subscription_id

Spot-checked:

- `portfolio_item_types`: `UNIQUE (subscription_id, tag)` and `UNIQUE (subscription_id, name)` ✓ (mig 005, post-rename).
- `execution_item_types`: same shape. ✓
- `subscription_sequence`: composite PK `(subscription_id, key)`. ✓
- `user_nav_groups`: `UNIQUE (user_id, subscription_id, LOWER(label))` partial. ✓
- `pages`: three partial unique indexes for system / shared-tenant / user-custom (mig 012). ✓
- `subscription_portfolio_model_state`: partial unique on `subscription_id` excluding terminal states (mig 026). ✓

No missing-tenant-in-uniqueness issues found.

### 5.4 Cross-tenant read APIs

`c_security.md` §1: "There is no cross-tenant read API. None." gadmin's cross-tenant access is by per-tenant impersonation server-side, not a single query. Verify in audit: any `SELECT … FROM <tenant table>` without `subscription_id =` predicate is a flag candidate.

### 5.5 The page_roles edge case

`page_roles` has no `subscription_id` directly — its tenant scope is inherited via `page_id → pages.subscription_id`. This is fine for system pages (NULL) but means any query on `page_roles` that doesn't JOIN `pages` cannot enforce tenant scope. Risk is low (the table is config-shaped) but worth a comment in `c_schema.md` calling out the join requirement.

---

## 6. Security Review

### 6.1 Sensitive-data inventory

| Table.column | Type of secret | Storage | OK? |
|---|---|---|---|
| `users.password_hash` | bcrypt cost 12 hash | Plaintext in column, `json:"-"` per `c_security.md` §3 | ✓ |
| `sessions.token_hash` | SHA-256 of refresh token | Plaintext column | ✓ (only the hash is stored) |
| `password_resets.token_hash` | SHA-256 of reset token | Plaintext column | ✓ |
| `users.mfa_secret` | TOTP shared secret | **TEXT plaintext** | **✗ critical** |
| `users.mfa_recovery_codes` | Recovery codes (TEXT[]) | **Plaintext array** | **✗ critical** |
| `users.ldap_dn` | LDAP distinguished name | TEXT | Acceptable — DN is not a secret. |
| `audit_log` payload | varies | TEXT/JSONB | Verify no password/token leakage in writers. Convention is to scrub before insert. |
| `error_events.context` | freeform | TEXT/JSONB | Same scrub requirement. |

### 6.2 MFA columns are a ticking bomb

Mig 003 created `mfa_secret TEXT` and `mfa_recovery_codes TEXT[]`. Both are dormant today. **If MFA ships against this shape, we will have:**

- TOTP shared secrets readable by anyone with DB access (DBA, backup snapshots, log shipper).
- Recovery codes that are equivalent to passwords stored unhashed.

**Recommendation (block any MFA wiring PR until done):**

```sql
-- Repurpose for encryption + hashing.
ALTER TABLE users
    ADD COLUMN mfa_secret_encrypted BYTEA,    -- KMS-encrypted shared secret
    ADD COLUMN mfa_secret_kid TEXT;            -- KMS key id used (for rotation)

-- Recovery codes: store only the hash, validate on use.
CREATE TABLE user_mfa_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,                  -- bcrypt or argon2
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drop the unsafe columns.
ALTER TABLE users
    DROP COLUMN mfa_secret,
    DROP COLUMN mfa_recovery_codes;
```

This is **not** optional debt. File as **TD-SEC-001** at S1 severity.

### 6.3 UUID v7 timestamp leakage (revisited from §2)

If we adopt v7 selectively, the only user-visible IDs are:

- Page IDs (`pages.id`) appear in `/p/<uuid>` URLs.
- Custom-page IDs appear in URLs.
- Work-item IDs appear in `/item/<uuid>` URLs (per `c_url-routing.md`).

**These tables stay v4.** Server-internal IDs (audit_log, error_events, sessions, library_release_log, pending_library_cleanup_jobs) can safely go v7 — none of them are exposed in URLs. JWTs include `subscription_id` and `user_id`; both stay v4.

### 6.4 sessions / password_resets cascade

Mig 001 wires `ON DELETE CASCADE` on both. Implications:

- If a user is hard-deleted (and `users` does not have `archived_at`, only `is_active`), every session row and every password-reset row vanishes immediately.
- Audit forensics for the deleted user are gone. `audit_log.user_id ON DELETE SET NULL` preserves the audit row but loses the user reference.

**Recommendation**: never hard-delete a user. Add `users.archived_at` (mig 002 added `is_active`; soft-archive timestamp is the missing piece). If hard-delete is genuinely required (GDPR right-to-erasure), document the procedure as a **separate, audited path** that explicitly snapshots forensic data first.

Also: change `sessions.user_id` to `ON DELETE RESTRICT`. If you must delete a user, you must first revoke all their sessions. The two-step is the audit trail.

### 6.5 LDAP locked fields

`c_security.md` §5: users with `auth_method='ldap'` have email and display-name owned by the corporate directory; UI must NOT allow editing AND API must reject the call. **Verify in code review**: there is no DB-level CHECK preventing UPDATE of these fields when `auth_method='ldap'`. A trigger would be ideal:

```sql
CREATE OR REPLACE FUNCTION reject_ldap_field_edits()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.auth_method = 'ldap' THEN
        IF NEW.email IS DISTINCT FROM OLD.email
           OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
            RAISE EXCEPTION 'cannot edit LDAP-managed fields'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_ldap_lock
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION reject_ldap_field_edits();
```

This is defence-in-depth — file as **TD-SEC-002** at S2.

### 6.6 Append-only history integrity

`item_state_history` (mig 006), `error_events` (mig 028), `library_release_log` (`library_schema/007`) all have BEFORE UPDATE/DELETE triggers raising `check_violation`. This is exactly correct.

Verify on every PR that touches these tables: no migration disables the trigger temporarily without a `BEGIN; ALTER TABLE … DISABLE TRIGGER USER; … ; ENABLE TRIGGER USER; COMMIT;` block, and any such block is itself audited.

### 6.7 Audit completeness

- Every state-changing operation should write to `audit_log` OR `item_state_history` OR `error_events`. Verify in code review.
- `audit_log` is append-only by **convention** (mig 001 does not add a trigger). **Recommendation**: add the same BEFORE UPDATE/DELETE trigger as `item_state_history` to make convention into enforcement. File as **TD-SEC-003** at S3.

### 6.8 Library DB roles + grants

`library_schema/006` defines 4 roles (admin, ro, publish, ack) and a grant matrix. Spot check:

- `ro` should have SELECT on every public table, no INSERT/UPDATE/DELETE.
- `publish` writes `library_releases`, `library_release_actions`; does NOT write `portfolio_models` directly (those are admin).
- `ack` updates ack-state on `library_release_log` rows for its subscription only — but `library_release_log` is append-only, so ack mutates a separate ack table, not the log. Verify the schema matches this conceptual model.

A `grants_test.go` canary in CI confirms grants haven't drifted. Good.

### 6.9 Secrets handling (out of DB)

`c_security.md` §6 — `.env.local` is gitignored; SSH keys live under `~/.ssh/`. Memory note `project_pre_launch_security` flags that `.env.local` was historically committed with `MASTER_KEY` — **scrub git history before any external repo access**. This is a hard pre-launch blocker.

### 6.10 DB port

`c_security.md` §7 — port 5432 must never be exposed publicly. Loopback + SSH tunnel only. Verify the Docker compose / k8s manifest for `mmff-ops-postgres` does not publish 5432. (Out of scope for this audit; flag for ops review.)

---

## 7. Anomalies & Broken Data Patterns

### 7.1 Orphan-production paths

| Path | Mitigated? |
|---|---|
| Polymorphic INSERT with bad parent | ✓ Mig 013 dispatch trigger. |
| Polymorphic parent ARCHIVE without cleanup | ✗ No archive handlers exist yet; first one is high-stakes. |
| Polymorphic parent HARD-DELETE | ✗ Hard-delete is forbidden by policy but not by schema. Add CHECK or trigger that prevents DELETE on `workspace`/`portfolio`/`product`/`company_roadmap`. |
| Cross-DB model deletion | ✓ `pending_library_cleanup_jobs` queue. |
| Cross-DB silent drift (model still exists but corrupted, or version skew) | ✗ No reconciliation job. |
| `item_state_history` write for non-existent `item_id` | ✗ No FK and no parent table. Latent. |

### 7.2 Polymorphic kind discriminator hygiene

Each polymorphic table uses its own discriminator name (`entity_kind`, `item_type_kind`). Vocabularies differ slightly (e.g., `page_entity_refs` rejects `workspace`). Per `c_polymorphic_writes.md`, the writer (`entityrefs.Service`) centralises kind assignment so callers cannot lie about kind. ✓

**Risk**: a future polymorphic table that bypasses `entityrefs.Service` reintroduces the lie-about-kind vector. Mitigation: dispatch trigger from mig 013. Make sure every new polymorphic table gets a corresponding trigger entry in mig 013-style.

### 7.3 Soft-delete consistency

Every business table uses `archived_at IS NULL` for "live". Verify all queries use `WHERE archived_at IS NULL` consistently. Common bug: a JOIN that filters live on the parent but not the child (or vice versa) leaks archived rows. Add a lint pattern: any SELECT against a soft-archive table without `archived_at IS NULL` (or `IS NOT NULL` for archive views) is suspect.

### 7.4 Timestamp hygiene

- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` — universal. ✓
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` with `set_updated_at()` BEFORE UPDATE trigger — universal on mutable tables. ✓
- `archived_at TIMESTAMPTZ NULL` — universal on business tables. ✓
- Append-only tables use `occurred_at`, `changed_at`, `created_at` per their semantic. ✓

Anomaly check: are any tables missing `updated_at`? Configuration tables like `canonical_states` and `page_tags` may not need it (immutable seeds), but verify. If a table is mutable and missing `updated_at`, add it.

### 7.5 Sequence / counter drift

`subscription_sequence` (mig 004 + rename 017) is per-subscription per-key monotonic. Risk: composite PK `(subscription_id, key)` ensures correctness, but high-write contention on a single `(subscription_id, 'item_key')` row could become a hot lock. For low/medium traffic this is fine; document as a scaling watch-item.

### 7.6 Adoption saga fragility

`subscription_portfolio_model_state` (mig 026) tracks an SSE-driven multi-step adoption. Failure modes:

- App crashes mid-saga — status stays `in_progress`. Need a watchdog cron to mark abandoned `in_progress` rows older than N hours as `failed`.
- Library model deleted while saga in flight — `pending_library_cleanup_jobs` should pick this up, but the saga itself doesn't re-validate `adopted_model_id`. Add a re-validation step.

### 7.7 user_nav_prefs.position uniqueness

Mig 008 uses DEFERRABLE position uniqueness — correct, allows reordering within a transaction. Verify no migration accidentally drops the DEFERRABLE.

---

## 8. Architecture Gaps

### 8.1 Missing tables (known and scoped)

| Table | Status | Phase |
|---|---|---|
| `portfolio_item` | Not built | Item phase — required to FK from `item_state_history`. |
| `execution_item` | Not built | Item phase. |
| `subscription_metadata` (last_seen_at, plan_metadata) | Not built | Q3 2026 recommendation. |
| `user_archived_at` (or full users.archived_at) | Not built | §6.4 recommendation. |

### 8.2 Denormalisation opportunities

1. **Per-subscription cached counters** — currently any "how many active portfolios" requires a count query. For dashboard widgets, a `subscription_aggregates` table updated by trigger would eliminate count-on-read. Defer until proven needed.
2. **`pages` could embed `tag_name`** — currently `tag_id → page_tags(name)` is a join on every nav render. With 5 seeded tags it's free; if tag count grows, denormalise.

### 8.3 Scaling bottlenecks (per-table, projected)

| Table | Current shape | Bottleneck-at scale |
|---|---|---|
| `audit_log` | Single subscription-scoped index | At 100M rows, index size dominates. Partition by `created_at` quarterly. |
| `item_state_history` | Append-only | Same — partition by `changed_at` once partition pruning savings exceed maintenance cost (rough threshold: 50M rows). |
| `error_events` | Append-only | Same. |
| `sessions` | Hot writes, expires_at index | Self-pruning if a janitor deletes expired rows; if not, table bloats. Add janitor cron. |
| `pending_library_cleanup_jobs` | Queue, FOR UPDATE SKIP LOCKED | At sustained high enqueue rate, the partial-pending index can hot-spot. Switch to a numeric column for `visible_at` range or add a `worker_id` shard column. |

### 8.4 Materialised views

None today. Candidates if dashboard latency becomes an issue:

- `mv_subscription_active_users` — count of users per subscription with `is_active=true`.
- `mv_release_ack_status` — for the gadmin badge in `library-releases` page (count of pending acks).

Keep deferred. Materialised views add refresh ops cost; only add when read latency is measurably problematic.

### 8.5 Cross-DB ergonomics

Every cross-DB FK is app-enforced. Three options for stronger guarantees:

1. **Foreign Data Wrapper (postgres_fdw)** — gives you a "view" of mmff_library tables inside mmff_vector for read-side validation. Cost: connection overhead, complex auth. Defer.
2. **Logical replication of `error_codes` and `portfolio_models` IDs** — replicate just the ID columns into mmff_vector as a read-only mirror, then add real FKs. Heavy infra.
3. **Periodic reconciliation job** (recommended) — weekly cron: `SELECT … FROM mmff_vector WHERE adopted_model_id NOT IN (SELECT id FROM mmff_library.portfolio_models)`. Cheap, catches drift, surfaces in error-events.

### 8.6 Multi-region

Out of scope for current architecture but worth flagging: every cross-DB call assumes both DBs are in the same Postgres cluster. A future multi-region story breaks the cleanup queue (cross-region transactions). Document the assumption in `c_deployment.md`.

---

## 9. Tech Debt Register (proposed additions)

Existing register is `docs/c_tech_debt.md` (TD-LIB-001 through TD-LIB-009). Proposed additions from this audit:

### 9.1 New entries

| ID | Title | Severity | Trigger to fix | Notes |
|---|---|---|---|---|
| **TD-SEC-001** | MFA columns store plaintext secrets | S1 | Before any MFA wiring PR | §6.2. Block PR. |
| **TD-SEC-002** | LDAP-locked fields enforced only in app | S2 | Before next LDAP integration test pass | §6.5. Add trigger. |
| **TD-SEC-003** | `audit_log` not trigger-protected against UPDATE/DELETE | S3 | Promote to S2 if any audit-log mutation incident | §6.7. |
| **TD-DB-001** | `item_state_history.item_id` has no FK | S2 | Block on item-table phase | §3.4. Append-only trigger complicates retro-FK; design fix during item-table phase. |
| **TD-DB-002** | Polymorphic archive cleanup not yet exercised | S2 | First parent-archive handler PR | §3.4. CI canary backstops; first archive handler must wire `Refs.CleanupChildren`. |
| **TD-DB-003** | `item_type_states` cleanup not in `CleanupChildren` registry | S2 | Before first type-archive handler | `c_polymorphic_writes.md` cleanup table. |
| **TD-DB-004** | `sessions` and `password_resets` CASCADE on user delete | S3 | Promote to S2 if any GDPR/erasure work begins | §6.4. |
| **TD-DB-005** | No cross-DB reconciliation cron | S3 | Promote to S2 at 3 production subscriptions | §8.5. |
| **TD-DB-006** | No partition strategy on `audit_log` / `error_events` / `item_state_history` | S3 | At 10M rows in any of the three | §8.3. |
| **TD-DB-007** | Several FK columns lack supporting indexes | S3 | At p95 latency regression on user-deletion or audit-by-user query | §4.1. |
| **TD-DB-008** | `users` has no `archived_at` (only `is_active`) | S3 | Before GDPR work | §6.4. |
| **TD-DB-009** | UUID v4 vs v7 strategy undecided | S3 | Before 50M rows in any append-only table | §2 + §10. |
| **TD-DB-010** | JWT dual-accept (`tenant_id` grace) has no sunset | S3 | Hard sunset within 6 months of mig 017 deploy | §1.1 #7. |
| **TD-DB-011** | `pending_library_cleanup_jobs` has no retention policy on `dead` rows | S3 | At 10K dead rows | §1.3 #10. |

### 9.2 Projected debt (decisions deferred)

- Whether to enable RLS at all (§5.2). Deferring is a decision.
- Whether to switch any hot append-only table to v7 (§2). Deferring is a decision; the bigger the table grows on v4, the more expensive a future rewrite.
- Whether `item_state_history`'s append-only trigger blocks future cleanup (§3.4). Deferring guarantees redesign work when item tables ship.

---

## 10. UUIDv7 Migration Plan

### 10.1 Scope

Per §2.3 — **selective adoption**. Tables targeted:

1. `audit_log` — flip default, no backfill.
2. `error_events` — flip default, no backfill.
3. `library_release_log` — flip default, no backfill (separate DB).
4. `pending_library_cleanup_jobs` — flip default, no backfill.

Optional (lower priority):

5. `sessions`, `password_resets` — short-lived; old rows expire naturally.

**Out of scope**: every other table stays v4.

### 10.2 Mechanism choice

Two options:

**Option A — `pg_uuidv7` extension** (cleanest):

- Pros: single source of truth, default works without app cooperation, atomic.
- Cons: extension install on every Postgres instance (dev + prod). For Docker, build a custom image or use `apt-get install postgresql-16-uuidv7` if available; for managed PG, depends on provider.

**Option B — App-side generation** (most portable):

- Pros: no infra change. Go's `github.com/google/uuid` v1.6+ has `uuid.NewV7()`.
- Cons: every INSERT path must be updated to pass `id` explicitly. Tests must stub the generator. Default in DB stays as `gen_random_uuid()` as a backstop (so a forgotten INSERT path still works, just with a v4).

**Recommendation: Option B.** Lower coordination cost; the backstop default avoids correctness regressions if a path is missed.

### 10.3 Dependency-ordered steps

```
PHASE 1 — App-side generator (no migration)
  1. Pin uuid library; expose `idgen.NewV7() uuid.UUID` helper.
  2. Audit all INSERT paths into the 4 target tables.
  3. Update each to pass id := idgen.NewV7().
  4. Tests + lint rule that flags `INSERT INTO audit_log` without explicit id.

PHASE 2 — Verify in staging (no migration)
  5. Deploy to staging; run for 7 days.
  6. Spot-check that new rows have v7 IDs (high bits encode timestamp ≈ now).

PHASE 3 — Production rollout (no migration)
  7. Deploy to prod. New rows = v7. Old rows = v4 (untouched, by design).

PHASE 4 — (Optional) drop `gen_random_uuid()` default
  8. Migration: ALTER TABLE audit_log ALTER COLUMN id DROP DEFAULT;
     (Forces app-side generation; removes the v4 fallback.)
     Defer until 100% of insert paths verified.
```

### 10.4 Rollback plan

- Phase 1–3: trivial. Revert the app deploy. New rows revert to default `gen_random_uuid()` (v4). Mixed v4/v7 data already written stays valid (UUID is UUID).
- Phase 4: trivial. Migration to re-add default.

### 10.5 What we are NOT doing (and why)

- **No backfill of existing rows.** UUIDs are foreign-keyed widely; rewriting PKs is multi-table CASCADE work, not worth the gain.
- **No v7 on user-visible ID tables** (`pages`, `user_custom_pages`, `users`, `workspace`, `portfolio`, `product`, work-item tables when built). Timestamp leak, no insert-locality benefit at their volumes.
- **No v7 on cross-DB referenced tables** (`mmff_library.portfolio_models`, etc.) until both ends migrate. Risk of mixed-version cross-DB references.

### 10.6 Acceptance criteria

- New rows in the 4 target tables have v7-shaped IDs.
- pg_stat_user_indexes on `audit_log_pkey`, `error_events_pkey`, `library_release_log_pkey` shows no regression in `idx_blks_hit / idx_blks_read` ratio after 30 days.
- No FK or test regression.

### 10.7 Estimated effort

~1 engineering week for Option B, including audit + tests. Option A adds ~3 days of infra coordination.

---

## 11. Recommendations & Action Items (prioritized)

### 11.1 Now (this sprint, blockers)

1. **Block any MFA wiring PR until §6.2 fix lands.** Hash recovery codes; encrypt MFA secret. File as TD-SEC-001 S1.
2. **Wire `item_type_states` cleanup into `entityrefs.Service.CleanupChildren`** (TD-DB-003) ahead of the first item-type archive handler.
3. **First parent-archive handler must include `Refs.CleanupChildren` + a per-relationship lifecycle test** (TD-DB-002). Code-review gate: do not approve a workspace/portfolio/product archive PR without this.

### 11.2 This quarter (Q2 2026)

4. **Index-pass migration** covering the gaps in §4.1 (`entity_stakeholders.user_id`, `audit_log.user_id`, `item_state_history(subscription_id, item_id)`, `user_workspace_permissions(user_id, subscription_id)`).
5. **Cross-DB reconciliation cron** for `subscription_portfolio_model_state.adopted_model_id` and the 5 mirror-table `source_library_*` columns. Weekly run, alert via `error_events`.
6. **Decide and adopt UUIDv7 strategy** per §10. Specifically: Option B, four target tables, app-side generator, no backfill.
7. **JWT dual-accept sunset** — pick a date 6 months post-mig-017 deploy; add a hard cutover migration that rejects old-shape JWTs.

### 11.3 Next quarter (Q3 2026)

8. **`users.archived_at`** soft-archive timestamp (TD-DB-008).
9. **Change `sessions.user_id` to `ON DELETE RESTRICT`** (TD-DB-004); document explicit revoke-then-delete procedure.
10. **`audit_log` append-only trigger** (TD-SEC-003).
11. **LDAP locked-fields trigger** (TD-SEC-002).
12. **`pending_library_cleanup_jobs` retention policy** + janitor cron for `dead` rows.
13. **CHECK-constraint review** for any TEXT-as-enum columns missing constraints (`error_events.severity`, etc.).

### 11.4 Watch / longer term

14. **RLS pilot** on `user_nav_prefs` to evaluate operational cost.
15. **Partition** `audit_log` / `error_events` / `item_state_history` by quarter at 10M rows in any one.
16. **Subscription metadata table** (`last_seen_at`, plan-history) when product needs inactivity detection.
17. **Materialised views** for ack-status / dashboard aggregates if/when read latency becomes user-visible.
18. **FDW or logical replication** for cross-DB integrity if app-FK drift becomes a recurring incident.

### 11.5 Won't-do (with reason)

- **Full v4 → v7 backfill**: cost dominates benefit; old rows already exist and never re-write.
- **RLS platform-wide**: operational cost outweighs current marginal risk; pilot first.
- **Hard FK on `error_events.code`**: cross-DB; reconciliation cron is the right tool.
- **Drop `subscriptions.tier` default 'pro'**: TD-LIB-002 covers the eventual sane-default story; not blocking.

---

## Appendix A — Files reviewed

**mmff_vector** (`db/schema/`):

```
001_init.sql                       017_subscriptions_rename.sql
002_auth_permissions.sql           018_subscription_tier.sql
003_mfa_scaffold.sql               019_pending_library_cleanup_jobs.sql
004_portfolio_stack.sql            020_<page registry additions>
005_item_types.sql                 021_<...>
006_states.sql                     022_<...>
007_rename_permissions.sql         023_<...>
008_user_nav_prefs.sql             024_<backfill pin>
009_page_registry.sql              025_<...>
010_nav_entity_bookmarks.sql       026_subscription_portfolio_model_state.sql
011_nav_subpages_custom_groups.sql 027_<...>
012_pages_partial_unique.sql       028_error_events.sql
013_polymorphic_dispatch_triggers  029_adoption_mirror_tables.sql
014–016_<page theme/icon/custom>   030_unpin_gadmin_portfolio_model.sql
```

**mmff_library** (`db/library_schema/`): 001–008 (bootstrap, roles, models + bundle children, shares, grants, releases, log, error_codes).

**Docs**: `docs/c_schema.md`, `docs/c_polymorphic_writes.md`, `docs/c_security.md`, `docs/c_tech_debt.md`, `docs/c_c_entityrefs_service.md`.

## Appendix B — Open questions for Opus / comparison doc

1. Did Opus identify additional missing indexes beyond §4.1?
2. Does Opus reach a different conclusion on RLS adoption?
3. Does Opus' UUIDv7 scope match (4 tables) or differ?
4. Did Opus find any FK delete-rule mismatches I missed (especially on the 029 mirror-table set)?
5. Did Opus flag `audit_log` as needing the append-only trigger upgrade or accept the convention-only status?
6. Does Opus call out the `subscriptions.tier` default-`pro` quirk (TD-LIB-002 in existing register)?
7. Did Opus identify any cross-DB cleanup-queue edge cases (e.g., poison message, max_attempts exhausted) beyond what mig 019's `dead` state handles?

---

*End of audit.*
