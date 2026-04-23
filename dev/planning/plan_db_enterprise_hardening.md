# Plan: Database Enterprise Hardening — Scale, Audit, Procurement Readiness

> **Status:** draft for review. Do not begin execution until the user has signed off on scope and sequencing.
> **Targets:** single-tenant scale ≥120,000 users (Barclays-on-Rally benchmark); global deployment of dozens-to-hundreds of tenants; SOC 2 Type 2 / ISO 27001 / banking-procurement (SIG, CAIQ v4) defensible.
> **Authors:** compiled from schema review of migrations 001–009 plus independent research on (a) enterprise Postgres practice and (b) auditor / procurement expectations. Sources in §12.

---

## 1. Why now

Nine migrations in, the schema is internally consistent and fit for the MVP. It is **not** yet fit for a 120k-user tenant or for banking-grade procurement. The problems that would bite at that scale are cheapest to fix now — before a single tenant has 10M audit rows, before any customer has signed a data-processing agreement, before a procurement questionnaire is on the desk.

Three forces compound:

1. **Scale.** Every hot table (`audit_log`, `item_state_history`, `sessions`) is unpartitioned and writing to a single B-tree. At Barclays-scale these become operational emergencies within 12–18 months of go-live.
2. **Isolation.** Tenant isolation is a convention enforced by application code, not by the database. A single missing `WHERE tenant_id = ?` is a cross-tenant data leak — and is an automatic high finding in any serious vendor security review.
3. **Procurement.** Banks, insurers, and governments reject vendors during security review if the schema lacks: immutable audit trail with tamper evidence, column-level classification, documented retention, Argon2id for passwords, RLS for tenant separation, data-residency controls, and a GDPR erasure procedure. We have none of these today.

The plan below addresses all three. It is staged so that each stage lands independently, ships value on its own, and does not require the next stage to be merged to remain safe.

---

## 2. Scope

**In scope:**

- Schema changes to every migration-visible table (001–009).
- New tables: `roles`, `permissions`, `role_permissions`, `user_roles`, `data_classification`, `consents`, `deletion_requests`, `icons` (future), `pii` split tables.
- New migration infrastructure: expand-contract discipline, `pgroll` adoption, CI linting of DDL.
- Postgres extensions: `pgcrypto` (have), `pgaudit`, `pgsodium` (or an app-level envelope), partitioning.
- Application-layer changes required to honour new constraints (RLS session variable, UUID lookups, partitioned writes).
- Documentation artefacts auditors require: data dictionary, ERD, retention schedule, encryption inventory.

**Out of scope (tracked separately):**

- Redis/KeyDB adoption for session fast-path (§5.4 flags the need; implementation is its own plan).
- Full multi-region DB split (§5.6 defines the seam; actual regional deploy is post-first-enterprise-tenant).
- pg_repack / bloat reclaim procedures (operational runbook, not schema).
- Backup + PITR policy (exists; needs formal RPO/RTO documented — §11).

**Non-negotiables:**

- No changes are applied to the live DB without a reviewed migration file and a rollback path.
- Expand-contract for every column rename or retype. No in-place renames that break readers.
- Every new table carries `tenant_id NOT NULL` (except global catalogues) and `(tenant_id, …)` leading-column indexes.

---

## 3. Findings against current schema

Grouped by severity — severity is what a SOC 2 / banking auditor would assign, not a bug-tracker priority.

### 3.1 High — block procurement

| # | Finding | Evidence | Risk |
|---|---|---|---|
| H1 | **Tenant isolation is convention-only.** No RLS on any table. A single missing `WHERE tenant_id = ?` in backend code leaks data across tenants. | Every table in 001–009. No `CREATE POLICY` anywhere. | Auditors test for this explicitly. "Show me the query that prevents cross-tenant reads" — current answer is "the app filters it." Automatic high finding. |
| H2 | **`audit_log` is not tamper-evident.** App role has full `INSERT/UPDATE/DELETE`. No hash chain, no append-only trigger, no WORM ship. | [001_init.sql:75-85](../../db/schema/001_init.sql#L75) | SOC 2 CC7.2 / ISO 27001 A.12.4 expect evidence of immutability. "We promise not to update it" is a finding. |
| H3 | **Bcrypt cost 12.** Acceptable as legacy; **Argon2id** is the 2025–2026 OWASP default. Procurement questionnaires (SIG, CAIQ v4) ask the algorithm by name. | [001_init.sql:36](../../db/schema/001_init.sql#L36) | Not an automatic fail but routinely flagged. Also: no upgrade path — PHC string format not in use. |
| H4 | **PII columns unencrypted and unclassified.** `users.email`, `sessions.ip_address`, `sessions.user_agent`, `audit_log.ip_address`, `password_resets.requested_ip`. No `data_classification` metadata. | Migrations 001, 002. | Banks ask for column-level classification and encryption inventory. IP addresses are PII under GDPR. |
| H5 | **No GDPR Article 17 machinery.** Soft-archive (`archived_at IS NOT NULL`) does not satisfy right-to-erasure. No `deletion_requests` table, no crypto-shred procedure, no backup-replay registry. | Entire schema. | Any EU customer's DPA will require this in writing before signature. |
| H6 | **Polymorphic FKs not enforced at DB layer.** `entity_stakeholders.entity_id`, `item_type_states.item_type_id`, `item_state_history.item_id`, `item_type_transition_edges.from_state_id` pairing. | [004_portfolio_stack.sql:165-177](../../db/schema/004_portfolio_stack.sql#L165), [006_states.sql:127-141](../../db/schema/006_states.sql#L127) | Auditors ask "prove referential integrity of tenant-scoped data." "App layer enforces it" is a high finding against NIST 800-53 AU-10. |
| H7 | **Password hash seeded in migration file.** `$2b$12$N9qo8uL…` is checked in. Harmless in dev; shipping to production with this exact hash would be catastrophic. | [001_init.sql:123](../../db/schema/001_init.sql#L123) | Any static analysis sweep flags this. Need an explicit first-deploy rotation ceremony. |

### 3.2 Medium — break at scale

| # | Finding | Evidence | Risk |
|---|---|---|---|
| M1 | **Unpartitioned append-only tables.** `audit_log` and `item_state_history` grow unboundedly. At 120k users × ~100 audit events/day = 12M rows/day/tenant; one year = 4.4B rows per tenant. | [001_init.sql:75](../../db/schema/001_init.sql#L75), [006_states.sql:127](../../db/schema/006_states.sql#L127) | VACUUM stalls, index bloat, archive/retention becomes surgical instead of `DETACH PARTITION`. Retrofit is orders of magnitude harder than new-build. |
| M2 | **UUIDv4 primary keys on hot insert tables.** Random inserts fragment B-tree cache. | `gen_random_uuid()` on every table. | Measurable insert regression at ~50M rows. **UUIDv7** (time-ordered) solves it without losing UUID semantics. |
| M3 | **`sessions` table is a hot row.** Every token refresh updates `last_used_at`. At 120k concurrent users this is a write-amplification bomb. | [001_init.sql:55-65](../../db/schema/001_init.sql#L55) | Postgres can do 2–20k session writes/s per table before contention; enterprise auth externalises this to Redis/KeyDB. Interim mitigation: write-behind batching, partial indexes. |
| M4 | **No leading-`tenant_id` composite indexes on most tables.** Indexes exist on `tenant_id` alone, not `(tenant_id, other)`. Under RLS this is the difference between 0.8ms and 120ms queries. | Migrations 004, 005, 006, 008, 009. | Will surface as sudden p99 spikes the first time a large tenant onboards. |
| M5 | **String identifiers coupled with display.** Previous thread established the rule — `key_enum`, `tag_enum`, `entity_kind`, `item_type_kind`, `item_key TEXT` — to be UUID-first. | [008_user_nav_prefs.sql:28](../../db/schema/008_user_nav_prefs.sql#L28), [009_page_registry.sql](../../db/schema/009_page_registry.sql) | Rename pain; DBA reconciliation overhead; user-custom pages blocked. |
| M6 | **`entity_stakeholders` has no `archived_at`.** Hard-deletes stakeholder history; inconsistent with the rest of the hierarchy's soft-archive rule. | [004_portfolio_stack.sql:165](../../db/schema/004_portfolio_stack.sql#L165) | Breaks the SoW §7 "no hard deletes" contract. |
| M7 | **No connection pooling strategy.** 120k users × a few persistent connections each is not survivable without PgBouncer (or PgCat) in transaction mode. | Infrastructure layer — flagged here because schema choices (e.g. temp tables, prepared statements) must be compatible. | Not a schema bug; schema decisions need to anticipate transaction-mode pooling. |
| M8 | **MFA scaffold exposes secret in plaintext column.** `mfa_secret TEXT` and `mfa_recovery_codes TEXT[]` — fine as scaffolding, but the day MFA is enabled this becomes a high finding unless the column is encrypted. | [003_mfa_scaffold.sql:10-14](../../db/schema/003_mfa_scaffold.sql#L10) | Must be encrypted at rest with a KMS-held key before MFA is turned on. Belongs in this plan, not the MFA plan. |
| M9 | **`tenant_sequence` is a row-lock counter.** `FOR UPDATE` on a single row per `(tenant, scope)` serialises all key-num allocation within that scope. | [004_portfolio_stack.sql:29-35](../../db/schema/004_portfolio_stack.sql#L29) | Fine at current load; at 120k users with high creation throughput this becomes a throughput ceiling. Alternatives: per-session sequence chunks, Postgres sequences per scope (gap-permissive anyway). |
| M10 | **No `pgaudit`.** DDL and role changes invisible to the audit trail. | — | SOC 2 evidence gap. Postgres-level audit is cheap to enable and transforms the auditability story. |

### 3.3 Low — defensible, worth noting

| # | Finding | Risk |
|---|---|---|
| L1 | `user_role` is a Postgres ENUM (`'user','padmin','gadmin'`). Enums can't drop values without rebuild. If the role model ever evolves (e.g. add `'auditor'` then later want to remove it), this is annoying. Swap for a `roles` lookup table. |
| L2 | `updated_at` set by trigger — fine, but triggers fire on every update including no-op updates where no column changed. `WHEN (OLD.* IS DISTINCT FROM NEW.*)` guard is 1 line of defence. |
| L3 | `failed_login_count` is incrementable without bound; `locked_until` not tied to a monotonically-clear policy. Lockout policy should live in a tiny `security_policy` table readable by the auth service, not hardcoded. |
| L4 | `password_resets` has no per-user rate limit in the schema. App layer handles it; a `(user_id, created_at)` partial index with a CHECK or trigger would harden it. |
| L5 | `sessions.revoked` is a boolean; better would be `revoked_at TIMESTAMPTZ NULL` + a `revoke_reason` column — auditors want to know *why* (logout, password change, admin revoke, anomaly). |
| L6 | No `request_id` / correlation ID in `audit_log`. Request tracing across services is harder without it. One TEXT column; trivial. |
| L7 | No `tenant_id` on `sessions` — present on `users`, but joining to it on hot auth paths is wasted work. Denormalise. |
| L8 | `is_active BOOLEAN` on `tenants` and `users` is fine; auditors prefer `deactivated_at TIMESTAMPTZ` because it reveals when and (via audit_log) by whom. |
| L9 | `canonical_states` is global (no tenant scope). Correct for MVP. Document that it is a global catalogue to avoid future confusion. |

---

## 4. The target schema, in one paragraph each

Not a full DDL dump — a description of the shape the schema needs to reach, organised so each stage below can be read against it.

- **Tenant spine.** `tenants` unchanged; gains `region TEXT NOT NULL` and `deactivated_at TIMESTAMPTZ`. Every tenant-scoped table has RLS ON with a policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. App opens every connection with `SET LOCAL app.tenant_id = '…'`.
- **Identity split.** `users` keeps operational columns (id, role_id, tenant_id, created_at, last_login, is_active, status, auth_method). PII columns (`email`, future `full_name`, `phone`) move to `users_pii` (1:1 FK, restricted `SELECT` to the auth role only). `password_hash` becomes a PHC string with an algorithm column.
- **Roles as data.** `roles`, `permissions`, `role_permissions`, `user_roles(user_id, role_id, granted_by, granted_at, expires_at)`. `users.role` column retires in expand-contract. `user_role` enum retires.
- **Audit trail.** `audit_log` becomes `audit_log` partitioned monthly by `occurred_at`. New columns: `actor_type`, `impersonated_by`, `target_type`, `target_id`, `session_id`, `request_id`, `outcome`, `reason`, `before_value JSONB`, `after_value JSONB`, `hash_prev BYTEA`, `hash_self BYTEA`. App role granted `INSERT` only; `UPDATE`/`DELETE` revoked. Monthly partitions detach to cold storage after 12 months per a documented retention policy. `pgaudit` turned on for DDL + role changes, writing to the same trail.
- **State history.** `item_state_history` partitioned monthly by `transitioned_at`. `(tenant_id, item_id, transitioned_at)` composite index. Append-only triggers stay as defence in depth.
- **Sessions.** `sessions` gains `tenant_id`, `revoked_at`, `revoke_reason`. `last_used_at` writes are batched (write-behind in app layer; schema is fine). Fast-path moves to Redis in a later plan (§5.4 flag).
- **Page registry with UUID identity.** `pages.key_enum` becomes nullable (present for system rows only, for code lookup). `user_nav_prefs.item_key TEXT` → `user_nav_prefs.page_id UUID REFERENCES pages(id)` via expand-contract. `page_tags` gains `id UUID PK`, `tag_enum` becomes UNIQUE but not PK. `pages.tag_enum` → `tag_id UUID FK`. `icon` stays as a TEXT token until the "custom icons" feature lands (agreed earlier).
- **Polymorphic FKs resolved.** Two options, chosen per table: (a) split `entity_stakeholders` into one-table-per-entity-kind (ugly, strict); (b) keep polymorphic but add a `pg_trigger` that verifies `(entity_kind, entity_id)` resolves via a dispatch function. Recommended: **(b) for now, (a) if an auditor specifically flags it.** Applies also to `item_type_states`, `item_state_history`.
- **Classification catalogue.** `data_classification(table_name, column_name, classification, retention_days, encryption, owner)` populated from a `COMMENT ON COLUMN` pass. Becomes the live data dictionary auditors ask for.
- **GDPR machinery.** `consents`, `deletion_requests`, `data_subject_export` view. Erasure procedure documented and tested.

---

## 5. The plan, in stages

Each stage is independently shippable. Each ends with a verification block that proves the stage landed cleanly.

### Stage 1 — Safety net before any DDL changes (no schema changes)

**Goal:** make it safe to change the schema. No table DDL in this stage.

1. **Adopt `pgroll` or an expand-contract runner.** Currently migrations are raw SQL applied with `psql < file`. That's fine for greenfield; it's unsafe for `ALTER TABLE` on a live table with data.
2. **Add a DDL linter in CI.** Reject dangerous patterns: `ALTER TABLE … ADD COLUMN … NOT NULL` without default on PG < 11, `ALTER TYPE … RENAME VALUE` on a hot enum, `CREATE INDEX` without `CONCURRENTLY`, `DROP COLUMN` before an expand-contract shadow period.
3. **Document the migration runbook.** `docs/c_c_postgresql_migrations.md` (exists in the librarian plan — wire up). Every migration: expand → backfill → contract. No exceptions.
4. **Take a verified PITR-capable backup of the current live DB.** Prove restore works against a throwaway container.
5. **Establish two DB roles:** `mmff_app` (app runtime; narrow grants) and `mmff_migrator` (DDL-capable; used only by migration runner). Current setup likely uses the superuser for both.

**Verification.**
- A dummy expand-contract migration runs end-to-end under `pgroll`, visible in two schema versions simultaneously.
- CI blocks a deliberately dangerous migration.
- Restore drill documented with timing numbers.
- `mmff_app` cannot `ALTER` or `DROP` anything; attempt fails with permission error.

### Stage 2 — Tenant isolation via RLS (High H1)

**Goal:** Postgres enforces tenant isolation. A forgotten `WHERE tenant_id = ?` returns zero rows instead of leaking data.

1. **Add `app_tenant_id` GUC contract.** Backend opens every connection (or runs at transaction start under PgBouncer transaction mode) with `SET LOCAL app.tenant_id = $1`. Unset → policies return zero rows.
2. **Create RLS policies on every tenant-scoped table** (13 tables): `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);` followed by `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`.
3. **Grant bypass to `mmff_migrator` and `mmff_readonly_reporting`** (future analytics role) only — never to `mmff_app`.
4. **Add `(tenant_id, …)` composite indexes everywhere the plan query goes through a policy.** Drop redundant single-column `tenant_id` indexes after composite ones are in place.
5. **Write isolation tests.** A Go test suite that: (a) creates two tenants, (b) seeds data in both, (c) opens a connection scoped to tenant A, (d) attempts every read and write on tenant B's data, (e) asserts zero rows / permission denied every single time. Runs in CI.
6. **Audit leak scan.** A one-off SQL script that executes every registered backend query with `app.tenant_id` intentionally unset; any query that returns rows is a bug to fix in the app layer (query is bypassing the context setter).

**Verification.**
- Isolation test suite: 100% green. A deliberately-broken policy (one table un-policied) fails the suite.
- `EXPLAIN` on hot queries shows the composite index path.
- RLS overhead measured: <5% on representative workload.

**Risks.**
- R2.a: background jobs or one-off scripts forget to set `app.tenant_id`. Mitigation: wrap the DB client so it's impossible to `Query()` without a tenant in context; a dedicated `SystemQuery()` path takes the bypass role explicitly.
- R2.b: global unique constraints (e.g. `users.email` originally) can leak cross-tenant existence. Current schema scopes email by tenant, so safe; audit the rest.

### Stage 3 — Audit trail hardening (High H2, Medium M10)

**Goal:** tamper-evident, retention-policy-enforced, monthly-partitioned audit log that survives procurement.

1. **Expand `audit_log`** with the columns listed in §4: `actor_type`, `impersonated_by`, `target_type`, `target_id`, `session_id`, `request_id`, `outcome`, `reason`, `before_value`, `after_value`, `hash_prev`, `hash_self`. All nullable during backfill.
2. **Convert to `PARTITION BY RANGE (occurred_at)`** via `pg_partman` or manual. New rows write to monthly partitions; existing rows backfilled into a history partition.
3. **Trigger-enforced hash chain.** `BEFORE INSERT` trigger sets `hash_self = sha256(hash_prev || row_payload)` where `hash_prev` = the most recent row's `hash_self` for the same tenant. Stored as BYTEA.
4. **Revoke `UPDATE` and `DELETE` from `mmff_app`** on `audit_log`. App has `INSERT` only.
5. **`BEFORE UPDATE/DELETE` trigger** raises an exception — defence in depth even if a grant is accidentally re-added.
6. **Enable `pgaudit` extension.** Configure for DDL + role grants + superuser actions; output goes to the same append-only trail via a logging sidecar.
7. **Retention policy.** `docs/c_security.md` (new leaf: `c_c_security_retention.md`) documents: 13 months hot, 7 years cold for banking/financial tenants, 2 years cold for EU-only tenants. Monthly partitions `DETACH`ed to S3 with Object Lock.
8. **Forbid sensitive payloads in audit.** Code review checklist + a CI grep-based lint: no `password`, `token`, `secret`, `mfa_secret`, `recovery_code`, `card_number`, raw `request.body` in audit writes.

**Verification.**
- `DELETE FROM audit_log` from `mmff_app` fails with permission error.
- Inserting a hand-crafted row with a wrong `hash_prev` is rejected by the chain trigger.
- `DETACH PARTITION` of a 13-month-old partition, restore from cold storage, and re-attach — end-to-end drill.
- `pgaudit` captures a `CREATE TABLE` run by `mmff_migrator` in the DDL log.

### Stage 4 — Identity, roles, passwords (High H3, H4; Low L1)

**Goal:** passwords are Argon2id with an upgradeable PHC string. Roles are data. PII is separated.

1. **`users.password_hash`** gains companion `password_algo TEXT` (`'bcrypt' | 'argon2id'`). Legacy rows stay bcrypt until next login; on successful login with bcrypt the app re-hashes with Argon2id and migrates the row. New users write Argon2id from day one.
2. **`roles`, `permissions`, `role_permissions`, `user_roles`.** Seeded with the current triple `user / padmin / gadmin` and their implicit grants mapped out by reading current backend authorisation code. `users.role` column kept during expand; readers updated; column dropped in contract after soak period.
3. **PII split.** `users_pii(user_id, email, full_name, phone, …)` with RLS + `GRANT SELECT` only to the auth role. Operational reads (e.g. item assignments) use `users.id` and never select email. Views `users_safe` (id, role, active) and `users_full` (with PII via join) for explicit opt-in.
4. **Secrets hygiene.** The seeded password hash in [001_init.sql:123](../../db/schema/001_init.sql#L123) is replaced with a `-- FIRST BOOT: run scripts/rotate_admin.sh` comment and the hash moves to a non-tracked bootstrap script. Document the first-boot ceremony.
5. **MFA secret encryption.** `mfa_secret` column becomes `mfa_secret_encrypted BYTEA`; encryption via `pgsodium` (preferred) or an envelope scheme where the DEK lives in KMS. Decrypted server-side only by the auth service role, which holds the KEK.

**Verification.**
- Seed tenant admin creates a user; inspect the row — `password_algo = 'argon2id'`, hash starts with `$argon2id$v=19$`.
- Old bcrypt user logs in once → next row inspection shows Argon2id.
- `mmff_app` cannot `SELECT` from `users_pii` directly; only via the auth-service role.
- No plaintext `mfa_secret` anywhere in the DB.

### Stage 5 — Identifier hygiene (Medium M5)

**Goal:** ship the earlier UUID-first decision. Make `id` the golden rule.

1. Migration 010: `ALTER TABLE pages ALTER COLUMN key_enum DROP NOT NULL;` + add `user_nav_prefs.page_id UUID REFERENCES pages(id) ON DELETE CASCADE`.
2. Backfill: `UPDATE user_nav_prefs SET page_id = p.id FROM pages p WHERE user_nav_prefs.item_key = p.key_enum AND p.tenant_id IS NULL;`.
3. Expand-contract: backend reads by `page_id` first, falls back to `item_key` lookup; after soak, reads by `page_id` only.
4. Migration 011: drop `user_nav_prefs.item_key`.
5. Migration 012: `page_tags` gains `id UUID PK DEFAULT gen_random_uuid()`. Add `pages.tag_id UUID REFERENCES page_tags(id)` via expand-contract. `pages.tag_enum` retires after soak.
6. Document in `docs/c_schema.md`: the **UUID-first rule**. Identifiers are UUIDs. Human-readable fields are display, never references.

**Verification.**
- Creating a user-custom page via the new catalogue API writes a row with `key_enum IS NULL`, `id = <uuid>`, `created_by = <user>`.
- Renaming a system page updates only `label`; no FK cascade, no prefs churn.

### Stage 6 — UUIDv7 + partitioning for scale (Medium M1, M2, M4)

**Goal:** hot insert tables stop fragmenting. Ten-year horizon data is tractable.

1. **UUIDv7 for new hot tables.** Add `uuidv7()` as a SQL function (Postgres 17+ has `uuidv7()`; on 16 and below, a plpgsql implementation). Apply to `audit_log`, `item_state_history`, future high-write tables. Existing tables keep v4 PKs; acceptable because their write rates are moderate.
2. **Partition `audit_log` and `item_state_history`** monthly on `occurred_at` / `transitioned_at`. Migration creates new partitioned parent, backfills in batches (`LOCK TABLE … IN EXCLUSIVE MODE` window scheduled during low traffic), atomically swaps via `RENAME`.
3. **Composite leading-`tenant_id` indexes everywhere.** Drop redundant single-column `tenant_id` indexes.
4. **`pg_partman`** installed to manage partition lifecycle (create next month's partition 30 days ahead; detach older-than-retention partitions automatically).

**Verification.**
- `\d+ audit_log` shows partitioned table; current-month partition takes writes; prior months exist and are read-only.
- `EXPLAIN` on a tenant-scoped + date-scoped audit query shows partition pruning.
- Insert throughput benchmark: ≥5k rows/s sustained on `audit_log` with all triggers and chain hash.

### Stage 7 — GDPR machinery (High H5)

**Goal:** provable right-to-erasure, consent tracking, data export.

1. **`consents(subject_id, purpose, policy_version, granted_at, withdrawn_at, source_ip, user_agent)`.** Append-only. New row per change.
2. **`deletion_requests(id, subject_id, tenant_id, requested_at, completed_at, method, backup_replay_due_by, operator_id, evidence_ref)`.**
3. **Crypto-shred procedure.** For a deleted user: (a) per-user data encryption key is thrown away so ciphertext PII becomes unreadable; (b) or, if no per-user DEK, an UPDATE sets `email = 'REDACTED-' || id`, `full_name = NULL`, `phone = NULL`, and equivalent for every PII column — generated from the `data_classification` catalogue. Audit log preserved (facts, no PII).
4. **`data_subject_export` view.** Joins every PII table by subject id. GDPR Article 20 responses become one query.
5. **Backup-replay registry.** When a backup is restored within retention window, scan `deletion_requests WHERE backup_replay_due_by > now()` and re-run crypto-shred against the restored state.
6. **Document the procedure** in `docs/c_c_security_gdpr.md`: legal basis, timeline (30 days default), who can initiate, evidence kept.

**Verification.**
- End-to-end drill: request erasure → procedure runs → original email unretrievable → audit shows erasure → export view returns zero PII rows for that subject → backup restore triggers re-erasure.

### Stage 8 — Polymorphic FK tightening (High H6)

**Goal:** auditor-defensible referential integrity for polymorphic relationships.

1. **Dispatch-trigger pattern.** For each polymorphic FK (e.g. `entity_stakeholders (entity_kind, entity_id)`), a `BEFORE INSERT OR UPDATE` trigger calls a dispatch function that resolves `entity_kind` to a target table and verifies the row exists with matching `tenant_id`. Raises on mismatch.
2. **Same treatment** for `item_type_states.(item_type_id, item_type_kind)` → `portfolio_item_types` / `execution_item_types`. And `item_state_history.(item_id, item_type_id, item_type_kind)` → eventual item tables.
3. **`archived_at` on `entity_stakeholders`** for SoW §7 compliance.

**Verification.**
- Attempting to insert a stakeholder with a non-existent `entity_id` fails. With a mismatched `tenant_id` fails. With both valid, succeeds.

### Stage 9 — Connection pooling & session hot path (Medium M3, M7)

**Goal:** 120k concurrent users don't DoS the DB with connections or session writes.

1. **PgBouncer in transaction mode.** Document max-client-conn, default-pool-size, server-round-robin. Schema-compatibility check: no session-scoped state (prepared statements protocol-level, temp tables, `LISTEN/NOTIFY` long-lived) used by app. Flag any that are.
2. **Session `last_used_at` write-behind.** App batches updates every N seconds instead of per-request. Schema supports as-is; flag the app change.
3. **Partial index on active sessions** (`WHERE revoked_at IS NULL AND expires_at > now()`). Existing sessions scan faster.
4. **Flag for separate plan:** Redis/KeyDB for session fast-path. Schema stays as system-of-record for refresh tokens; Redis holds live session state.

**Verification.**
- PgBouncer in place; app works through it. Benchmark: 500 client connections against a 20-conn pool, no errors.
- Session refresh benchmark: ≥2k refreshes/s sustained without table-level lock contention.

### Stage 10 — Data classification, dictionary, procurement pack (High H4; ongoing)

**Goal:** deliver the documents procurement will ask for. Without these, steps 1–9 are only half the value.

1. **`data_classification` table** populated by one pass over every column: `(schema, table, column, classification, pii, retention_days, encryption, owner)`.
2. **`COMMENT ON COLUMN`** everywhere, mirroring `data_classification`. Easier for DBAs inspecting the DB directly.
3. **ERD generation.** Use `pg_dump --schema-only` + SchemaSpy or DbSchema to generate an ERD; check into `docs/db/erd/` as SVG + PDF. Regenerated in CI.
4. **Data dictionary MD file** per tenant-scoped table: purpose, key columns, retention, classification, indexes. Generated from `data_classification` + `COMMENT`s.
5. **Retention schedule document.** One table per data category, retention period, enforcement mechanism, last-reviewed date.
6. **Encryption inventory.** What's encrypted at rest (volume level), which columns are application-encrypted, algorithm, key custodian, rotation cadence.
7. **SIG / CAIQ drafts.** Populate answers against the new state of the schema. Keep with the procurement pack.

**Verification.**
- Hand the docs pack + schema to a reviewer pretending to be a banking vendor-risk team; they find zero "we need X before signing" items.

### Stage 11 — Multi-region seam (Medium — anticipated, not executed)

**Goal:** schema decisions anticipate per-region DB clusters without requiring a later rewrite.

1. **`tenants.region TEXT NOT NULL`** added now (single region at first). Routing layer honours it.
2. **Every UUID is globally unique** — already true with v4/v7, keep it.
3. **No cross-tenant or cross-region FK** — already true; document the invariant.
4. **Event-based read models** replace synchronous cross-region joins when multi-region lands. Out of scope to build now; in scope to not preclude.

**Verification.**
- A test harness with two Postgres instances ("eu", "us") and a control-plane tenants table proves a tenant's traffic hits only its regional DB. Pass/fail documented as the seam passing.

---

## 6. Execution order and dependencies

```
Stage 1 (safety net) ──▶ Stage 2 (RLS) ──▶ Stage 3 (audit) ──▶ Stage 10 (docs, partial)
                                    │           │
                                    ├──▶ Stage 4 (identity, passwords)
                                    │
                                    └──▶ Stage 5 (UUID-first) ──▶ Stage 6 (UUIDv7 + partitioning) ──▶ Stage 10 (docs, updated)
                                                                    │
                                                                    └──▶ Stage 9 (pooling, hot path)
                                    
Stage 3 ──▶ Stage 7 (GDPR — needs audit trail in place)

Stage 8 (polymorphic FK) can run in parallel with Stages 4–7.

Stage 11 (multi-region seam) — any time after Stage 5; cheapest if done with Stage 6.
```

Gate between stages: next stage does not start until the previous stage's verification block is all green and has been demonstrated in a review session.

---

## 7. Confidence and uncertainty

**High confidence (will land as described):**

- RLS is the right answer. It is now the 2024–2026 industry consensus for multi-tenant Postgres and is exactly what auditors look for as defence-in-depth.
- Argon2id with PHC strings is the password answer. Bcrypt cost-12 is acceptable legacy.
- Monthly partitioning of append-only tables with `DETACH PARTITION` for retention is the standard pattern.
- UUID-first identifier rule (from the earlier thread) is correct; implementation shape is clear.
- `pgaudit` is the right DDL audit tool.

**Medium confidence (need decision points during execution):**

- **Polymorphic FK resolution.** Dispatch trigger vs table-per-kind is a tradeoff — the trigger is simpler but auditors sometimes still ask for "real" FKs. Defer the final call to Stage 8 when we see what a specific auditor actually wants.
- **`pgroll` vs home-grown expand-contract runner.** `pgroll` is excellent and active; the only risk is operational dependency on a young-ish tool. Can fall back to a documented manual runbook if that's preferred.
- **Per-user DEK for crypto-shred vs field-level redaction.** Per-user DEK is cleaner but adds key-management overhead. Field-level redaction with a hash-chain marker is simpler and passes audits; I lean this way for MVP.
- **Session fast-path.** Redis is the industry default but adds operational surface area. If we stay Postgres-only, write-behind + partial index holds us to ~20k concurrent users comfortably — which is still well below 120k. The call can wait.

**Low confidence / requires user input:**

- **Retention periods.** 13 months hot / 7 years cold is a banking-industry default. EU-only customers may want less. Call to be made with legal before Stage 3 ships.
- **Region list.** Which regions do we commit to? UK, EU, US-east, AU are common first set; depends on first enterprise tenant.
- **Break-glass procedure.** Who has `mmff_migrator` credentials? 2-of-N approval? Separate document, not a schema decision.

---

## 8. Estimated effort

Rough order-of-magnitude; assumes one engineer on it full-time, with review.

| Stage | Effort | Notes |
|---|---|---|
| 1 — safety net | 3–5 days | `pgroll` integration + CI lint + role split. |
| 2 — RLS | 4–6 days | Mechanical per table; test suite is the long tail. |
| 3 — audit hardening | 5–8 days | Partitioning + hash chain + `pgaudit` + retention runbook. |
| 4 — identity, passwords | 4–6 days | Argon2id migration path + PII split + role data model. |
| 5 — UUID-first identifiers | 2–3 days | Narrow, focused on pages + nav prefs. |
| 6 — UUIDv7 + partitioning | 4–6 days | Mostly migrations; some app changes. |
| 7 — GDPR machinery | 3–5 days | Procedure + registry + export view + drill. |
| 8 — polymorphic FK | 3–4 days | Dispatch triggers + tests. |
| 9 — pooling + hot path | 2–4 days | PgBouncer config + write-behind; Redis is separate plan. |
| 10 — docs pack | 3–5 days | Parallel with all other stages; can be partly automated. |
| 11 — multi-region seam | 1–2 days | Schema-level only; real regionalisation is separate. |

**Total: 34–54 engineering days.** Call it 7–11 weeks at one engineer, 4–6 weeks at two.

---

## 9. What we are NOT doing (deliberate)

- **Schema-per-tenant or DB-per-tenant.** Shared-DB with RLS is the right call at our tenant count. Revisit only if a regulated customer contractually demands physical isolation — and then it's a silo for that tenant, not a model change.
- **Full end-to-end encryption of all PII.** Volume-level (TDE) + application-level for high-sensitivity (MFA secrets, future payment details) is the pragmatic middle. Full column-level encryption of everything is operationally painful and not required by SOC 2 for standard PII.
- **Dropping the `user_role` enum before Stage 4 ships.** Coupling the rename with the roles-as-data work avoids two rounds of app changes.
- **Redis / KeyDB rollout.** Flagged; not in this plan. Write-behind + partitioning gets us to enterprise scale comfortably; Redis is the cherry on top.
- **Temporal tables / system-versioning.** Tempting for audit; adds complexity. `audit_log` + state history + `updated_at` triggers are enough.

---

## 10. Rollout risks & mitigations

| Risk | Mitigation |
|---|---|
| RLS regressions in a background job | Wrap DB client; `SystemQuery` for bypass role; isolation tests in CI. |
| Migration long-lock on `ALTER TABLE` | Expand-contract + `NOT VALID` FK pattern + `CONCURRENTLY` indexes. |
| Hash-chain trigger becomes a write bottleneck | Benchmark in Stage 3 before committing; fall back to per-tenant chain if needed. |
| Password migration breaks existing users | Dual-algorithm support; migrate on successful login; no big-bang. |
| `pgroll` bug mid-migration | Manual rollback runbook for each migration; backup before every deploy. |
| Procurement asks for something not in this plan | §10 reviews quarterly; anything new routed into Stage 10's ongoing work. |

---

## 11. Verification: how we prove 95% confidence after execution

Beyond per-stage verifications:

1. **Pen-test brief**: third-party ASV runs a multi-tenant isolation test and a OWASP ASVS 4.0 Level 2 pass. Zero critical, zero high.
2. **Schema review by an external DBA** (1-day engagement) with Postgres-at-scale background. Written report files in `dev/planning/`.
3. **SOC 2 readiness assessment** against CC6/CC7 — either internal or via compliance consultancy. Document the findings and remediation status.
4. **Load test at 10% of target**: 12k simulated users against a single tenant, full workflow, 30-minute steady-state. p99 < 500ms on sidebar, audit writes, item create.
5. **Restore drill**: take yesterday's backup, restore into a clean cluster, run the isolation test suite against it, execute a deletion request against it, confirm retention policy machinery runs.
6. **Procurement dry run**: hand the docs pack to someone playing vendor-risk for a banking customer. Capture their "missing X" questions. Iterate.

Sign-off threshold: all six complete, documented, and signed by engineering + security lead.

---

## 12. Sources

Research briefings that informed this plan (two independent agent passes):

**Enterprise Postgres practice:**
- AWS — [Multi-tenant data isolation with Postgres RLS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- AWS Prescriptive Guidance — [RLS recommendations for multi-tenant Postgres](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html)
- PlanetScale — [Approaches to tenancy in Postgres](https://planetscale.com/blog/approaches-to-tenancy-in-postgres)
- Crunchy Data — [Designing Postgres for multi-tenancy](https://www.crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy)
- Crunchy Data — [RLS for tenants in Postgres](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)
- Permit.io — [Postgres RLS implementation guide](https://www.permit.io/blog/postgres-rls-implementation-guide)
- Bytebase — [Postgres RLS footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/)
- Bytebase — [Postgres audit logging guide](https://www.bytebase.com/blog/postgres-audit-logging/)
- Elephas — [Audit logging with Postgres partitioning](https://elephas.io/audit-logging-with-postgres-partitioning/)
- LogVault — [audit_logs table anti-pattern](https://www.logvault.app/blog/audit-logs-table-anti-pattern)
- Tiger Data — [Audit logging in Postgres](https://www.tigerdata.com/learn/what-is-audit-logging-and-how-to-enable-it-in-postgresql)
- Xata — [Zero-downtime schema migrations](https://xata.io/blog/zero-downtime-schema-migrations-postgresql)
- pgroll — [github.com/xataio/pgroll](https://github.com/xataio/pgroll)
- Aha! Engineering — [Partitioning a large table in Postgres](https://www.aha.io/engineering/articles/partitioning-a-large-table-in-postgresql-with-rails)

**Audit & procurement:**
- NIST SP 800-53 Rev 5 — [Controls catalogue (final)](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
- Cloud Security Alliance — [STAR / CAIQ v4](https://cloudsecurityalliance.org/artifacts/star-level-1-security-questionnaire-caiq-v4)
- Shared Assessments — SIG questionnaire ([UpGuard explainer](https://www.upguard.com/blog/sig-questionnaire))
- OWASP — [Password Storage Cheat Sheet (Argon2id)](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- Gupta — [Password hashing guide 2026](https://guptadeepak.com/research/password-hashing-guide-2026/)
- RiskImmune — [SOC 2 audit log retention guidance](https://riskimmune.ai/blog/soc-2-audit-log-retention-technical-configuration-and-completeness-tests)
- Hoop.dev — [Immutability for SOC 2](https://hoop.dev/blog/immutability-for-soc-2-how-to-protect-evidence-logs-and-records-permanently/)
- Hoop.dev — [NIST 800-53 PII detection](https://hoop.dev/blog/nist-800-53-pii-detection-requirements-controls-and-compliance-strategies)
- Konfirmity — [SOC 2 data retention guide (2026)](https://www.konfirmity.com/blog/soc-2-data-retention-guide)
- GDPR — [Article 17 right to erasure](https://gdpr-info.eu/art-17-gdpr/)
- ProBackup — [GDPR deletion requests and backups](https://www.probackup.io/blog/gdpr-and-backups-how-to-handle-deletion-requests)

**Internal references:**
- Schema migrations: [db/schema/001_init.sql](../../db/schema/001_init.sql) through [db/schema/009_page_registry.sql](../../db/schema/009_page_registry.sql)
- Existing planning: [plan_nav_registry_split.md](./plan_nav_registry_split.md), [feature_global_alerts.md](./feature_global_alerts.md), [feature_ldap_yamldap_adoption.md](./feature_ldap_yamldap_adoption.md)

---

## 13. Next action

**This plan is not yet approved.** Before any execution, the user should:

1. Read §3 (findings) and confirm or challenge each severity.
2. Read §9 (deliberate omissions) and confirm or push back.
3. Decide on the retention period numbers in §5 Stage 3 (needs legal input).
4. Decide the sequencing: do we ship Stage 1–3 as a single "procurement-ready" release and treat Stages 4–11 as a roadmap, or all at once.
5. Choose whether Stages 5–6 (UUID-first + UUIDv7 + partitioning) fold together or ship separately.

Confidence to begin execution on approval: ~95%. The remaining 5% is the retention-period call and the polymorphic-FK pattern choice, both of which surface in-stage with time to decide.
