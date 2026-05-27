-- ============================================================
-- 125_notif_v2_users_prefs.sql
--
-- Notifications v2 — per-user per-event-type per-channel prefs.
--
-- Tier 1 (user-level) in the 3-tier resolution chain:
--   user → subscription_tier → system.
-- UNIQUE on (id_user, event_type, channel) so each combination has
-- exactly one preference row. priority_floor means "deliver only if
-- event.priority >= this value".
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+5 — users_notifications_prefs_v2".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE users_notifications_prefs_v2 (
    users_notifications_prefs_v2_id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    users_notifications_prefs_v2_id_user        uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    users_notifications_prefs_v2_event_type     text        NOT NULL,
    users_notifications_prefs_v2_channel        text        NOT NULL,
    users_notifications_prefs_v2_enabled        boolean     NOT NULL DEFAULT true,
    users_notifications_prefs_v2_priority_floor text        NOT NULL DEFAULT 'low',
    users_notifications_prefs_v2_updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One pref row per (user, event_type, channel)
CREATE UNIQUE INDEX users_notifications_prefs_v2_user_type_channel_uidx
    ON users_notifications_prefs_v2 (
        users_notifications_prefs_v2_id_user,
        users_notifications_prefs_v2_event_type,
        users_notifications_prefs_v2_channel
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS users_notifications_prefs_v2_user_type_channel_uidx;
-- DROP TABLE IF EXISTS users_notifications_prefs_v2;

COMMIT;
