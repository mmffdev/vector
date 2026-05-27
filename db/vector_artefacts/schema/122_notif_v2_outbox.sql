-- ============================================================
-- 122_notif_v2_outbox.sql
--
-- Notifications v2 — per-recipient per-channel outbox.
--
-- One row per (recipient × channel). The relay claims rows in
-- batches (SKIP LOCKED), publishes to RabbitMQ, and the dispatcher
-- writes delivered_at on success. scheduled_for enables quiet-hours
-- deferral (future-dated rows ignored by the relay until due).
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+2 — notifications_outbox_v2".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_outbox_v2 (
    notifications_outbox_v2_id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_outbox_v2_id_event            uuid        NOT NULL
        REFERENCES notifications_events_v2(notifications_events_v2_id) ON DELETE CASCADE,
    notifications_outbox_v2_id_recipient_user   uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    notifications_outbox_v2_channel             text        NOT NULL,
    notifications_outbox_v2_scheduled_for       timestamptz NOT NULL DEFAULT now(),
    notifications_outbox_v2_rendered_title      text        NOT NULL,
    notifications_outbox_v2_rendered_body       text        NOT NULL DEFAULT '',
    notifications_outbox_v2_claimed_at          timestamptz NULL,
    notifications_outbox_v2_delivered_at        timestamptz NULL,
    notifications_outbox_v2_attempts            integer     NOT NULL DEFAULT 0,
    notifications_outbox_v2_last_error          text        NULL,
    notifications_outbox_v2_created_at          timestamptz NOT NULL DEFAULT now()
);

-- Relay driver: claimable rows scheduled for now, not yet delivered
CREATE INDEX notifications_outbox_v2_relay_idx
    ON notifications_outbox_v2 (
        notifications_outbox_v2_scheduled_for,
        notifications_outbox_v2_created_at
    )
    WHERE
        notifications_outbox_v2_claimed_at IS NULL
        AND notifications_outbox_v2_delivered_at IS NULL
        AND notifications_outbox_v2_attempts < 100;

-- Per-user per-channel history
CREATE INDEX notifications_outbox_v2_user_channel_idx
    ON notifications_outbox_v2 (
        notifications_outbox_v2_id_recipient_user,
        notifications_outbox_v2_channel,
        notifications_outbox_v2_created_at DESC
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_outbox_v2_user_channel_idx;
-- DROP INDEX IF EXISTS notifications_outbox_v2_relay_idx;
-- DROP TABLE IF EXISTS notifications_outbox_v2;

COMMIT;
