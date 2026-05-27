-- ============================================================
-- 123_notif_v2_delivery_attempts.sql
--
-- Notifications v2 — append-only delivery audit log.
--
-- One row per delivery attempt (including suppressions). Immutable
-- after INSERT — no UPDATEs. bypass_reason records when user prefs
-- or quiet hours were overridden (critical_priority / admin_override /
-- system_event). Suppression reasons logged in error_class so the
-- compliance query "every suppression in 30 days" is a direct index
-- scan.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+3 — notifications_delivery_attempts".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_delivery_attempts (
    notifications_delivery_attempts_id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_delivery_attempts_id_event            uuid        NOT NULL
        REFERENCES notifications_events_v2(notifications_events_v2_id) ON DELETE CASCADE,
    notifications_delivery_attempts_id_outbox           uuid        NOT NULL
        REFERENCES notifications_outbox_v2(notifications_outbox_v2_id) ON DELETE CASCADE,
    notifications_delivery_attempts_id_recipient_user   uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    notifications_delivery_attempts_channel             text        NOT NULL,
    notifications_delivery_attempts_attempt_number      integer     NOT NULL,
    notifications_delivery_attempts_status              text        NOT NULL,
    notifications_delivery_attempts_bypass_reason       text        NULL,
    notifications_delivery_attempts_provider_message_id text        NULL,
    notifications_delivery_attempts_provider_response   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    notifications_delivery_attempts_latency_ms          integer     NULL,
    notifications_delivery_attempts_error_class         text        NULL,
    notifications_delivery_attempts_occurred_at         timestamptz NOT NULL DEFAULT now()
);

-- Event-level audit: all attempts for an event in chronological order
CREATE INDEX notifications_delivery_attempts_event_time_idx
    ON notifications_delivery_attempts (
        notifications_delivery_attempts_id_event,
        notifications_delivery_attempts_occurred_at
    );

-- Per-user delivery history (most recent first)
CREATE INDEX notifications_delivery_attempts_user_time_idx
    ON notifications_delivery_attempts (
        notifications_delivery_attempts_id_recipient_user,
        notifications_delivery_attempts_occurred_at DESC
    );

-- Compliance: query by channel × status × time (e.g. "all suppressions in 30 days")
CREATE INDEX notifications_delivery_attempts_channel_status_idx
    ON notifications_delivery_attempts (
        notifications_delivery_attempts_channel,
        notifications_delivery_attempts_status,
        notifications_delivery_attempts_occurred_at
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_delivery_attempts_channel_status_idx;
-- DROP INDEX IF EXISTS notifications_delivery_attempts_user_time_idx;
-- DROP INDEX IF EXISTS notifications_delivery_attempts_event_time_idx;
-- DROP TABLE IF EXISTS notifications_delivery_attempts;

COMMIT;
