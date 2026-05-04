# Roles & permissions (data-driven RBAC)

Plan: [`PLA-0007`](../dev/plans/PLA-0007.json). Migrations: [`088_roles_permissions.sql`](../db/schema/088_roles_permissions.sql), [`089_users_page_roles_role_id.sql`](../db/schema/089_users_page_roles_role_id.sql).

## What it is

The legacy `user_role` Postgres ENUM (`gadmin`/`padmin`/`user`) is replaced by three data-driven tables — `roles`, `permissions`, `role_permissions` — owned by a sole-writer service at `backend/internal/roles/`. System roles ship as seed rows; tenants extend by inserting their own. Frontend gates move from role-string compares to `useHasPermission(<code>)` calls. The legacy `users.role` enum column is RETAINED for one full release cycle alongside the new `users.role_id` (dual-read); a deferred Migration Z drops the enum after the dual-read window closes.

## Schema

### `roles`

Per-subscription rows + cross-tenant system rows.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` for tenant rows; **stable hard-coded UUIDs for the 5 system rows** (see seed) |
| `subscription_id` | UUID FK → `subscriptions(id)` ON DELETE CASCADE | NULL = system row visible to all tenants; non-NULL = tenant-custom |
| `code` | TEXT NOT NULL | URL-safe identifier (e.g. `gadmin`, `auditor`) |
| `label` | TEXT NOT NULL | Human-facing name |
| `description` | TEXT NOT NULL DEFAULT `''` | |
| `rank` | INTEGER NOT NULL | Drives role-ceiling check; CHECK `rank > 0` |
| `is_system` | BOOLEAN NOT NULL DEFAULT FALSE | True only on the 5 seed rows |
| `is_external` | BOOLEAN NOT NULL DEFAULT FALSE | True on the `external` archetype + tenant clones thereof |
| `archived_at` | TIMESTAMPTZ NULL | Soft-archive |
| `created_at` / `updated_at` | TIMESTAMPTZ | `set_updated_at()` trigger |
| `created_by` | UUID FK → `users(id)` ON DELETE SET NULL | |

**Constraints:**

- `roles_rank_positive` — `rank > 0`.
- `roles_tenant_rank_band` — tenant rows MUST NOT use a system-reserved rank (`{5, 10, 20, 25, 30}`); tenant ranks live in `[11..24] ∪ [26..29]`. System rows may use any positive rank.
- `roles_system_no_tenant` — `is_system = TRUE` requires `subscription_id IS NULL`; tenant rows must be `is_system = FALSE`.

**Unique indexes:**

- `uq_roles_system_code` — partial UK on `(code)` WHERE `subscription_id IS NULL` — at most one system row per code.
- `uq_roles_tenant_code` — partial UK on `(subscription_id, code)` WHERE `subscription_id IS NOT NULL` — at most one tenant row per code per tenant.

### `permissions`

Server-authoritative catalogue. The Go side declares every code as a typed constant; package init() will refuse to start if the in-code catalogue and the table diverge (planned in 00295).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | gen_random_uuid (no stable UUID needed — code is the contract) |
| `code` | TEXT NOT NULL UNIQUE | e.g. `users.create.gadmin`, `menu.admin.view` |
| `label` | TEXT NOT NULL | UI string |
| `category` | TEXT NOT NULL DEFAULT `'general'` | Groups codes in admin UI |
| `description` | TEXT NOT NULL DEFAULT `''` | |
| `created_at` | TIMESTAMPTZ | |

### `role_permissions` (junction)

| Column | Type | Notes |
|---|---|---|
| `role_id` | UUID FK → `roles(id)` ON DELETE CASCADE | |
| `permission_id` | UUID FK → `permissions(id)` ON DELETE CASCADE | |
| `granted_by` | UUID FK → `users(id)` ON DELETE SET NULL | Audit |
| `granted_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |
| **PK** | `(role_id, permission_id)` | |

## Seeded system roles (stable UUIDs)

| Code | Rank | UUID | Label | Notes |
|---|---|---|---|---|
| `gadmin` | 30 | `00000000-0000-0000-0000-00000000ad30` | Global Admin | Full administrative authority within a tenant. |
| `padmin` | 25 | `00000000-0000-0000-0000-00000000ad25` | Portfolio Admin | Portfolio-level admin. |
| `team_lead` | 20 | `00000000-0000-0000-0000-00000000ad20` | Team Lead | Mid-tier role; same operational rights as padmin in v0; ranks differ so role-ceiling is preserved. |
| `user` | 10 | `00000000-0000-0000-0000-00000000ad10` | User | Standard end-user; no account-creation rights. |
| `external` | 5 | `00000000-0000-0000-0000-00000000ad05` | External (archetype) | Bespoke external account archetype; tenants clone-and-edit to define auditor / contractor / agent roles. |

Test code references these UUIDs as constants (see [`backend/internal/users/protected_accounts_test.go`](../backend/internal/users/protected_accounts_test.go)).

## Seeded permissions (21)

| Category | Code | Notes |
|---|---|---|
| menu | `menu.admin.view` | Render the admin menu group in nav. |
| menu | `menu.dev.view` | Render the developer menu (Dev Setup) — gadmin only by default. |
| users | `users.list` | Read-only list of users in the actor's tenant. |
| users | `users.read` | Read individual user records. |
| users | `users.archive` | Soft-archive a user. |
| users | `users.update_profile` | Edit profile fields (name, department). |
| users | `users.update_active` | Toggle `is_active`. |
| users | `users.issue_reset` | Generate a password-reset link. |
| users (creator-matrix) | `users.create.gadmin` | Create users with the gadmin system role. |
| users (creator-matrix) | `users.create.padmin` | Create users with the padmin system role. |
| users (creator-matrix) | `users.create.team_lead` | Create users with the team_lead system role. |
| users (creator-matrix) | `users.create.user` | Create users with the user system role. |
| users (creator-matrix) | `users.create.external` | Create users under any `is_external` role within tenant scope. |
| roles | `roles.list` | Read tenant + system roles. |
| roles | `roles.read` | Read role permission grid + audit. |
| roles | `roles.create` | Create tenant-custom roles. |
| roles | `roles.update` | Edit tenant-custom roles (and label/description on system roles). |
| roles | `roles.archive` | Soft-archive a tenant-custom role. |
| roles | `roles.assign_permissions` | Grant permissions to a role. |
| roles | `roles.revoke_permissions` | Revoke permissions from a role. |
| portfolio | `portfolio.list` | Read portfolios visible to the actor (minimal example for the External archetype). |

## Grant matrix (seeded)

| Permission | gadmin | padmin | team_lead | user | external |
|---|:-:|:-:|:-:|:-:|:-:|
| `menu.admin.view` | ✓ | ✓ | ✓ | | |
| `menu.dev.view` | ✓ | | | | |
| `users.list` | ✓ | ✓ | ✓ | | |
| `users.read` | ✓ | ✓ | ✓ | | |
| `users.archive` | ✓ | ✓ | ✓ | | |
| `users.update_profile` | ✓ | ✓ | ✓ | | |
| `users.update_active` | ✓ | ✓ | ✓ | | |
| `users.issue_reset` | ✓ | ✓ | ✓ | | |
| `users.create.gadmin` | ✓ | | | | |
| `users.create.padmin` | ✓ | | | | |
| `users.create.team_lead` | ✓ | ✓ | ✓ | | |
| `users.create.user` | ✓ | ✓ | ✓ | | |
| `users.create.external` | ✓ | ✓ | ✓ | | |
| `roles.list` | ✓ | ✓ | ✓ | | |
| `roles.read` | ✓ | ✓ | ✓ | | |
| `roles.create` | ✓ | | | | |
| `roles.update` | ✓ | | | | |
| `roles.archive` | ✓ | | | | |
| `roles.assign_permissions` | ✓ | | | | |
| `roles.revoke_permissions` | ✓ | | | | |
| `portfolio.list` | ✓ | ✓ | ✓ | ✓ | ✓ |

team_lead carries identical grants to padmin in v0 per user direction. Ranks differ (20 vs 25) so role-ceiling preserves the ordering for promote/demote checks.

## `users.role_id` and the dual-column window

Migration 089 adds `users.role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT`, backfilled from the legacy `users.role` enum:

- `role = 'gadmin'`  →  `role_id = 00000000-…-ad30`
- `role = 'padmin'`  →  `role_id = 00000000-…-ad25`
- `role = 'user'`    →  `role_id = 00000000-…-ad10`

The legacy `users.role` enum column STAYS for one full release cycle (dual-read window) so the existing nav-compatibility code keeps working. A deferred Migration Z drops the enum + column after the window closes.

The `provision_on_first_gadmin` trigger now compares against `role_id = '…ad30'` (the seeded gadmin UUID), not the enum literal.

## `page_roles` — current state

Migration 089 added `page_roles.role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE`, backfilled from the legacy `page_roles.role` enum, then **dropped** the legacy `role` enum column outright (page_roles is internal — no external readers). PK is `(page_id, role_id)`.

> **Note (operational drift):** the README/CLAUDE.md context describes `page_roles` as **dual-column** (enum + role_id alongside) for nav compatibility. The migration as written drops the enum during 089. If a later step has restored the enum on the dev DB to keep nav working, that's a deviation from the migration; either the migration needs an amend or the restore needs documentation. **Flagging — not changing — pending main-agent confirmation.**

## Sole-writer boundary

`backend/internal/roles.Service` is the sole writer for `roles`, `permissions`, `role_permissions`. To be implemented in story 00295 (per PLA-0007 plan). Direct `INSERT` / `UPDATE` / `DELETE` against these tables from any other Go package is blocked at lint level by `lint:writer-boundary` (see [`docs/c_c_lint_rules.md`](c_c_lint_rules.md)). Migration SQL under `db/schema/` is the privileged bootstrap path and is exempt from the lint.

Service methods (planned per PLA-0007):

- `ListRoles(ctx, subscriptionID)` — system + tenant rows visible to the actor's tenant.
- `CreateRole(ctx, …)` — tenant-custom role; enforces `roles_tenant_rank_band`.
- `UpdateRole(ctx, …)` — tenant-custom role only (label/description for system rows).
- `ArchiveRole(ctx, roleID)` — soft-archive; only tenant-custom rows.
- `GrantPermission(ctx, roleID, permID)` / `RevokePermission(ctx, roleID, permID)`.
- `Permissions(ctx, userID)` / `HasPermission(ctx, userID, code)` — read API for handlers + the frontend `useHasPermission` hook.
- `Catalogue()` — the in-code permission catalogue; init() asserts it matches the DB.

## Frontend contract

Gates move from `user.role === 'gadmin'`-style compares to `useHasPermission('<code>')`. The `lint:role-literals` rule (see [`docs/c_c_lint_rules.md`](c_c_lint_rules.md)) flags any regression. Pre-migration files are listed in `dev/registries/role_literals_exempt.json` and removed entry-by-entry as each later story converts its file.

## HARD-RULE-protected accounts

Three human accounts (`gadmin@`, `padmin@`, `user@mmffdev.com`) carry credentials managed by the human operator. Migration 089 contains an in-transaction snapshot/diff guard that aborts if any of `password_hash`, `email`, `is_active`, `password_changed_at` drift across the role_id backfill. The matching ongoing assertion lives at [`backend/internal/users/protected_accounts_test.go`](../backend/internal/users/protected_accounts_test.go) — the test bcrypt-verifies the seeded plaintext, asserts is_active + email integrity, and asserts each role_id binds to the seeded system role.

## Related

- [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) — `lint:role-literals` and `lint:writer-boundary`.
- [`docs/c_c_schema_auth.md`](c_c_schema_auth.md) — `users`, `sessions`, `password_resets` tables.
- [`docs/c_security.md`](c_security.md) — Trust-No-One posture.
- [`dev/plans/PLA-0007.json`](../dev/plans/PLA-0007.json) — full plan + story breakdown.
