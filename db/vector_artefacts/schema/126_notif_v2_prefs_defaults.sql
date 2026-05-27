-- ============================================================
-- 126_notif_v2_prefs_defaults.sql
--
-- Notifications v2 — tier and system defaults for 3-tier pref resolution.
--
-- Two tables in one file (tightly coupled — both are tier 2+3 of the
-- resolution chain user → subscription_tier → system):
--
--   notifications_prefs_tier_defaults  — tier 2: per-subscription-tier defaults
--   notifications_prefs_system_defaults — tier 3: global fallback
--
-- When a user has no pref row for (event_type, channel), the pipeline
-- resolver falls through: check tier_defaults for the user's
-- subscription_tier, then system_defaults.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+6 — notifications_prefs_tier_defaults + notifications_prefs_system_defaults".
-- ============================================================

BEGIN;

-- ---- UP — notifications_prefs_tier_defaults ----

CREATE TABLE notifications_prefs_tier_defaults (
    notifications_prefs_tier_defaults_id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_prefs_tier_defaults_subscription_tier text    NOT NULL,
    notifications_prefs_tier_defaults_event_type        text    NOT NULL,
    notifications_prefs_tier_defaults_channel           text    NOT NULL,
    notifications_prefs_tier_defaults_enabled           boolean NOT NULL,
    notifications_prefs_tier_defaults_priority_floor    text    NOT NULL DEFAULT 'low'
);

-- One default row per (subscription_tier, event_type, channel)
CREATE UNIQUE INDEX notifications_prefs_tier_defaults_tier_type_channel_uidx
    ON notifications_prefs_tier_defaults (
        notifications_prefs_tier_defaults_subscription_tier,
        notifications_prefs_tier_defaults_event_type,
        notifications_prefs_tier_defaults_channel
    );

-- ---- UP — notifications_prefs_system_defaults ----

CREATE TABLE notifications_prefs_system_defaults (
    notifications_prefs_system_defaults_id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_prefs_system_defaults_event_type      text    NOT NULL,
    notifications_prefs_system_defaults_channel         text    NOT NULL,
    notifications_prefs_system_defaults_enabled         boolean NOT NULL,
    notifications_prefs_system_defaults_priority_floor  text    NOT NULL DEFAULT 'low'
);

-- One default row per (event_type, channel)
CREATE UNIQUE INDEX notifications_prefs_system_defaults_type_channel_uidx
    ON notifications_prefs_system_defaults (
        notifications_prefs_system_defaults_event_type,
        notifications_prefs_system_defaults_channel
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_prefs_system_defaults_type_channel_uidx;
-- DROP TABLE IF EXISTS notifications_prefs_system_defaults;
-- DROP INDEX IF EXISTS notifications_prefs_tier_defaults_tier_type_channel_uidx;
-- DROP TABLE IF EXISTS notifications_prefs_tier_defaults;

COMMIT;
