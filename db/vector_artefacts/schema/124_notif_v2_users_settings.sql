-- ============================================================
-- 124_notif_v2_users_settings.sql
--
-- Notifications v2 — per-user global settings.
--
-- Singleton row per user (enforced by UNIQUE on id_user).
-- Covers quiet hours (start + end + IANA tz) and digest cadence.
-- Critical events bypass quiet hours regardless of these settings.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+4 — users_notifications_settings".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE users_notifications_settings (
    users_notifications_settings_id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    users_notifications_settings_id_user            uuid    NOT NULL UNIQUE
        REFERENCES users(users_id) ON DELETE CASCADE,
    users_notifications_settings_quiet_hours_start  time    NULL,
    users_notifications_settings_quiet_hours_end    time    NULL,
    users_notifications_settings_quiet_hours_tz     text    NULL,
    users_notifications_settings_digest_cadence     text    NOT NULL DEFAULT 'immediate',
    users_notifications_settings_digest_channel     text    NOT NULL DEFAULT 'email',
    users_notifications_settings_updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---- DOWN ----
-- DROP TABLE IF EXISTS users_notifications_settings;

COMMIT;
