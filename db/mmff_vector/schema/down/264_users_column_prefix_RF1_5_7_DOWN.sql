-- ============================================================
-- 264_users_column_prefix_RF1_5_7_DOWN.sql
--
-- Reverses 264_users_column_prefix_RF1_5_7.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE users
    RENAME CONSTRAINT users_id_subscription_fkey
                  TO users_subscription_id_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_id_role_fkey
                  TO users_role_id_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_id_cost_centre_fkey
                  TO users_cost_centre_id_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_id_active_nav_profile_fkey
                  TO users_active_nav_profile_id_fkey;

ALTER TABLE users
    RENAME CONSTRAINT users_auth_method_chk
                  TO users_auth_method_check;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_users_id_default_focus_node
    RENAME TO users_default_focus_node_id_idx;
ALTER INDEX idx_users_last_name_btree
    RENAME TO idx_users_last_name;
ALTER INDEX idx_users_department_btree
    RENAME TO idx_users_department;
ALTER INDEX idx_users_id_active_nav_profile
    RENAME TO idx_users_active_nav_profile;
ALTER INDEX idx_users_id_active_scope_node
    RENAME TO idx_users_active_scope_node_id;
ALTER INDEX idx_users_id_role
    RENAME TO idx_users_role_id;
ALTER INDEX idx_users_id_subscription
    RENAME TO idx_users_subscription_id;
ALTER INDEX idx_users_email_btree
    RENAME TO idx_users_email;
ALTER INDEX users_email_id_subscription_unique
    RENAME TO users_email_subscription_unique;

-- ---- Column renames (reverse) ----

-- Timestamps
ALTER TABLE users RENAME COLUMN users_updated_at                  TO updated_at;
ALTER TABLE users RENAME COLUMN users_created_at                  TO created_at;

-- Sentinel scope defaults
ALTER TABLE users RENAME COLUMN users_home_location_follow_mode   TO home_location_follow_mode;
ALTER TABLE users RENAME COLUMN users_sentinel_scope_down_default TO sentinel_scope_down_default;
ALTER TABLE users RENAME COLUMN users_sentinel_scope_up_default   TO sentinel_scope_up_default;

-- Preferences / theming
ALTER TABLE users RENAME COLUMN users_email_notifications_enabled TO email_notifications_enabled;
ALTER TABLE users RENAME COLUMN users_preferences                 TO preferences;
ALTER TABLE users RENAME COLUMN users_theme_pack                  TO theme_pack;

-- Locale / formatting
ALTER TABLE users RENAME COLUMN users_datetime_format             TO datetime_format;
ALTER TABLE users RENAME COLUMN users_date_format                 TO date_format;
ALTER TABLE users RENAME COLUMN users_timezone                    TO timezone;

-- Profile
ALTER TABLE users RENAME COLUMN users_profile_image_url           TO profile_image_url;
ALTER TABLE users RENAME COLUMN users_phone_mobile                TO phone_mobile;
ALTER TABLE users RENAME COLUMN users_phone_work                  TO phone_work;
ALTER TABLE users RENAME COLUMN users_department                  TO department;
ALTER TABLE users RENAME COLUMN users_display_name                TO display_name;
ALTER TABLE users RENAME COLUMN users_last_name                   TO last_name;
ALTER TABLE users RENAME COLUMN users_middle_name                 TO middle_name;
ALTER TABLE users RENAME COLUMN users_first_name                  TO first_name;

-- MFA
ALTER TABLE users RENAME COLUMN users_mfa_recovery_codes          TO mfa_recovery_codes;
ALTER TABLE users RENAME COLUMN users_mfa_enrolled_at             TO mfa_enrolled_at;
ALTER TABLE users RENAME COLUMN users_mfa_secret                  TO mfa_secret;
ALTER TABLE users RENAME COLUMN users_mfa_enrolled                TO mfa_enrolled;

-- Password lifecycle
ALTER TABLE users RENAME COLUMN users_password_reset_required     TO password_reset_required;
ALTER TABLE users RENAME COLUMN users_password_changed_at         TO password_changed_at;
ALTER TABLE users RENAME COLUMN users_force_password_change       TO force_password_change;

-- Login lifecycle
ALTER TABLE users RENAME COLUMN users_locked_until                TO locked_until;
ALTER TABLE users RENAME COLUMN users_failed_login_count          TO failed_login_count;
ALTER TABLE users RENAME COLUMN users_last_login                  TO last_login;

-- Identity / auth core
ALTER TABLE users RENAME COLUMN users_ldap_dn                     TO ldap_dn;
ALTER TABLE users RENAME COLUMN users_auth_method                 TO auth_method;
ALTER TABLE users RENAME COLUMN users_is_active                   TO is_active;
ALTER TABLE users RENAME COLUMN users_role                        TO role;
ALTER TABLE users RENAME COLUMN users_password_hash               TO password_hash;
ALTER TABLE users RENAME COLUMN users_email                       TO email;

-- FKs (reverse)
ALTER TABLE users RENAME COLUMN users_id_default_focus_node       TO default_focus_node_id;
ALTER TABLE users RENAME COLUMN users_id_office_location          TO office_location_id;
ALTER TABLE users RENAME COLUMN users_id_active_scope_node        TO active_scope_node_id;
ALTER TABLE users RENAME COLUMN users_id_active_nav_profile       TO active_nav_profile_id;
ALTER TABLE users RENAME COLUMN users_id_cost_centre              TO cost_centre_id;
ALTER TABLE users RENAME COLUMN users_id_role                     TO role_id;
ALTER TABLE users RENAME COLUMN users_id_subscription             TO subscription_id;

-- PK
ALTER TABLE users RENAME COLUMN users_id                          TO id;

-- ---- Re-bind the role-change cascade trigger ----
-- 265_DOWN restored the function body but deferred this trigger
-- re-creation because the WHEN clause references column `role_id`
-- which is only restored once the column renames above complete.
DROP TRIGGER IF EXISTS trg_users_role_change_cascade_nav_prefs ON users;
CREATE TRIGGER trg_users_role_change_cascade_nav_prefs
    AFTER UPDATE OF role_id ON users
    FOR EACH ROW EXECUTE FUNCTION fn_users_role_change_cascade_nav_prefs();

COMMIT;
