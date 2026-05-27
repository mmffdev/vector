-- ============================================================
-- 127_notif_v2_templates.sql
--
-- Notifications v2 — message templates.
--
-- Per (event_type, channel, locale, version). UNIQUE on all four
-- to support versioned template management. The pipeline's template
-- lookup resolves by (event_type, channel, locale='en-GB', active=TRUE)
-- taking the highest version.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+7 — notifications_templates".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_templates (
    notifications_templates_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_templates_event_type  text        NOT NULL,
    notifications_templates_channel     text        NOT NULL,
    notifications_templates_locale      text        NOT NULL DEFAULT 'en-GB',
    notifications_templates_subject     text        NOT NULL,
    notifications_templates_body        text        NOT NULL,
    notifications_templates_version     integer     NOT NULL DEFAULT 1,
    notifications_templates_active      boolean     NOT NULL DEFAULT true,
    notifications_templates_created_at  timestamptz NOT NULL DEFAULT now(),
    notifications_templates_updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One template row per (event_type, channel, locale, version)
CREATE UNIQUE INDEX notifications_templates_type_channel_locale_version_uidx
    ON notifications_templates (
        notifications_templates_event_type,
        notifications_templates_channel,
        notifications_templates_locale,
        notifications_templates_version
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_templates_type_channel_locale_version_uidx;
-- DROP TABLE IF EXISTS notifications_templates;

COMMIT;
