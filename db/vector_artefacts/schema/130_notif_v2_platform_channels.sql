-- ============================================================
-- 130_notif_v2_platform_channels.sql
--
-- Notifications v2 — gadmin platform channel kill switch.
--
-- Singleton row per channel. Seeded with 6 rows (in_app, sse,
-- email, push, slack, sms). email is seeded enabled=TRUE / status
-- 'live' because the platform channel is ready; dev environment
-- cannot deliver email until DEP1 (sending domain + API key) lands,
-- but disabled=FALSE would suppress post-DEP1 delivery even after
-- the key is configured. See spec locked decisions #15 and #16.
--
-- OPERATIONAL WARNING: in_app=FALSE is a danger zone. In-app delivery
-- is a DB write with no vendor dependency; it is the irreducible floor
-- for critical events. Do not disable without a confirmation gate.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+10 — notifications_platform_channels".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_platform_channels (
    notifications_platform_channels_id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_platform_channels_channel             text        UNIQUE NOT NULL,
    notifications_platform_channels_enabled             boolean     NOT NULL DEFAULT true,
    notifications_platform_channels_status              text        NOT NULL DEFAULT 'live',
    notifications_platform_channels_disabled_reason     text        NULL,
    notifications_platform_channels_disabled_at         timestamptz NULL,
    notifications_platform_channels_disabled_by_user_id uuid        NULL
        REFERENCES users(users_id) ON DELETE SET NULL,
    notifications_platform_channels_updated_at          timestamptz NOT NULL DEFAULT now(),

    -- CHECK: status must be a known value
    CONSTRAINT notifications_platform_channels_status_check
        CHECK (notifications_platform_channels_status IN ('live', 'degraded', 'disabled', 'unimplemented'))
);

-- ---- Seed: 6 platform channel rows ----
-- email: enabled=TRUE, status='live' — platform ready; DEP1 needed for actual
-- delivery but the channel must not be false-disabled pre-DEP1.
INSERT INTO notifications_platform_channels (
    notifications_platform_channels_channel,
    notifications_platform_channels_enabled,
    notifications_platform_channels_status,
    notifications_platform_channels_disabled_reason
) VALUES
    ('in_app', TRUE,  'live',           NULL),
    ('sse',    TRUE,  'live',           NULL),
    ('email',  TRUE,  'live',           'pending DEP1 (sending domain + API key)'),
    ('push',   FALSE, 'unimplemented',  'dispatcher not built'),
    ('slack',  FALSE, 'unimplemented',  'dispatcher not built'),
    ('sms',    FALSE, 'unimplemented',  'dispatcher not built');

-- ---- DOWN ----
-- DELETE FROM notifications_platform_channels;  -- removes seed rows
-- DROP TABLE IF EXISTS notifications_platform_channels;

COMMIT;
