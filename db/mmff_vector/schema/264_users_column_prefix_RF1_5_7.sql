-- ============================================================
-- 264_users_column_prefix_RF1_5_7.sql
--
-- RF1.5.7 — Pillar 1 wave 6a, table 1/1 (mmff_vector side).
--
-- Applies the §2.3 column-prefix convention to mmff_vector.users
-- (the master account table — holds 59 live rows; FK target for
-- ~25 inbound references and itself holds 7 outbound FKs to
-- subscriptions / users_roles / cost_centres / users_nav_profiles
-- and 3 soft-FK uuid columns to topology_nodes + office locations).
--
-- This is THE most-referenced table in the codebase. The PK
-- becomes <table>_id per §2.4; FKs follow §2.4 PK/FK shape
-- (FK = <table>_id_<target>[_<role>]) with the precedents from
-- migrations 251 (cost_centres), 259 (master_record_workspaces),
-- and 261 (pages).
--
-- NOTE: JSON wire-tags on backend/internal/users/types.go and
-- related struct types are NOT touched in this wave — wave 6b
-- coordinates the wire-contract rewrite with the frontend. This
-- wave only renames DB columns + Go SQL string literals + db:""
-- struct tags. The wire surface ({"id":"...","email":"..."} etc.)
-- is unchanged.
--
-- Inbound FKs (~25 — see \\d users) auto-retarget on the PK column
-- rename because Postgres tracks FK target by column oid, not by
-- name. Outbound FK targets (subscriptions.subscriptions_id,
-- users_roles.users_roles_id, cost_centres.cost_centres_id,
-- users_nav_profiles.users_nav_profiles_id) are all already in
-- their swept shapes from earlier waves; the FK definitions
-- auto-retarget on the source column rename here.
--
-- The trigger `fn_users_role_change_cascade_nav_prefs` references
-- NEW.id / OLD.role_id / NEW.role_id + JOIN against pages.id +
-- pages.key_enum. Both pages columns are already swept to
-- pages_id / pages_key_enum (migration 261). The function body
-- gets repaired in migration 265 in this same wave alongside the
-- per-table set_updated_at function.
-- ============================================================

BEGIN;

-- ---- Column renames ----

-- PK
ALTER TABLE users RENAME COLUMN id                          TO users_id;

-- FKs (§2.4 PK/FK shape)
ALTER TABLE users RENAME COLUMN subscription_id             TO users_id_subscription;
ALTER TABLE users RENAME COLUMN role_id                     TO users_id_role;
ALTER TABLE users RENAME COLUMN cost_centre_id              TO users_id_cost_centre;
ALTER TABLE users RENAME COLUMN active_nav_profile_id       TO users_id_active_nav_profile;
ALTER TABLE users RENAME COLUMN active_scope_node_id        TO users_id_active_scope_node;
ALTER TABLE users RENAME COLUMN office_location_id          TO users_id_office_location;
ALTER TABLE users RENAME COLUMN default_focus_node_id       TO users_id_default_focus_node;

-- Identity / auth core
ALTER TABLE users RENAME COLUMN email                       TO users_email;
ALTER TABLE users RENAME COLUMN password_hash               TO users_password_hash;
ALTER TABLE users RENAME COLUMN role                        TO users_role;
ALTER TABLE users RENAME COLUMN is_active                   TO users_is_active;
ALTER TABLE users RENAME COLUMN auth_method                 TO users_auth_method;
ALTER TABLE users RENAME COLUMN ldap_dn                     TO users_ldap_dn;

-- Login lifecycle
ALTER TABLE users RENAME COLUMN last_login                  TO users_last_login;
ALTER TABLE users RENAME COLUMN failed_login_count          TO users_failed_login_count;
ALTER TABLE users RENAME COLUMN locked_until                TO users_locked_until;

-- Password lifecycle
ALTER TABLE users RENAME COLUMN force_password_change       TO users_force_password_change;
ALTER TABLE users RENAME COLUMN password_changed_at         TO users_password_changed_at;
ALTER TABLE users RENAME COLUMN password_reset_required     TO users_password_reset_required;

-- MFA
ALTER TABLE users RENAME COLUMN mfa_enrolled                TO users_mfa_enrolled;
ALTER TABLE users RENAME COLUMN mfa_secret                  TO users_mfa_secret;
ALTER TABLE users RENAME COLUMN mfa_enrolled_at             TO users_mfa_enrolled_at;
ALTER TABLE users RENAME COLUMN mfa_recovery_codes          TO users_mfa_recovery_codes;

-- Profile
ALTER TABLE users RENAME COLUMN first_name                  TO users_first_name;
ALTER TABLE users RENAME COLUMN middle_name                 TO users_middle_name;
ALTER TABLE users RENAME COLUMN last_name                   TO users_last_name;
ALTER TABLE users RENAME COLUMN display_name                TO users_display_name;
ALTER TABLE users RENAME COLUMN department                  TO users_department;
ALTER TABLE users RENAME COLUMN phone_work                  TO users_phone_work;
ALTER TABLE users RENAME COLUMN phone_mobile                TO users_phone_mobile;
ALTER TABLE users RENAME COLUMN profile_image_url           TO users_profile_image_url;

-- Locale / formatting
ALTER TABLE users RENAME COLUMN timezone                    TO users_timezone;
ALTER TABLE users RENAME COLUMN date_format                 TO users_date_format;
ALTER TABLE users RENAME COLUMN datetime_format             TO users_datetime_format;

-- Preferences / theming
ALTER TABLE users RENAME COLUMN theme_pack                  TO users_theme_pack;
ALTER TABLE users RENAME COLUMN preferences                 TO users_preferences;
ALTER TABLE users RENAME COLUMN email_notifications_enabled TO users_email_notifications_enabled;

-- Sentinel scope defaults
ALTER TABLE users RENAME COLUMN sentinel_scope_up_default   TO users_sentinel_scope_up_default;
ALTER TABLE users RENAME COLUMN sentinel_scope_down_default TO users_sentinel_scope_down_default;
ALTER TABLE users RENAME COLUMN home_location_follow_mode   TO users_home_location_follow_mode;

-- Timestamps
ALTER TABLE users RENAME COLUMN created_at                  TO users_created_at;
ALTER TABLE users RENAME COLUMN updated_at                  TO users_updated_at;

-- ---- Index renames ----

-- users_pkey already matches the <table>_pkey convention.
ALTER INDEX users_email_subscription_unique
    RENAME TO users_email_id_subscription_unique;
ALTER INDEX idx_users_email
    RENAME TO idx_users_email_btree;
ALTER INDEX idx_users_subscription_id
    RENAME TO idx_users_id_subscription;
ALTER INDEX idx_users_role_id
    RENAME TO idx_users_id_role;
ALTER INDEX idx_users_active_scope_node_id
    RENAME TO idx_users_id_active_scope_node;
ALTER INDEX idx_users_active_nav_profile
    RENAME TO idx_users_id_active_nav_profile;
ALTER INDEX idx_users_department
    RENAME TO idx_users_department_btree;
ALTER INDEX idx_users_last_name
    RENAME TO idx_users_last_name_btree;
-- Partial composite `(id, default_focus_node_id) WHERE is_active = true`.
-- Renamed using the discriminating second column to avoid the awkward
-- doubled `users_id_users_id_*` form; the leading `users_id` is implicit
-- in the index's table-prefix.
ALTER INDEX users_default_focus_node_id_idx
    RENAME TO idx_users_id_default_focus_node;

-- ---- Constraint renames ----

ALTER TABLE users
    RENAME CONSTRAINT users_auth_method_check
                  TO users_auth_method_chk;

ALTER TABLE users
    RENAME CONSTRAINT users_active_nav_profile_id_fkey
                  TO users_id_active_nav_profile_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_cost_centre_id_fkey
                  TO users_id_cost_centre_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_role_id_fkey
                  TO users_id_role_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_subscription_id_fkey
                  TO users_id_subscription_fkey;

-- users_pkey and users_email_subscription_unique (now
-- users_email_id_subscription_unique above) carry no FK constraint
-- name issue.

COMMIT;
