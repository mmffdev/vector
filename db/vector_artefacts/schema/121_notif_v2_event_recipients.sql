-- ============================================================
-- 121_notif_v2_event_recipients.sql
--
-- Notifications v2 — snapshot of resolved recipients.
--
-- Doorway from event to pipeline. One row per (event × user).
-- Populated at fan-out time (fire-time snapshot — locked decision
-- #12: new users added after broadcast resolved do NOT retroactively
-- receive the notification).
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+1 — notifications_event_recipients".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_event_recipients (
    notifications_event_recipients_id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_event_recipients_id_event         uuid        NOT NULL
        REFERENCES notifications_events_v2(notifications_events_v2_id) ON DELETE CASCADE,
    notifications_event_recipients_id_user          uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    notifications_event_recipients_resolved_at      timestamptz NOT NULL DEFAULT now(),
    notifications_event_recipients_resolved_reason  text        NOT NULL
);

-- One recipient row per (event, user) — idempotency guard
CREATE UNIQUE INDEX notifications_event_recipients_event_user_uidx
    ON notifications_event_recipients (
        notifications_event_recipients_id_event,
        notifications_event_recipients_id_user
    );

-- Per-user inbox timeline
CREATE INDEX notifications_event_recipients_user_timeline_idx
    ON notifications_event_recipients (
        notifications_event_recipients_id_user,
        notifications_event_recipients_resolved_at DESC
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_event_recipients_user_timeline_idx;
-- DROP INDEX IF EXISTS notifications_event_recipients_event_user_uidx;
-- DROP TABLE IF EXISTS notifications_event_recipients;

COMMIT;
