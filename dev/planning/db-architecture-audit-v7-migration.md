# MMFFDev Vector — Database Architecture Audit & UUID v7 Migration Plan

> **Date:** 2026-04-25
> **Scope:** `mmff_vector` (29 applied migrations: 001–026, 028–030; 027 skipped) + `mmff_library` (8 migrations: 001–008) + all seeds + `db/ops/`.
> **Audit method:** every file in `db/schema/`, `db/library_schema/`, `db/seed/`, `db/library_schema/seed/`, and `db/ops/` was read. Cross-checked against `docs/c_schema.md` (verified live 2026-04-25), `docs/c_polymorphic_writes.md`, `docs/c_security.md`, `docs/c_tech_debt.md`, `docs/c_c_schema_adoption_mirrors.md`.
> **Author posture:** senior SaaS architect / DBA; ground-truth from migration files and live-snapshot docs, not assumptions. Where I infer, I say so.

---

## §1. Executive Summary

MMFFDev Vector is a multi-database Postgres 16 application: `mmff_vector` (the per-subscription business DB) and `mmff_library` (a read-mostly content library populated by MMFF release artifacts). The schema is well-structured for an early-stage SaaS — hard tenant boundary at `subscription_id`, soft-archive throughout, partial unique indexes on live rows, append-only history for state changes, layered enforcement (DB CHECK + dispatch triggers + Go writer service) on polymorphic FKs.

The **dominant architectural risk is cross-DB referential integrity**. Postgres has no cross-DB FKs. Five separate features now lean on app-enforced, cross-DB references (adoption pointer, error-code catalogue, five adoption-mirror tables, library cleanup queue, library shares) — each with its own variant of the same writer-validate / reconciler-sweep contract, and none of them yet has its writer in production. The next 2–3 months of feature work will land all of those writers more or less simultaneously. Without a single shared cross-DB writer service and a working reconciler, this is a guaranteed data-quality incident.

The **secondary risk is identity & auth posture for production**. The schema has the right shapes (bcrypt 12, sha256 token hashes, append-only audit, locked LDAP fields), but ships with hardcoded development bcrypt hashes for `gadmin`/`padmin`/`user` (`001_init.sql:118-140`) and a fixed UUID for the default subscription/tenant (`00000000-0000-0000-0000-000000000001`). Any production deployment must scrub these. There is also a confirmed `.env.local` git-history exposure in scope under the project's own `project_pre_launch_security` memory entry.

**Headline recommendations** (full prioritised list in §11):

1. **Defer the v7 migration** until after the cross-DB writer/reconciler ships. v4 → v7 is an *enhancement* (better B-tree locality, debuggable timestamps); none of the open S1/S2 issues are caused by v4. Rolling v7 in *now* increases blast radius without retiring debt. Schedule it as a Phase-5 pay-down once the cross-DB integrity story is closed.
2. **Centralise cross-DB writes** behind one Go service (extend `backend/internal/entityrefs` or sibling). Today there are 5 prospective writer paths each with their own validation contract — impossible to test as a system.
3. **Promote `audit_log` to append-only-by-trigger.** Today it is append-only by *convention* only (per `c_security.md §4`). `item_state_history` and `error_events` already have BEFORE UPDATE/DELETE triggers — copy that pattern.
4. **Wire the `pending_library_cleanup_jobs` worker before the first writer ships.** This is the *only* mechanism that prevents adopt/archive sagas from leaving cross-DB orphans. Per TD-LIB-003 the table has been waiting since migration 019.
5. **Introduce Row-Level Security (RLS)** keyed on `subscription_id` as a defence-in-depth layer for tenant isolation. Today every handler hand-rolls `WHERE subscription_id = $1` — one missed predicate is a cross-tenant leak. The librarian's `c_security.md` workflow is the cap; RLS is the pay-down.
6. **Repair `db/ops/cleanup_perm_test_tenants.sql`** — it still references `tenants`/`tenant_id` post-017 rename. It will fail to run.
7. **Document and enforce a single migration-numbering invariant.** `027_*.sql` is missing from disk despite `c_schema.md` not flagging it as a gap; this is silent drift that needs a checked invariant (CI canary: assert `db/schema/NNN_*.sql` is contiguous).

---

## §2. UUID v4 → v7 Migration Analysis

### 2.1 Background

Every UUID column in both databases is generated via `gen_random_uuid()` (Postgres `pgcrypto`), which produces RFC-4122 v4 UUIDs (122 bits of randomness). UUID v7 (draft RFC, finalised 2024) embeds a 48-bit Unix timestamp in milliseconds in the high-order bits, yielding **time-ordered, lexicographically-sortable UUIDs** that preserve cryptographic uniqueness. v7 generation is not yet shipped in core Postgres (16.x); options are:

- **`pg_uuidv7` extension** (most common) — `uuidv7()` SQL function; extension must be installed on every replica.
- **Application-side generation** (Go: `github.com/google/uuid` v1.6+) — backend writes the UUID; DB column drops the `DEFAULT gen_random_uuid()`.
- **Hybrid** — extension function as DEFAULT, app generates when it needs the timestamp.

### 2.2 General pros & cons (apply to every table)

**Pros:**

- **B-tree locality.** New rows insert at the right edge of the index. Lower index fragmentation, fewer leaf splits, better cache behaviour. For `audit_log`, `error_events`, `item_state_history` (append-heavy, timestamp-ordered reads), this is meaningful — read patterns like *"last N events for subscription"* go from random-IO scans to sequential scans.
- **Implicit creation-order without `created_at`.** A v7 UUID's first 48 bits ARE the millisecond timestamp; range queries like `WHERE id >= '...'` are equivalent to time ranges.
- **Better debuggability.** UUIDs in logs are sortable; an engineer can eyeball relative recency.
- **Smaller composite indexes.** Many `(subscription_id, created_at DESC)` indexes (e.g. `idx_error_events_subscription_occurred`) become redundant if the PK is already time-ordered.

**Cons / risks:**

- **Information leakage via timestamp.** A v7 UUID exposes its creation millisecond. For most rows this is fine (the row is already accessible via `created_at`), but for sensitive types this is a *new* side-channel. Specifically, password-reset-token IDs and session IDs get timing inferences they did not previously expose. Severity is low because the existing `token_hash` column is what authenticates — but a row's *existence* and *timing* leaks to anyone who can read it.
- **Migration cost.** Rewriting every PK across 35+ tables, plus every FK that references those PKs, plus every cross-DB app-enforced FK, plus every seeded constant UUID. The migration must rewrite both DBs in lockstep with a foreign-row-id translation table maintained for the duration.
- **External system contracts.** Any consumer (Planka, future API consumers, frontend permalinks `/item/<uuid>`, library release artifacts that ship pre-baked UUIDs) holds existing v4 UUIDs. The migration must keep existing UUIDs unchanged — only *new* rows get v7. This makes it **additive, not transformative** (good), but requires that the column type remain `UUID` and the v7-ness becomes a property of the generator only.
- **Library seed UUIDs are hardcoded.** `db/library_schema/seed/001_mmff_model.sql` hardcodes `00000000-0000-0000-0000-00000000a000` (model family), `0…aa01` (model id v1), `0…ab01..ab05` (layers), `0…ac11..ac53` (workflow states). These deterministic UUIDs are *intentional* — release artifacts re-run with `ON CONFLICT DO NOTHING` and reuse them as stable references. Switching to v7 for these tables would require either preserving the existing rows verbatim or coordinating a one-time hard-cutover of every dependent reference.
- **No standard `pg_uuidv7`.** Until a Postgres core release ships UUID v7 generation natively, the migration ties operations to an extension that must be installed on every replica/backup-restore target. As of Postgres 17 the extension is not in core; expected in 18.

### 2.3 Per-table analysis

Format: **table** — verdict (✅ migrate / 🟡 migrate-with-care / ❌ don't migrate / ⚪ no UUID PK) — rationale.

#### `mmff_vector`

| Table | Verdict | Rationale |
|---|---|---|
| `subscriptions` | ❌ don't migrate the seed row; ✅ for new rows | The default tenant UUID `00000000-0000-0000-0000-000000000001` is hardcoded in `001_init.sql:115`, the trigger seed `001_default_workspace.sql:312`, and likely in test fixtures. Preserve it. New subscriptions: ✅ — low write rate, no cardinality benefit, but consistency aids debugging. |
| `users` | ✅ | High-cardinality, append-mostly. v7 makes user-id-keyed log scans sequential. Hardcoded dev seed accounts (`gadmin@mmffdev.com` etc.) keep their existing UUIDs (preserved by `INSERT … ON CONFLICT DO NOTHING`). |
| `sessions` | 🟡 | The PK is `id` but lookups are by `token_hash`. v7 buys little for the hot path; it does add a *creation-time leak* on the row id. Recommended: migrate, but ensure `id` is never returned to clients (check API responses; today the front-end does not need it). |
| `password_resets` | 🟡 | Same as sessions — `token_hash` is the lookup key. Row id leaks creation millisecond, which a network attacker who captures the email link could correlate with their guess of when the reset happened (low value). Acceptable. |
| `user_workspace_permissions` | ✅ | High write rate during permissions edits. B-tree locality wins. |
| `audit_log` | ✅ — **biggest beneficiary** | Append-only, frequently scanned by `created_at DESC`. v7 PK obviates `idx_audit_log_created` as a separate index. |
| `subscription_sequence` | ⚪ | Composite PK `(subscription_id, scope)` — no UUID. Skip. |
| `company_roadmap`, `workspace`, `portfolio`, `product` | ✅ | Low cardinality per-subscription, but child rows reference these heavily; migration is straightforward. |
| `entity_stakeholders` | ✅ | Polymorphic; the `entity_id` column points at one of four parent kinds. The polymorphic dispatch trigger (migration 013) does not care about UUID generation. |
| `portfolio_item_types`, `execution_item_types` | ✅ | Per-subscription catalogue; small. |
| `canonical_states` | ⚪ | PK is `code TEXT`, not UUID. Skip. |
| `item_type_states` | ✅ | Mid-cardinality. |
| `item_type_transition_edges` | ✅ | Edge table; lots of referential FKs. |
| `item_state_history` | ✅ — **second-biggest beneficiary** | Append-only, time-ordered reads dominate. v7 PK + `transitioned_at` becomes redundant for read patterns *"last N transitions for item X"*. |
| `pages` | 🟡 | System pages have hardcoded `key_enum` strings; `id` is UUID but rarely user-visible. Migration is fine but yields no read-pattern win. |
| `page_tags` | ⚪ | PK is `tag_enum TEXT`. |
| `page_roles` | ⚪ | Composite PK `(page_id, role)`. |
| `page_entity_refs` | ⚪ | Composite PK `(page_id, entity_kind, entity_id)`. |
| `user_nav_prefs` | ✅ | High-write under heavy nav-edit; modest benefit. |
| `user_nav_groups` | ✅ | Same. |
| `user_custom_pages` | ✅ | Per-user, low cardinality, but a `WHERE user_id = $1 ORDER BY id` scan replaces an explicit `created_at` sort. |
| `user_custom_page_views` | ✅ | Same. |
| `pending_library_cleanup_jobs` | ✅ — **claim-pattern win** | The hot path is `SELECT … WHERE status = 'pending' AND visible_at <= now() FOR UPDATE SKIP LOCKED`. Time-ordered IDs improve cache locality for queue drain in commit order. |
| `library_acknowledgements` | ⚪ | Composite PK `(subscription_id, release_id)`. |
| `subscription_portfolio_model_state` | 🟡 | Few rows per subscription (one active row at a time per the partial unique index). v7 buys no read benefit; harmless. |
| `subscription_layers`, `subscription_workflows`, `subscription_workflow_transitions`, `subscription_artifacts`, `subscription_terminology` | ✅ | Adoption mirrors. Lifecycle is "create at adopt time, edit by user". B-tree locality is a clear win during adoption (single-tx batch insert). **Watch out:** `subscription_workflows.layer_id` and `subscription_workflow_transitions.from_state_id`/`to_state_id` are mirror→mirror FKs — both sides must be migrated together. |
| `error_events` | ✅ — **biggest read-pattern win after `audit_log`** | Append-only, `(subscription_id, occurred_at DESC)` is the primary index. v7 PK + composite predicate becomes a sequential scan. |

#### `mmff_library`

| Table | Verdict | Rationale |
|---|---|---|
| `portfolio_models` | ❌ for seeded rows; ✅ for new rows | Seed `001_mmff_model.sql` hardcodes `0…aa01` (id), `0…a000` (model_family_id). Release artifacts INSERT with `ON CONFLICT (model_family_id, version) DO NOTHING` — preserve. |
| `portfolio_model_layers` | 🟡 | Seed hardcodes `0…ab01..ab05`. Same pattern — preserve seeds, allow v7 for tenant-authored bundles. The constraint that complicates this: the *adoption mirror tables* embed `source_library_id` referring to these UUIDs. Tenant-authored bundles getting v7 IDs while system bundles keep v4 is fine (both fit in `UUID`); but the mirror has to be auditable across both shapes. |
| `portfolio_model_workflows` | 🟡 | Same — seeded `ac11..ac53`. |
| `portfolio_model_workflow_transitions` | ⚪ | UUID PK exists but seed uses `gen_random_uuid()` (not deterministic). Migrate. |
| `portfolio_model_artifacts` | ✅ | Same as transitions — non-deterministic seed. |
| `portfolio_model_terminology` | ✅ | Same. |
| `portfolio_model_shares` | ⚪ | Composite PK `(model_id, grantee_subscription_id)`. |
| `library_releases` | ✅ | Time-ordered reads (`released_at DESC`). v7 PK eliminates `idx_library_releases_active`. |
| `library_release_actions` | ✅ | Always read via `release_id`; v7 OK. |
| `library_release_log` | ✅ — **append-only, time-ordered** | `applied_at DESC` is the primary read order. Strong v7 win. |
| `error_codes` | ⚪ | PK is `code TEXT`. |

### 2.4 Recommended migration mode

**Application-side generation, schema sets default to `gen_random_uuid()` for back-compat** (no extension dependency at the DB layer until Postgres 18 ships native v7). The Go layer adopts `uuid.NewV7()` (google/uuid v1.6+) at every call site that constructs a UUID. The DB column default remains `gen_random_uuid()` so a row inserted without an explicit ID still gets a valid (v4) UUID — this is the back-compat path for partial rollout.

Cutover policy: **new rows get v7; existing rows stay v4**. Both fit `UUID(16)`; B-tree mixing is fine — the index slowly drifts toward right-edge concentration as v7 rows accumulate.

### 2.5 What I would NOT do

- **Do not rewrite existing UUIDs.** Touching every UUID PK + every FK + every Go test fixture + every seeded reference is a multi-week effort with a real risk of silent-corruption bugs, for an aesthetic improvement. The code generated above ships only new IDs as v7.
- **Do not adopt `pg_uuidv7` until Postgres 17.x is the production version *and* a quarterly maintenance window is available.** Extension-as-default is a tax on every backup-restore.
- **Do not migrate seeded library bundle UUIDs.** They are *contracts* against tenant adoption rows — changing them breaks adoptions.

---

## §3. Full Relational Structure Audit

### 3.1 Primary keys

Every business table uses `UUID PRIMARY KEY DEFAULT gen_random_uuid()`. **Exceptions:**

| Table | PK shape | Reason |
|---|---|---|
| `subscription_sequence` | `(subscription_id, scope)` composite | Counter, not entity. |
| `canonical_states` | `code TEXT` | Static vocabulary. |
| `page_tags` | `tag_enum TEXT` | Static vocabulary. |
| `page_roles` | `(page_id, role)` composite | Many-to-many. |
| `page_entity_refs` | `(page_id, entity_kind, entity_id)` composite | Polymorphic many-to-many. |
| `library_acknowledgements` | `(subscription_id, release_id)` composite | Cross-DB ack record. |
| `portfolio_model_shares` | `(model_id, grantee_subscription_id)` composite | Many-to-many share grant. |
| `error_codes` | `code TEXT` | Static catalogue. |

✅ Coherent — composite PKs where multiplicity demands it; TEXT PKs only where the value is the *contract*, not the surrogate.

### 3.2 Foreign-key delete-rule audit

Source of truth: `docs/c_schema.md §Foreign-key map` (verified live 2026-04-25). Cross-checked against migration files.

#### Pattern summary (intended design)

- **Auth/session/log/nav/page-children: CASCADE.** Going-away of a user, subscription, or page takes their dependent rows.
- **Portfolio stack: RESTRICT.** Never silently drop owners or hierarchy; archive first.
- **`granted_by`, `audit_log`: SET NULL.** Preserve audit even after actor deletion.

This pattern is **internally consistent** and matches SoW §7 audit-trail requirements.

#### Suspect / interesting choices

| FK | Rule | Comment |
|---|---|---|
| `users.subscription_id → subscriptions.id` | RESTRICT | ✅ Correct. Archiving a subscription with live users should be a deliberate ops action. |
| `sessions.user_id → users.id` | CASCADE | ✅ Correct (sign out everywhere on hard-delete). |
| `password_resets.user_id → users.id` | CASCADE | ✅. |
| `pages.subscription_id → subscriptions.id` | CASCADE | 🟡 **Subtle:** if you ever hard-delete a subscription (today gated by RESTRICT on every business table), CASCADE will drop the subscription's pages but leave the subscription's audit trail (which uses SET NULL on `subscription_id`). The combination is correct in theory but **the entire chain assumes hard-delete of `subscriptions` is unreachable** — and that's only true while every other FK on `subscriptions` is RESTRICT. It is. Good. |
| `pages.created_by → users.id` | CASCADE | ⚠️ **Concerning:** if a user is hard-deleted, their *user_custom* pages disappear. That's correct for `kind='user_custom'` but the same FK applies to `kind='system'` rows (where `created_by IS NULL`). Verify no migration ever inserts a system page with a non-null `created_by`. (Migrations 020, 022 — register portfolio-model and library-releases pages — do not set `created_by`, ✅.) |
| `subscription_layers.parent_layer_id → subscription_layers.id` | RESTRICT | ✅ self-FK; an archive must walk the tree. |
| `subscription_workflows.layer_id → subscription_layers.id` | CASCADE | ✅ Mirrors library `portfolio_model_workflows.layer_id` (CASCADE). |
| `subscription_workflow_transitions.from_state_id/to_state_id → subscription_workflows.id` | CASCADE | ✅ Same. |
| `pending_library_cleanup_jobs.subscription_id → subscriptions.id` | RESTRICT | ✅ A failed cleanup should block subscription archive. |
| `library_release_log.release_id → library_releases.id` | SET NULL | ✅ Preserve the apply-log row even if the release row is deleted; the version + sha256 carry the audit. |
| `audit_log.user_id → users.id` | SET NULL | ✅. |
| `audit_log.subscription_id → subscriptions.id` | SET NULL | ⚠️ **Inconsistent with the "RESTRICT subscription deletes" pattern.** Today no path hard-deletes a subscription, so this rule is unreachable. If/when a hard-delete path ships, it will silently null out the audit trail's `subscription_id` — losing the *which-tenant* dimension. Recommend: change to RESTRICT for safety, or accept SET NULL with a documented reason. |

#### CASCADE → RESTRICT audit (cross-cutting)

Run this query to verify pattern consistency (recommended as a CI canary):

```sql
SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
JOIN information_schema.referential_constraints rc USING (constraint_schema, constraint_name)
JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_name = 'subscriptions'
ORDER BY rc.delete_rule, tc.table_name;
```

Expected output today: every business-data FK to `subscriptions` is RESTRICT; auth/session/audit/page FKs are CASCADE; `audit_log.subscription_id` is SET NULL (the inconsistency above).

### 3.3 Dependency graph (textual)

Roots → leaves (CASCADE-only edges shown for delete-impact):

```
subscriptions (RESTRICTED by all business tables — never hard-deletable today)
├── users (RESTRICT)
│   ├── sessions (CASCADE)
│   ├── password_resets (CASCADE)
│   ├── user_workspace_permissions (CASCADE)
│   ├── user_nav_groups (CASCADE)
│   ├── user_nav_prefs (CASCADE)
│   ├── user_custom_pages (CASCADE)
│   │   └── user_custom_page_views (CASCADE)
│   ├── pages.created_by (CASCADE — only for user_custom)
│   └── audit_log.user_id (SET NULL)
├── subscription_sequence (RESTRICT — counter)
├── company_roadmap (RESTRICT)
│   └── workspace (RESTRICT)
│       ├── portfolio (RESTRICT)
│       │   └── product.parent_portfolio_id (RESTRICT)
│       ├── product (RESTRICT)
│       └── user_workspace_permissions (CASCADE on workspace_id)
├── portfolio_item_types (RESTRICT)
├── execution_item_types (RESTRICT)
├── item_type_states (RESTRICT)
│   ├── item_type_transition_edges.from_state_id/to_state_id (RESTRICT)
│   └── item_state_history.from_state_id/to_state_id (RESTRICT)
├── pages (CASCADE)
│   ├── page_roles (CASCADE)
│   └── page_entity_refs (CASCADE)
├── pending_library_cleanup_jobs (RESTRICT)
├── subscription_portfolio_model_state (RESTRICT)
├── subscription_layers (RESTRICT)
│   └── subscription_workflows (CASCADE)
│       └── subscription_workflow_transitions (CASCADE)
├── subscription_artifacts (RESTRICT)
├── subscription_terminology (RESTRICT)
├── error_events (RESTRICT)
└── library_acknowledgements (RESTRICT)

mmff_library (separate DB):
portfolio_models
├── portfolio_model_layers (CASCADE)
│   └── parent_layer_id self-FK (RESTRICT)
├── portfolio_model_workflows (CASCADE)
│   └── portfolio_model_workflow_transitions (CASCADE)
├── portfolio_model_artifacts (CASCADE)
├── portfolio_model_terminology (CASCADE)
└── portfolio_model_shares (CASCADE on model_id)

library_releases
├── library_release_actions (CASCADE)
└── library_release_log.release_id (SET NULL)

error_codes (no children; referenced cross-DB by error_events.code)
```

### 3.4 Polymorphic FKs — orphan risk

Per `docs/c_polymorphic_writes.md` and `docs/c_schema.md §Invariant 7`, four relationships use a `*_kind` discriminator + opaque UUID:

| Child | Parent kinds | DB enforcement | Live writer | Archive cleanup |
|---|---|---|---|---|
| `entity_stakeholders` | company_roadmap, workspace, portfolio, product | dispatch trigger (013) | none yet | TODO when archive handler ships |
| `item_type_states` | portfolio_item_types, execution_item_types | dispatch trigger (013) | none yet | TODO |
| `item_state_history` | portfolio_item, execution_item (tables NOT YET BUILT) | dispatch trigger NOT INSTALLED | none | parent tables don't exist |
| `page_entity_refs` | portfolio, product (workspace rejected by CHECK) | dispatch trigger (013) | `bookmarks.go` via `entityrefs.Service` | NOT WIRED — no archive handler yet exists |

**Findings:**

- ✅ DB-side dispatch trigger (migration 013) prevents *insert* of orphan rows for the three live tables. This is sound defence-in-depth.
- ❌ **No archive/delete handler exists for `workspace`, `portfolio`, or `product`.** Per TD-001 (resolved-as-capped) and `c_polymorphic_writes.md §Open gap`, the first such handler must call `Refs.CleanupChildren(ctx, tx, kind, id)` *before* the parent UPDATE. The dispatch trigger does **not** enforce this — it only catches inserts. Concretely: a `padmin` (or any handler) that archives a portfolio without calling `CleanupChildren` will leave orphan `entity_stakeholders` and `page_entity_refs` rows. The canary `backend/internal/dbcheck/orphans_test.go` will detect this post-deploy. **Severity: S2** (latent).
- ❌ **`item_state_history` has no dispatch trigger** because its parent tables (`portfolio_item`, `execution_item`) don't yet exist. When they ship, the trigger MUST be added in the same migration. If it isn't, every state-change row becomes possible-orphan-by-construction.

### 3.5 Cross-DB FK orphan risk

Tracked cumulatively in TD-LIB-007/008/009 — but I want to make the *system-level* risk explicit. **Five distinct cross-DB references**, all app-enforced, none with a working reconciler today:

| Source (mmff_vector) | Target (mmff_library) | Tech debt | Impact if reference goes stale |
|---|---|---|---|
| `subscription_portfolio_model_state.adopted_model_id` | `portfolio_models.id` | TD-LIB-007 (S2) | Adoption row points at vanished bundle. Subscription stuck mid-saga. |
| `error_events.code` | `error_codes.code` | TD-LIB-008 (S3) | Dashboard renders unknown code; degraded label, not data loss. |
| `subscription_layers.source_library_id` | `portfolio_model_layers.id` | TD-LIB-009 (S2) | Mirror row references a vanished library row. Upgrade-reconciliation breaks. |
| `subscription_workflows.source_library_id` | `portfolio_model_workflows.id` | TD-LIB-009 (S2) | Same. |
| `subscription_workflow_transitions.source_library_id` | `portfolio_model_workflow_transitions.id` | TD-LIB-009 (S2) | Same. |
| `subscription_artifacts.source_library_id` | `portfolio_model_artifacts.id` | TD-LIB-009 (S2) | Same. |
| `subscription_terminology.source_library_id` | `portfolio_model_terminology.id` | TD-LIB-009 (S2) | Same. |
| `portfolio_model_shares.grantee_subscription_id` | `subscriptions.id` (reverse direction!) | not registered | Library row references a vanished subscription. Today unreachable because subscription archive is RESTRICTed. |

**System-level recommendation:** **one shared cross-DB writer service**, in `backend/internal/entityrefs` or a sibling package (e.g. `backend/internal/librarywriter`). Every write that creates a cross-DB reference goes through one validated path: `LoadLibraryRow(ctx, kind, id) → row | ErrNotFound | ErrArchived`. Pair with one nightly reconciler job that joins each reference set against the target and posts a structured report to `error_events` (kind=`library`).

---

## §4. Schema Health Check

### 4.1 Indexes

#### Missing FK indexes

Postgres does **not** auto-create indexes on the source side of an FK. Below is a sweep of FK columns that lack a matching index. Cardinality estimates are inferred — verify with `EXPLAIN ANALYZE` on a populated DB before acting.

| Table | Column | Risk | Recommendation |
|---|---|---|---|
| `users` | `subscription_id` | high write/read | ✅ Already covered by `idx_users_tenant_id` (predates rename; verify post-017 it's still on `subscription_id`). |
| `audit_log` | `subscription_id` | mid | ✅ `idx_audit_log_tenant_id` (verify renamed). |
| `audit_log` | `user_id` | mid | ✅ `idx_audit_log_user_id`. |
| `password_resets` | `user_id` | low | ❌ No index. Cardinality is low (per-user reset is rare); OK to defer. |
| `entity_stakeholders` | `entity_id` | mid | 🟡 Polymorphic — composite `(entity_kind, entity_id)` index would help reverse lookups. Today there isn't one (verify with `\d entity_stakeholders`). |
| `entity_stakeholders` | `user_id` | mid | 🟡 Recommend `CREATE INDEX idx_entity_stakeholders_user ON entity_stakeholders(subscription_id, user_id)` for "what does this user own?" queries. |
| `item_type_states` | `(item_type_kind, item_type_id)` composite | high | Verify; this is the polymorphic FK and the canonical-code path needs both. |
| `item_type_transition_edges` | `(item_type_kind, item_type_id)` | mid | Same. |
| `item_state_history` | `item_id` | high (when item tables ship) | **MUST add** `(subscription_id, item_id, transitioned_at DESC)` before first item table ships — primary read pattern is "show all transitions for this item". |
| `page_entity_refs` | `(entity_kind, entity_id)` | mid | Reverse lookup ("what page corresponds to this entity?"). |
| `user_custom_page_views` | `page_id` | low | ✅ `idx_user_custom_page_views_page`. |
| `library_acknowledgements` | `release_id` | mid | Verify; primary read is "who has acknowledged release X". |
| `portfolio_model_shares` | `grantee_subscription_id` | mid | ✅ `idx_portfolio_model_shares_grantee` partial WHERE revoked_at IS NULL. |

#### Redundant / suspect indexes

- **Once v7 ships** (per §2): `idx_audit_log_created`, `idx_error_events_subscription_occurred`, `idx_library_releases_active` become substantially redundant (the v7-ordered PK provides the time-ordered scan path). Until v7, keep them.
- `users` has both `idx_users_email` (non-unique, from migration 001) and `users_email_tenant_unique` (unique on `(email, tenant_id)`). The non-unique single-column `idx_users_email` is redundant — `users_email_tenant_unique` can serve `WHERE email = ?` lookups (Postgres can use a unique composite index for prefix scans). However, dropping requires the most-common-query pattern to start with `email`. Verify before dropping; the cost of keeping it is small.
- `idx_sessions_token_hash` is redundant with the `UNIQUE` constraint on `token_hash` — that automatically creates an index. Drop the explicit one. Migration 001:58 + 001:68 both create the same index in effect.

#### Partial-index coverage

Soft-archive-bearing tables consistently use partial indexes on `WHERE archived_at IS NULL`. ✅ Pattern is well-applied. Notable gap: `pages` has three partial-unique indexes (012) but no general `WHERE archived_at IS NULL` predicate — but `pages` doesn't have an `archived_at` column (system pages are removed by migration; `user_custom` pages are hard-deleted). ✅ Consistent.

### 4.2 NOT NULL gaps

Spot-checked across all tables. No surprising gaps; every column that should be NOT NULL is. A few observations:

- `sessions.ip_address` and `sessions.user_agent` are nullable (correct — clients may not send UA; legacy tests may not set IP).
- `audit_log.metadata` nullable (correct — many actions have no extra context).
- `error_events.context` nullable (correct — minimal-payload errors).
- `users.last_login` nullable until first login. ✅
- `users.locked_until`, `mfa_secret`, `mfa_enrolled_at`, `mfa_recovery_codes` all nullable. ✅
- `portfolio_models.owner_subscription_id` nullable iff `scope='system'` (enforced by `scope_owner_consistency` CHECK in `003_portfolio_model_bundles.sql:45-48`). ✅ Belt-and-braces.
- `library_releases.audience_tier` and `audience_subscription_ids` nullable (NULL = all). ✅
- `library_releases.affects_model_family_id` nullable. ✅
- `library_releases.expires_at` nullable. ✅

### 4.3 Missing CHECK constraints

| Table | Suggested CHECK | Rationale |
|---|---|---|
| `subscriptions.slug` | `CHECK (slug ~ '^[a-z0-9-]+$' AND length(slug) BETWEEN 3 AND 64)` | URL-safe slugs only. App-side enforced today; DB CHECK is cheap belt-and-braces. |
| `users.email` | `CHECK (email ~ '^[^@]+@[^@]+\.[^@]+$' AND length(email) <= 320)` | RFC 5321 email length cap; minimal format. Actual RFC parsing is app-side. |
| `users.role` | already enum `user_role` ✅ |  |
| `users.auth_method` | `CHECK (auth_method IN ('local','ldap'))` | Currently no CHECK; relies on app discipline. **Recommend adding** — vocabulary is closed. |
| `pages.kind` | `CHECK (kind IN ('system','entity','user_custom','shared'))` | Closed vocabulary; today no CHECK. **Recommend adding.** |
| `entity_stakeholders.role` | `CHECK (role IN ('owner','stakeholder', …))` | Currently free-form TEXT. Leaves room for typos. Vocabulary is small; pin it. |
| `subscription_workflow_transitions` (mirror) | already has `CHECK (from_state_id <> to_state_id)` ✅ |  |
| `portfolio_model_workflow_transitions` (library) | already has `CHECK (from_state_id <> to_state_id)` ✅ |  |
| `pending_library_cleanup_jobs.attempts` | already has `CHECK (attempts >= 0)` ✅ |  |
| `subscription_portfolio_model_state.status` | already has CHECK ✅ |  |

### 4.4 Type inconsistencies

- **`audit_log.resource_id` is TEXT, not UUID.** This is intentional (the migration comment says "UUID of affected row, if any" but resources can be non-UUID-keyed like `tag_enum`). Acceptable; consider adding a cross-cutting CHECK (`length(resource_id) <= 64`) to bound query plans.
- **`error_events.request_id` is TEXT.** Comment says "matches go-chi `middleware.RequestID` output (TEXT, not UUID)." ✅ Correct.
- **`library_releases.audience_tier TEXT[]`** — string array of tier values from `subscriptions.tier`. No DB-level integrity (cannot CHECK that each element is in the tier vocabulary without a custom function). Suggest a function-based CHECK:

  ```sql
  CHECK (audience_tier IS NULL OR audience_tier <@ ARRAY['free','pro','enterprise']::text[])
  ```

  Cheap and would catch publish-path typos.

- **`library_releases.audience_subscription_ids UUID[]`** — same shape; UUIDs from another DB. No way to CHECK existence cross-DB; rely on writer-side validation.

### 4.5 Defaults

- `subscriptions.tier DEFAULT 'pro'` — TD-LIB-002, S3, intentional placeholder until billing wires up.
- `subscriptions.is_active DEFAULT true` — ✅
- `users.role DEFAULT 'user'` — ✅ least-privilege.
- `users.is_active DEFAULT true` — 🟡 mild concern: a freshly-inserted user is *active* by default. For SaaS sign-up flows that gate activation on email verification, you'd want `DEFAULT false`. Current shape is OK because the only insert path is the seeded admin and gadmin-driven user creation (per role boundaries: gadmin = tech/support).
- `users.failed_login_count DEFAULT 0` — ✅
- `users.mfa_enrolled DEFAULT false` — ✅
- `users.force_password_change DEFAULT false` — ✅
- `pages.pinnable DEFAULT true`, `default_pinned DEFAULT false` — ✅
- `library_releases.severity` no default — required, ✅
- `subscription_layers.allows_children DEFAULT true`, `is_leaf DEFAULT false` — ✅ but the *combination* `(allows_children=false AND is_leaf=false)` is non-sensical (a node that has neither children allowed nor is itself a leaf). Suggest CHECK:

  ```sql
  CHECK (allows_children OR is_leaf)
  ```

  Same on `portfolio_model_layers`.

### 4.6 Unused / dormant columns

| Column | Status | Plan |
|---|---|---|
| `users.mfa_*` (5 columns) | Scaffold per migration 003; not yet enforced. | Keep — well-documented. |
| `users.ldap_dn` | Populated when `auth_method='ldap'`; LDAP path not yet shipping. | Keep. |
| `user_nav_prefs.profile_id` | Reserved for Phase 5 named profiles; MVP writes NULL. | Keep — shape is forward-compatible. |
| `portfolio.type_id`, `product.type_id` | Catalogue lookups; nullable. | Verify they are written by current handlers. |
| `library_releases.body_md` | Optional long-form content; UI may not render yet. | Keep. |
| `library_releases.expires_at` | TTL on releases; reconciler not yet wired. | Keep — reconciler is Phase-3+ work. |

### 4.7 Migration-numbering invariant

❌ `db/schema/027_*.sql` does not exist, but neither `c_schema.md` nor `c_tech_debt.md` flags it as a gap. Nothing in the live DB depends on a 027, but the silent skip is a process smell. **Recommend a CI canary:**

```bash
# Asserts contiguous numbering 001..NNN with no gaps.
ls db/schema/[0-9][0-9][0-9]_*.sql | awk -F_ '{print $1}' \
  | awk '{print substr($1,length($1)-2)}' \
  | sort -n | awk 'NR==1{prev=$1; next} {if($1!=prev+1) {print "gap at "prev"->"$1; exit 1} prev=$1}'
```

(Or a Go test over `os.ReadDir(...)`.)

### 4.8 Trigger function reuse

`set_updated_at()` is defined identically in both `mmff_vector` (`001_init.sql:95-101`) and `mmff_library` (`003_portfolio_model_bundles.sql:16-21`). ✅ Standard cross-DB pattern.

`item_state_history` UPDATE/DELETE rejection trigger and `error_events_append_only()` are separate function definitions. ✅ Each table owns its own trigger function — fine.

---

## §5. Tenant Isolation Audit

### 5.1 `subscription_id` coverage

Per `c_security.md §1` and `c_schema.md Invariant 1`, every business table MUST carry `subscription_id UUID NOT NULL`. Sweep:

| Table | Has subscription_id? | Notes |
|---|---|---|
| `subscriptions` | ❌ self | ✅ root |
| `users` | ✅ NOT NULL RESTRICT |  |
| `sessions` | ❌ — joins via `user_id → users.subscription_id` | ✅ correct (sessions are user-scoped, not subscription-scoped directly). |
| `password_resets` | ❌ — joins via `user_id` | ✅ same. |
| `user_workspace_permissions` | ❌ — joins via `workspace_id → workspace.subscription_id` | 🟡 **Performance footnote:** every permission check requires a join. Worth adding a denormalised `subscription_id` column with a trigger to keep it consistent, *if* the perm-check path becomes hot. Today: defer. |
| `audit_log` | ✅ NULLABLE SET NULL | NULL allowed for system actions. |
| `subscription_sequence` | ✅ NOT NULL RESTRICT |  |
| `company_roadmap` | ✅ NOT NULL RESTRICT |  |
| `workspace` | ✅ NOT NULL RESTRICT |  |
| `portfolio` | ✅ NOT NULL RESTRICT |  |
| `product` | ✅ NOT NULL RESTRICT |  |
| `entity_stakeholders` | ✅ NOT NULL RESTRICT |  |
| `portfolio_item_types` | ✅ NOT NULL RESTRICT |  |
| `execution_item_types` | ✅ NOT NULL RESTRICT |  |
| `canonical_states` | ❌ | ✅ global vocabulary, not tenant-scoped. |
| `item_type_states` | ✅ NOT NULL RESTRICT |  |
| `item_type_transition_edges` | ✅ NOT NULL RESTRICT |  |
| `item_state_history` | ✅ NOT NULL RESTRICT |  |
| `pages` | NULL = global system page | ✅ correct. |
| `page_tags` | ❌ | ✅ vocabulary. |
| `page_roles` | ❌ — derived through `page_id → pages.subscription_id` | ✅ |
| `page_entity_refs` | ❌ — derived | 🟡 Reverse query *"all entity refs for subscription"* needs a join. Add denormalised column if it becomes hot. |
| `user_nav_prefs` | ✅ NOT NULL CASCADE |  |
| `user_nav_groups` | ❌ — derived through user | 🟡 same shape; nav groups are user-scoped. ✅ |
| `user_custom_pages` | ✅ NOT NULL CASCADE |  |
| `user_custom_page_views` | ❌ — derived through `page_id → user_custom_pages.subscription_id` | ✅ |
| `pending_library_cleanup_jobs` | ✅ NOT NULL RESTRICT |  |
| `library_acknowledgements` | ✅ part of composite PK |  |
| `subscription_portfolio_model_state` | ✅ NOT NULL RESTRICT |  |
| `subscription_layers/_workflows/_workflow_transitions/_artifacts/_terminology` | ✅ NOT NULL RESTRICT |  |
| `error_events` | ✅ NOT NULL RESTRICT |  |

**Coverage is complete.** Tables that derive isolation through a parent FK do so consistently and correctly.

### 5.2 Row-Level Security (RLS)

❌ **No RLS policies defined.** All tenant filtering is hand-rolled in Go handlers. Per `c_security.md §1`: *"Every query against a tenant-scoped table MUST filter by tenant_id. … Anti-pattern: SELECT * FROM portfolio WHERE id = $1 — missing tenant filter."*

This is the biggest single defence-in-depth gap. The standard SaaS pattern is:

1. Connect with the application role (already done — `mmff_dev`).
2. `SET app.subscription_id = '...'` per-request (PG14+ supports `SET LOCAL` inside a transaction).
3. Define RLS policies: `USING (subscription_id = current_setting('app.subscription_id')::uuid)`.

A query missing `WHERE subscription_id = $1` then returns zero rows instead of leaking. Cost: ~3% on simple reads (verify with EXPLAIN); negligible relative to the security upside.

**Recommendation:** stage RLS introduction in three tranches:

1. **Phase A (cap):** RLS in `FORCE ROW LEVEL SECURITY` mode on **`audit_log` and `error_events`** only. They are append-only with simple shapes; lowest-risk way to land the pattern.
2. **Phase B (broaden):** all `*_state` and `*_history` tables.
3. **Phase C (full):** entire portfolio stack.

Each phase requires a per-request session-variable middleware in Go (probably in `backend/internal/auth` or a sibling) and a CI canary that verifies RLS is `ON` for every business table.

### 5.3 Unique constraint coverage

Most uniqueness pairs include `subscription_id`, e.g.:

- `users (email, tenant_id)` ← still named `tenant_id`? Verify post-017 rename.
- `company_roadmap.key_num` is unique within subscription (but I don't see a CHECK in the schema doc; it's likely an index, not a constraint).
- Partial-unique indexes on `pages (key_enum, subscription_id) WHERE …` (migration 012) — three variants: system, shared, user-custom.
- `user_custom_pages (user_id, subscription_id, label)` — ✅
- `subscription_portfolio_model_state (subscription_id) WHERE archived_at IS NULL AND status NOT IN ('failed','rolled_back')` — ✅ correct shape for "one active adoption per subscription".

🟡 **Latent gap:** `subscription_sequence (subscription_id, scope)` is the PK but per `c_schema.md` Invariant 4 the lock pattern is `SELECT … FOR UPDATE; UPDATE … SET next_num = next_num + 1`. That works because the row exists (it's the PK), but if a sequence is inserted concurrently with two SCOPE values for the same subscription, ON CONFLICT does the right thing. ✅

### 5.4 The `audit_log.subscription_id SET NULL` anomaly

Repeated from §3.2 because it lives at the intersection of audit trail + tenant isolation: if `subscriptions` ever supports hard-delete, `audit_log` rows lose their tenant attribution. Today unreachable (RESTRICTed by every business FK), but worth aligning to RESTRICT or codifying via comment. Severity: S3.

---

## §6. Security Review

### 6.1 Sensitive-data inventory

Per `c_security.md §3`:

| Table | Sensitive column | Posture | Notes |
|---|---|---|---|
| `users` | `password_hash` | bcrypt 12 ✅ | `001_init.sql:36`. Hardcoded dev hashes in seed must be rotated for production. |
| `users` | `mfa_secret` | TEXT, plaintext | ⚠️ **Should be encrypted at rest.** Today MFA is dormant (`mfa_enrolled DEFAULT false`); when enabled, the secret enables anyone with DB read to mint TOTP codes. Recommend: encrypt with a server-side key (`pgcrypto.pgp_sym_encrypt`) before MFA goes live. |
| `users` | `mfa_recovery_codes` | TEXT[] | Same — sensitive at rest. |
| `users` | `ldap_dn` | TEXT | DN itself is not secret, but reveals directory structure. Acceptable. |
| `sessions` | `token_hash` | sha256 ✅ | raw token never persisted (`c_security.md §3`). |
| `password_resets` | `token_hash` | sha256 ✅ |  |
| `audit_log` | `metadata` | JSONB | ⚠️ Audit metadata could contain field-level changes (PII) — handler discipline must scrub before insert. No DB-level constraint (impossible). |
| `error_events` | `context` | JSONB | Same risk: `reportError(code, context)` calls must scrub PII. Doc this in `c_c_error_codes.md`. |

### 6.2 Append-only history

Per `c_security.md §4`:

| Table | Append-only mechanism | Status |
|---|---|---|
| `item_state_history` | BEFORE UPDATE/DELETE trigger raises `check_violation` | ✅ Trigger-enforced |
| `error_events` | BEFORE UPDATE/DELETE trigger raises `check_violation` | ✅ Trigger-enforced (migration 028) |
| `library_release_log` | BEFORE UPDATE/DELETE trigger | ✅ Trigger-enforced (006_release_channel.sql:114-122) |
| `audit_log` | **Convention only — no trigger** | ❌ **Gap.** `c_security.md §4` literally says *"audit_log is append-only by convention. Writer code must never UPDATE or DELETE rows."* This is policy without enforcement. |

**Recommend:** copy the `error_events_append_only()` pattern to `audit_log`. It's a one-migration change. Cost: zero. Benefit: defence-in-depth against any future code path (or accidental migration) that mutates audit data.

### 6.3 v7 timestamp leakage (cross-cut from §2)

If/when v7 IDs are adopted on these tables, the row id reveals creation millisecond:

| Table | Leakage concern |
|---|---|
| `sessions.id` | A session id surfacing in logs reveals session-start time. Today the row id is internal; verify no API response carries it. |
| `password_resets.id` | A reset id surfacing in URLs would reveal request time. Today the URL carries the *raw token*, not the row id; ✅. |
| `audit_log.id` | Audit-row creation time = action time. Already known via `created_at`; ✅. |
| `error_events.id` | Same — `occurred_at` is already the canonical time. |
| `users.id` | User-creation time embedded in id. Internal; not ideal but low-risk. |

**Recommendation:** v7 is fine for `audit_log`, `error_events`, `item_state_history`, `library_release_log` (already-public timestamps). For `users`, `sessions`, `password_resets`, default to v4 (`gen_random_uuid()`) until/unless a specific motivation appears.

### 6.4 Hardcoded secrets / fixtures in seed files

| File | Concern |
|---|---|
| `db/schema/001_init.sql:115-140` | Seeds `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `user@mmffdev.com` with hardcoded bcrypt hashes (password "myApples100@" per the comment). |
| `db/schema/001_init.sql:115` | Hardcoded subscription UUID `00000000-0000-0000-0000-000000000001`. |
| `db/library_schema/002_roles.sql:20-34` | Hardcoded role placeholder passwords (`change_me_admin`, `change_me_ro`, `change_me_publish`, `change_me_ack`). Per the file's own header these must be rotated via `ALTER ROLE` in deployment. |
| `db/library_schema/seed/001_mmff_model.sql:39-148` | Deterministic UUIDs (intentional — see §2.3). Document; do not rotate. |

Cross-reference: the project's `project_pre_launch_security` memory entry already flags `.env.local` history exposure and hardcoded secrets as a hard pre-launch task. **All four of the above must be addressed before any external/customer-facing deployment.**

### 6.5 Cross-DB privilege model

Per `db/library_schema/002_roles.sql`, four roles in `mmff_library`:

| Role | Privileges | Used by |
|---|---|---|
| `mmff_library_admin` | ALL on every table | Release artifact apply (`psql -f` only) |
| `mmff_library_ro` | SELECT on every table | Request-path read pool |
| `mmff_library_publish` | INSERT/UPDATE/SELECT on bundle + shares + releases + actions; INSERT-only on release_log; SELECT on error_codes | Future publish path |
| `mmff_library_ack` | SELECT releases + actions + error_codes | Phase-3 list+ack workflow |

✅ **Excellent posture.** Least-privilege per-role; `release_log` is INSERT-only by grant *and* by trigger (defence-in-depth — if grants drift, the trigger holds the line). The CI canary `backend/internal/librarydb/grants_test.go` enforces the grant matrix.

`mmff_vector` has only the `mmff_dev` application role (full DDL/DML). **Not least-privilege**, but also not as critical: there is no read-mostly tenant of `mmff_vector` analogous to the library's request-path pool. Future improvement: split a `mmff_vector_app` (SELECT/INSERT/UPDATE only on application tables, no DDL) from a `mmff_vector_migrate` (DDL allowed, used by migration scripts only). Severity: S3.

### 6.6 Locked LDAP fields

Per `c_security.md §5`: directory-sync'd users have certain profile fields locked to the directory. I did not find a DB-level CHECK or trigger enforcing this. Today the policy is *handler-side only*. Severity: S3 — fine while LDAP is dormant; the trigger should land *with* the LDAP enabling migration.

### 6.7 DB port exposure

Per `c_security.md §7`: Postgres bound to loopback only; SSH tunnel for laptop access. Schema does not configure this; deployment does. ✅ Out of scope for this audit but called out for completeness.

---

## §7. Anomalies & Broken Data Patterns

### 7.1 Stale ops script

`db/ops/cleanup_perm_test_tenants.sql` references `tenants` (table) and `tenant_id` (columns) throughout. Migration 017 renamed both. **The script will fail with `relation "tenants" does not exist`** if anyone runs it today. Severity: S2 (latent — only bites the next dev who runs `permissions/service_test.go` cleanup). **Fix in this audit cycle:** rename `tenants → subscriptions`, `tenant_id → subscription_id` throughout. One-paragraph diff.

### 7.2 Default-tenant trigger mixes naming

`db/seed/001_default_workspace.sql` uses **both old and new naming**: the function signature parameters are `p_tenant_id`, `p_owner_user_id`; SQL inside refers to `tenant_id`, `tenants` (lines 64-66, 84-95, 102-115, 117-145, etc.). Migration 017's rename did NOT touch this seed file because seeds are not migrations. **The function definition is stale and will fail** if/when re-run after migration 017.

This is masked today because:
1. The function was created once, before the rename, and the rename's `ALTER TABLE tenants RENAME TO subscriptions` *probably* updated the function body via Postgres function-recompile — verify with `\sf provision_tenant_defaults`.
2. The trigger `trg_provision_on_first_gadmin` only fires on `users` INSERT with `role='gadmin'` and no existing `company_roadmap` for that subscription — rare.

**Severity: S2.** Fix: rewrite the seed file to use `subscription_id`/`subscriptions` and document the re-apply steps in `c_postgresql.md`.

### 7.3 Migration 027 silently missing

Already covered §4.7. Likely cause: a migration was drafted, assigned 027, then withdrawn or merged into 028. No record of why. **Severity: S3** — process gap, not data gap.

### 7.4 Soft-archive vs hard-delete inconsistency

Two tables intentionally hard-delete instead of soft-archive (per `c_schema.md`):

- `user_custom_pages` (CASCADE to `user_custom_page_views`)
- `user_custom_page_views`

The reasoning is documented (small surface, user-owned, no audit need). ✅ Consistent.

`portfolio_model_shares` lacks an `archived_at` column but has `revoked_at` — semantically equivalent. ✅

`canonical_states`, `page_tags`, `error_codes` have no `archived_at` and no `archived` flag — all are vocabularies; deletion is by migration. ✅

`page_roles` is ACL data with no soft-archive. ✅

**No anomalies here.** The pattern is *"business data soft-archives; reference data deletes via migration; user-private content hard-deletes."* This is a coherent rule and it is followed.

### 7.5 Timestamp hygiene

Every business table has both `created_at` and `updated_at`. Triggers maintain `updated_at` consistently. Append-only tables have *only* `created_at` (and a domain-specific timestamp like `transitioned_at`, `occurred_at`, `applied_at`). No anomalies.

`error_events.occurred_at` defaults to `NOW()`. The `created_at` column also defaults to `NOW()`. Both in same row, written in same statement — they will be identical for the typical write path. The two-column pattern allows the writer to backfill historical errors with the actual occurrence time. ✅ Sound.

### 7.6 Polymorphic orphans (cumulative — see §3.4)

Already covered. Recap: the canary `backend/internal/dbcheck/orphans_test.go` is the safety net; the open gap is the *first archive handler* shipping without a `CleanupChildren` call.

### 7.7 Adoption mirror coupling

The five mirror tables created in migration 029 each carry `(source_library_id, source_library_version)`. **Important property:** mirror→mirror FKs (e.g. `subscription_workflows.layer_id → subscription_layers.id`) are **not** the source-of-truth — they're the per-subscription IDs minted at adoption time. The orchestrator builds a `library_id → mirror_id` translation map row-by-row.

**Hidden assumption:** the translation map is rebuildable from `(source_library_id, source_library_version)` — i.e. every mirror row's source ref is unique within a subscription. Verify by reading migration 029's unique indexes; the partial-unique on `(subscription_id, source_library_id)` is what underwrites this. Today: likely uses the `idx_subscription_layers_source` index (non-unique). **Recommend** adding partial-unique:

```sql
CREATE UNIQUE INDEX idx_subscription_layers_source_unique
  ON subscription_layers (subscription_id, source_library_id)
  WHERE archived_at IS NULL;
```

(and the equivalents on the other four mirrors). Otherwise an orchestrator bug could insert two mirror rows pointing at the same library row, and reconciliation would silently double-count.

---

## §8. Architecture Gaps

### 8.1 Missing tables

Documented in `c_schema.md §Not yet in the schema` and confirmed by the migration sweep:

- **`portfolio_item`, `execution_item`** — work-item parent tables. `item_state_history.item_id` has no FK because the parent doesn't exist. The polymorphic dispatch trigger isn't installed for `item_state_history` for the same reason. **When these ship, both must be added in the same migration as the new tables.**
- **`item_key_alias`** — rename grace-period redirects (`c_url-routing.md`). Deferred until first tag rename ships.
- **Multi-division config root** — SoW §12 paid tier; nullable `config_root_id` on item-type and state tables. Non-breaking when added.
- **`nav_icons` catalogue** — referenced from `user_nav_prefs.icon_override` (migration 015) but no catalogue table. Today the value is free-form TEXT (validated app-side).

### 8.2 Denormalisation candidates

Listed in §5.1 — `user_workspace_permissions` and `page_entity_refs` could use a denormalised `subscription_id` if their reverse-query paths become hot. Today: ship-as-is.

### 8.3 Materialised views

None exist. Candidates if reporting workload grows:

- `mv_subscription_active_summary` (counts of active rows per subscription per kind) — useful for an admin/billing dashboard.
- `mv_release_acknowledgement_status` — per-release ack rates for gadmin notification UI.

Out of scope for current load. Defer.

### 8.4 Scaling bottlenecks (10x → 100x)

Today's load is ≪ 1k subscriptions, ≪ 100 users/sub, ≪ 10k items/sub. At 10× and 100×:

| Bottleneck | 10× | 100× | Mitigation |
|---|---|---|---|
| `audit_log` table size | ~10M rows | ~100M rows | Time-based partitioning (PG declarative): `PARTITION BY RANGE (created_at)`. Add when single-table read latency degrades. |
| `error_events` | Same shape | Same shape | Same partitioning. |
| `item_state_history` | Same | Same | Same. |
| Polymorphic dispatch trigger overhead | negligible | per-write IO | Per-kind tables (TD-001 Phase 4 deferred). Re-evaluate. |
| `subscription_sequence` lock contention | per-subscription, modest | per-subscription, modest | The `FOR UPDATE` lock is per-row — adequate at any load (subscriptions are independent). |
| Cross-DB writer (when shipped) | OK | OK if reconciler is async | Async reconciler is required architecture, not optional. |

### 8.5 No event bus / outbox

The `pending_library_cleanup_jobs` table is a single-purpose work queue (cross-DB cleanup). There is no general-purpose **outbox table** for emit-after-commit semantics. As features that need to emit external events (webhooks, email notifications, library publish hooks) ship, each will need its own queue or a consolidation will be required.

**Recommend:** when the second outbox-shaped table proposes itself, consolidate to a generic `outbox_events` table with `(id, subscription_id, kind, payload jsonb, status, attempts, visible_at)` — same shape as the existing cleanup queue. Severity: S3.

### 8.6 No LISTEN/NOTIFY usage

The codebase doesn't use Postgres LISTEN/NOTIFY for real-time fan-out (verified by the absence of `pg_notify` calls in any migration or schema file). For future SSE/websocket features (already partial — Phase 4 has SSE in the adoption-saga UI), pure polling is fine at current scale. At 100× consider `pg_notify` for cache invalidation events.

### 8.7 Backup posture

Per `c_backup-on-push.md` (not in this audit's scope): dual-channel backup, auto-snapshots on push. ✅

---

## §9. Tech Debt Register (extended)

Existing register (`docs/c_tech_debt.md`): TD-001 (resolved), TD-LIB-001 through TD-LIB-009 (excluding 005 which is empty/missing — verify).

### 9.1 New entries surfaced by this audit

| ID (proposed) | Severity | Area | Debt | Trigger |
|---|---|---|---|---|
| **TD-DB-010** | S2 | DB / audit integrity | `audit_log` is append-only by convention only — no BEFORE UPDATE/DELETE trigger. `item_state_history`, `error_events`, `library_release_log` all have this trigger; `audit_log` doesn't. | Any future code path (or accidental migration) that mutates audit rows. Cap is the convention; pay-down is one trigger migration. |
| **TD-DB-011** | S2 | DB / cross-DB consistency | Five distinct cross-DB references each with its own writer-validation contract; no shared service yet. | First two writers ship in the same release; integrity contracts diverge. |
| **TD-DB-012** | S2 | DB / ops tooling | `db/ops/cleanup_perm_test_tenants.sql` references the pre-rename `tenants`/`tenant_id` schema. Will fail to run. | Next test-cleanup invocation. |
| **TD-DB-013** | S2 | DB / seed function | `provision_tenant_defaults()` body in `db/seed/001_default_workspace.sql` references `tenant_id`/`tenants`. Postgres may have auto-rewritten on rename, but the file on disk is stale and will mis-create the function on a fresh DB build. | Fresh DB rebuild from migrations + seeds. |
| **TD-DB-014** | S2 | DB / mirror integrity | `subscription_layers/_workflows/_workflow_transitions/_artifacts/_terminology` lack partial-unique on `(subscription_id, source_library_id)`. Allows orchestrator double-insert. | Orchestrator bug or retry without idempotency; second adopt of the same library row produces duplicate mirror. |
| **TD-DB-015** | S3 | DB / index hygiene | `idx_users_email` (non-unique) is redundant with `users_email_tenant_unique`. `idx_sessions_token_hash` is redundant with the UNIQUE constraint on `token_hash`. | None — minor IO/storage tax. |
| **TD-DB-016** | S3 | DB / role privilege | `mmff_vector` runs as one app role (`mmff_dev`) with full DDL. No read-only / migrate-only split. | Hostile actor obtains app-role credentials and runs DDL. |
| **TD-DB-017** | S3 | DB / tenant isolation | No RLS policies. Every handler hand-rolls `WHERE subscription_id = $1`. One missed predicate is a cross-tenant leak. | First handler-bug PR that ships without the predicate; librarian's `c_security.md` scan misses it. |
| **TD-DB-018** | S3 | DB / migration hygiene | Migration 027 missing (skipped, undocumented). Numbering is supposed to be contiguous. | Not bite-able alone, but compounds with TD-LIB-004 (dry-run pattern). |
| **TD-DB-019** | S3 | DB / vocabulary CHECK gaps | `users.auth_method`, `pages.kind`, `entity_stakeholders.role` are TEXT without CHECK. | Typo-via-handler ships row that breaks vocabulary downstream. |
| **TD-DB-020** | S2 | DB / MFA secret at rest | `users.mfa_secret` and `users.mfa_recovery_codes` plaintext. Acceptable while MFA is dormant. | First MFA enrolment lands. |
| **TD-DB-021** | S2 | DB / production seed contamination | `001_init.sql` seeds three default users with hardcoded bcrypt hashes (password "myApples100@") and a fixed default-tenant UUID. Library role passwords also hardcoded. | Any deploy that touches a customer-facing environment. (Cross-cut with `project_pre_launch_security` memory.) |
| **TD-DB-022** | S3 | DB / partitioning runway | `audit_log`, `error_events`, `item_state_history` are unpartitioned. At 10×–100× current load, a single-relation scan starts to bite. | First slow-query alert from one of these tables. |

### 9.2 Projected debt at 10× / 100× scale

At **10× scale** (~1k subscriptions, ~10k users/sub):

- TD-DB-022 fires on `audit_log` first (highest write rate after `item_state_history`).
- TD-DB-014 will have already bitten if the orchestrator has a retry bug.
- TD-DB-017 (no RLS) becomes the dominant security risk simply because the bigger the codebase, the more handlers, the more places to forget the predicate.

At **100× scale** (~10k subscriptions, ~50k users/sub):

- All time-ordered append tables require partitioning.
- The single `mmff_dev` app role becomes a serious privilege concentration (TD-DB-016).
- The lack of LISTEN/NOTIFY (or equivalent) for cache invalidation will start showing up as stale-cache user reports.
- Cross-DB reconciler becomes the most-watched async job in the system.

---

## §10. v7 Migration Plan

### 10.1 Strategic recommendation (repeated from §1)

**Defer.** v4 → v7 is an optimisation, not a fix. The cross-DB integrity work (TD-LIB-007/008/009 + TD-DB-011) and audit-trigger work (TD-DB-010) are higher-leverage. Schedule v7 as a Phase-5 pay-down after the cross-DB writer service ships and the reconciler is in production.

That said: the question was *how to do it*, not *whether to do it*. Here is the dependency-ordered sequence with rollback strategy.

### 10.2 Pre-conditions

1. Postgres 17.x in production *or* `pg_uuidv7` extension installed on every replica + backup-restore target.
2. CI canary that asserts `db/schema/NNN_*.sql` is contiguous (TD-DB-018).
3. CI canary `backend/internal/dbcheck/orphans_test.go` green for at least 30 days.
4. Cross-DB reconciler in production for at least 30 days with zero unresolved orphans.
5. RLS Phase A landed (audit_log + error_events) — proves the operational pattern.

### 10.3 Sequence (additive, not transformative)

The migration is **additive only**. No existing UUID is rewritten. New rows get v7; existing rows stay v4. Both fit `UUID(16)`.

#### Phase 1 — Foundation (1 week)

1. **Migration 0NN**: install `pg_uuidv7` extension (idempotent CREATE EXTENSION IF NOT EXISTS) on `mmff_vector` and `mmff_library`.
2. **Migration 0NN+1**: define a SQL function `mmff_uuidv7()` that wraps `uuidv7()` for ergonomic call-sites; add a comment naming the version of the spec.

Verification: `SELECT mmff_uuidv7();` returns a v7 UUID; `SELECT (uuid_extract_timestamp(mmff_uuidv7())) ;` returns now-ish.

#### Phase 2 — Append-only tables (highest-benefit, lowest-risk; 2 weeks)

Order by least-coupled-first. Each migration: change column DEFAULT only. Existing rows unchanged.

1. `audit_log.id DEFAULT mmff_uuidv7()`
2. `error_events.id DEFAULT mmff_uuidv7()`
3. `item_state_history.id DEFAULT mmff_uuidv7()`
4. `library_release_log.id DEFAULT mmff_uuidv7()`

Verification per table: insert a fresh row, assert `uuid_extract_timestamp(id) ≈ now()`. Existing v4 rows remain valid; FK references unaffected.

#### Phase 3 — Queue & state tables (2 weeks)

5. `pending_library_cleanup_jobs.id`
6. `subscription_portfolio_model_state.id`
7. `subscription_layers/_workflows/_workflow_transitions/_artifacts/_terminology.id` — must run as one migration (mirror→mirror FKs; orchestrator must accept either ID shape during transition).

Verification: run an end-to-end adoption against a test subscription; confirm new mirror rows have v7 IDs, existing rows unchanged.

#### Phase 4 — Portfolio stack (3 weeks; coordinate with handler updates)

8. `company_roadmap`, `workspace`, `portfolio`, `product`, `entity_stakeholders`
9. `portfolio_item_types`, `execution_item_types`, `item_type_states`, `item_type_transition_edges`
10. `pages` (system rows preserved by `ON CONFLICT (key_enum, …) DO NOTHING`; new user_custom rows get v7)
11. `user_nav_prefs`, `user_nav_groups`, `user_custom_pages`, `user_custom_page_views`

Verification: full integration test pass; spot-check mixed v4/v7 in B-tree using `pg_buffercache`.

#### Phase 5 — Auth & sessions (1 week, **opt-in only per §6.3**)

12. `users.id` — keep DEFAULT v4; require explicit `mmff_uuidv7()` in the user-creation handler. Don't change DEFAULT.
13. `sessions.id`, `password_resets.id` — keep DEFAULT v4. Optional v7 only if a specific reason emerges.

#### Phase 6 — Library DB (2 weeks; coordinate with release artifact pipeline)

14. `portfolio_models.id` — DEFAULT v7 for new rows. Seeded `00000000…aa01` etc. preserved via `ON CONFLICT`.
15. `portfolio_model_layers/_workflows/_workflow_transitions/_artifacts/_terminology.id` — same.
16. `library_releases/_actions.id` — same. (`library_release_log.id` already v7 from Phase 2.)

Verification: run a full release artifact apply; confirm seeded UUIDs intact and new release rows are v7.

### 10.4 Rollback strategy

Every migration is a single `ALTER TABLE … ALTER COLUMN id SET DEFAULT mmff_uuidv7()`. Rollback is `… SET DEFAULT gen_random_uuid()`. **Idempotent and instant.** No data movement.

The only path that produces a hard-to-rollback state is dropping the `pg_uuidv7` extension while v7 IDs exist in the DB — fine, because the IDs are still valid `UUID` values; the extension is only needed for *new* generation.

### 10.5 Effort estimate

- Phase 1: 0.5 dev-week (extension install + function wrapper + tests)
- Phase 2: 1 dev-week (4 migrations, each one tiny; benefit is verifying the pattern under live load)
- Phase 3: 1 dev-week (mirror tables coordination)
- Phase 4: 2 dev-weeks (handler audit; v7-aware tests)
- Phase 5: 0.5 dev-week (deliberately deferred; just opt-in path)
- Phase 6: 1 dev-week (release-artifact pipeline coordination)

**Total: ~6 dev-weeks** of focused work, spread across 10–12 calendar weeks to allow soak time per phase. **Plus** the pre-conditions (RLS Phase A, reconciler in prod, contiguous-numbering canary) which are roughly another 4 dev-weeks.

### 10.6 Anti-goals

- **Do not** rewrite existing UUIDs in-place. The cost is huge and the upside is tiny (the index slowly self-cleans as v7 rows accumulate).
- **Do not** ship Phase 4 before Phase 2 has soaked. The append-only tables prove the operational pattern with the lowest blast radius.
- **Do not** migrate seeded library bundle UUIDs (§2.3).

---

## §11. Recommendations & Action Items

### 11.1 Quick wins (≤ 1 dev-week each, do in order)

1. **TD-DB-012 — Repair `cleanup_perm_test_tenants.sql`.** Sed-like rename `tenants → subscriptions`, `tenant_id → subscription_id`. Verify locally. ~1 hour.
2. **TD-DB-013 — Repair `provision_tenant_defaults()` seed function.** Same rename + verify with `\sf provision_tenant_defaults` and a fresh-DB build. ~2 hours.
3. **TD-DB-018 — Add migration-numbering CI canary.** ~1 hour.
4. **TD-DB-010 — Add append-only trigger to `audit_log`.** Copy the `error_events_append_only()` pattern. New migration 031. ~2 hours including test.
5. **TD-DB-014 — Add partial-unique on mirror `(subscription_id, source_library_id)` for all five mirrors.** New migration 032. ~3 hours including tests + verifying orchestrator can handle the constraint.
6. **TD-DB-019 — Add CHECKs for `users.auth_method`, `pages.kind`, `entity_stakeholders.role`.** New migration 033. ~3 hours.
7. **TD-DB-015 — Drop redundant `idx_users_email` and `idx_sessions_token_hash`.** New migration 034. ~1 hour.
8. **TD-DB-021 — Pre-launch security: rotate dev seed bcrypt hashes; rotate library role passwords; document the production-deploy fixture-scrub procedure.** Coordinate with `project_pre_launch_security`. ~1 dev-day.

### 11.2 Medium-term (1–4 dev-weeks each)

1. **TD-DB-011 / TD-LIB-007/008/009 — Centralise cross-DB writes.** Extend `backend/internal/entityrefs` (or sibling) to include `LoadLibraryRow(ctx, kind, id)`. Route every adoption mirror INSERT through it. Pair with reconciler scaffold.
2. **TD-LIB-003 — Implement the `pending_library_cleanup_jobs` worker** before any caller enqueues. In-process goroutine on the backend (TBD per `feature_library_db_and_portfolio_presets_v3.md §4`).
3. **TD-DB-017 — RLS Phase A** on `audit_log` and `error_events`. Validate the request-context session-variable pattern.
4. **TD-DB-020 — Encrypt MFA secrets at rest** before MFA enrolment ships. `pgcrypto.pgp_sym_encrypt` with key from `MASTER_KEY` env (already exists per memory entry).
5. **TD-LIB-001 — Drop JWT dual-accept** once one full refresh-token cycle has elapsed post-deploy. Single-file diff in `backend/internal/auth/tokens.go`.

### 11.3 Long-term (1+ months each)

1. **TD-DB-017 — RLS Phases B & C.** Roll out RLS to `*_state`/`*_history`, then full portfolio stack.
2. **UUID v7 migration (§10).** Defer until cross-DB and RLS work has soaked; ~6 dev-weeks across 10–12 calendar weeks.
3. **Time-based partitioning** of `audit_log`, `error_events`, `item_state_history` once any of them passes ~10M rows.
4. **TD-DB-016 — Split `mmff_vector_app` / `mmff_vector_migrate` roles** for least-privilege.
5. **Outbox consolidation** when the second outbox-shaped table proposes itself.
6. **Materialised views** for admin/billing dashboards.

### 11.4 Anti-goals (do NOT do these)

- Do not refactor v4 UUIDs in-place. Additive migration only.
- Do not enable RLS in `FORCE` mode on the portfolio stack as a single PR — staged rollout only.
- Do not ship the first archive handler for `workspace`/`portfolio`/`product` without `Refs.CleanupChildren()` in the same PR.
- Do not ship a second outbox-shaped table without consolidating with `pending_library_cleanup_jobs` first.
- Do not adopt `pg_uuidv7` until Postgres 17.x is the production version *and* a maintenance window is allotted.

### 11.5 Concrete next-PR proposal

If we land **one PR** out of all of the above, it should be the **append-only trigger on `audit_log`** (TD-DB-010). It is:

- 30 lines of SQL
- Catches a documented invariant (`c_security.md §4`) the DB doesn't currently enforce
- Zero risk: the writer code already obeys the rule; the trigger is belt-and-braces
- Sets the pattern for future cross-DB integrity work

```sql
-- db/schema/031_audit_log_append_only.sql
BEGIN;

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (TG_OP=%, table=%)',
        TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER trg_audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

COMMENT ON FUNCTION audit_log_append_only() IS
    'Enforces audit_log append-only invariant (c_security.md §4). '
    'Pairs with item_state_history and error_events triggers (same pattern).';

COMMIT;
```

Done.

---

## Appendix A — Files audited

```
db/schema/001_init.sql
db/schema/002_auth_permissions.sql
db/schema/003_mfa_scaffold.sql
db/schema/004_portfolio_stack.sql
db/schema/005_item_types.sql
db/schema/006_states.sql
db/schema/007_rename_permissions.sql
db/schema/008_user_nav_prefs.sql
db/schema/009_page_registry.sql
db/schema/010_nav_entity_bookmarks.sql
db/schema/011_nav_subpages_custom_groups.sql
db/schema/012_pages_partial_unique.sql
db/schema/013_polymorphic_dispatch_triggers.sql
db/schema/014_page_theme.sql
db/schema/015_user_nav_icon_override.sql
db/schema/016_user_custom_pages.sql
db/schema/017_subscriptions_rename.sql
db/schema/018_subscription_tier.sql
db/schema/019_pending_library_cleanup_jobs.sql
db/schema/020_portfolio_model_page.sql
db/schema/021_library_acknowledgements.sql
db/schema/022_library_releases_page.sql
db/schema/023_backfill_library_releases_pin.sql
db/schema/024_backfill_portfolio_model_pin.sql
db/schema/025_nav_group_reorder.sql
db/schema/026_subscription_portfolio_model_state.sql
db/schema/028_error_events.sql                    (027 missing)
db/schema/029_adoption_mirror_tables.sql
db/schema/030_unpin_gadmin_portfolio_model.sql

db/library_schema/001_init_library.sql
db/library_schema/002_roles.sql
db/library_schema/003_portfolio_model_bundles.sql
db/library_schema/004_portfolio_model_shares.sql
db/library_schema/005_grants.sql
db/library_schema/006_release_channel.sql
db/library_schema/007_grants_release_channel.sql
db/library_schema/008_error_codes.sql
db/library_schema/seed/001_mmff_model.sql
db/library_schema/seed/002_test_release.sql       (skimmed)
db/library_schema/seed/003_extra_models.sql       (skimmed)

db/seed/001_default_workspace.sql
db/ops/cleanup_perm_test_tenants.sql

docs/c_schema.md  (verified live 2026-04-25)
docs/c_polymorphic_writes.md
docs/c_security.md
docs/c_tech_debt.md
docs/c_c_schema_adoption_mirrors.md
```

## Appendix B — Verification commands referenced

```bash
# CI canary: contiguous migration numbering (§4.7)
ls db/schema/[0-9][0-9][0-9]_*.sql | awk -F_ '{print $1}' \
  | awk '{print substr($1,length($1)-2)}' | sort -n \
  | awk 'NR==1{prev=$1; next}{if($1!=prev+1){print "gap at "prev"->"$1; exit 1} prev=$1}'

# CI canary: subscription FK rule sweep (§3.2)
SELECT tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
JOIN information_schema.referential_constraints rc USING (constraint_schema, constraint_name)
JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
WHERE tc.constraint_type='FOREIGN KEY'
  AND tc.table_schema='public'
  AND ccu.table_name='subscriptions'
ORDER BY rc.delete_rule, tc.table_name;

# Refresh schema snapshot (from c_schema.md §Refresh this snapshot)
PGPASSWORD=… psql -h localhost -p 5434 -U mmff_dev -d mmff_vector -At -F '|' -c "
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name, ordinal_position;"

# v7 wrapper smoke test (§10.2)
SELECT mmff_uuidv7();
SELECT uuid_extract_timestamp(mmff_uuidv7());
```

---

*End of audit.*
