# Schema — auth & permissions

> Parent: [c_schema.md](c_schema.md)
> Last verified: 2026-04-21

Tables touched by login, session, password, and workspace-ACL code paths. Audit/history is **not** here — see [c_c_schema_history.md](c_c_schema_history.md).

## `tenants` (migration 001)

The root of tenant isolation. One row per customer organisation.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `name` | TEXT NOT NULL | Display name |
| `slug` | TEXT NOT NULL UNIQUE | URL-safe identifier |
| `is_active` | BOOLEAN NOT NULL | Default TRUE |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Seed row:** `00000000-0000-0000-0000-000000000001` / slug `mmffdev`.

## `users` (migrations 001, 002, 003)

One login identity, bound to exactly one tenant.

| Column | Type | Source migration | Notes |
|---|---|---|---|
| `id` | UUID PK | 001 | |
| `tenant_id` | UUID NOT NULL → tenants | 001 | ON DELETE RESTRICT |
| `email` | TEXT NOT NULL | 001 | unique within `(email, tenant_id)` |
| `password_hash` | TEXT NOT NULL | 001 | bcrypt cost 12 |
| `role` | `user_role` enum | 001 | values: `user`, `padmin`, `gadmin` |
| `is_active` | BOOLEAN | 001 | default TRUE |
| `last_login` | TIMESTAMPTZ | 001 | |
| `auth_method` | TEXT NOT NULL | 002 | CHECK in (`local`, `ldap`), default `local` |
| `ldap_dn` | TEXT | 002 | null for local users |
| `force_password_change` | BOOLEAN NOT NULL | 002 | seed admin is TRUE |
| `password_changed_at` | TIMESTAMPTZ | 002 | |
| `failed_login_count` | INT NOT NULL | 002 | default 0 |
| `locked_until` | TIMESTAMPTZ | 002 | null = not locked |
| `mfa_enrolled` | BOOLEAN NOT NULL | 003 | dormant — no code reads this yet |
| `mfa_secret` | TEXT | 003 | dormant |
| `mfa_enrolled_at` | TIMESTAMPTZ | 003 | dormant |
| `mfa_recovery_codes` | TEXT[] | 003 | dormant |
| `created_at`, `updated_at` | TIMESTAMPTZ | 001 | trigger-maintained |

**Indexes:** `idx_users_email`, `idx_users_tenant_id`.

**Seed:** `admin@mmffdev.com` / role `gadmin` / bcrypt of `changeme` / `force_password_change = TRUE`.

## `sessions` (migration 001)

One row per live refresh token. Access tokens are stateless JWTs and not tracked.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID → users | ON DELETE CASCADE |
| `token_hash` | TEXT UNIQUE NOT NULL | **SHA-256 of the raw refresh token — never the raw token itself** |
| `created_at`, `expires_at`, `last_used_at` | TIMESTAMPTZ | |
| `ip_address` | INET | |
| `user_agent` | TEXT | |
| `revoked` | BOOLEAN NOT NULL | default FALSE |

**Indexes:** `idx_sessions_user_id`, `idx_sessions_token_hash`, `idx_sessions_expires_at`.

## `password_resets` (migration 002)

Single-use, time-boxed reset tokens.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID → users | ON DELETE CASCADE |
| `token_hash` | TEXT UNIQUE NOT NULL | SHA-256 of the raw token |
| `expires_at` | TIMESTAMPTZ NOT NULL | |
| `used_at` | TIMESTAMPTZ | null until consumed |
| `requested_ip` | INET | |
| `created_at` | TIMESTAMPTZ | |

**Indexes:** `idx_password_resets_user_id`, `idx_password_resets_expires_at`.

## `user_workspace_permissions` (migrations 002 + 007)

Granular per-workspace ACL grid. Originally `user_project_permissions` with a dangling `project_id` column — migration 007 renamed the table, renamed the column to `workspace_id`, and added the FK.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID → users | ON DELETE CASCADE |
| `workspace_id` | UUID → workspace | ON DELETE CASCADE (added in 007) |
| `can_view`, `can_edit`, `can_admin` | BOOLEAN NOT NULL | default FALSE |
| `granted_by` | UUID → users | ON DELETE SET NULL |
| `created_at`, `updated_at` | TIMESTAMPTZ | trigger-maintained |

**Unique:** `(user_id, workspace_id)`. **Indexes:** `idx_uwp_user_id`, `idx_uwp_workspace_id`.

## Enum `user_role`

```
user     -- default
padmin   -- product admin (padmin)
gadmin   -- global admin (gadmin)
```

See [c_section-tags.md](c_section-tags.md) for role-gated route groups.

## Invariants specific to this domain

- `email` is unique per tenant (two tenants can share `admin@…`).
- Failed-login tracking (`failed_login_count` + `locked_until`) is reset by the password-reset flow — verify when touching those paths.
- MFA columns exist in the schema but no enforcement code reads them. Do not branch on `mfa_enrolled` until the TOTP path lands.
