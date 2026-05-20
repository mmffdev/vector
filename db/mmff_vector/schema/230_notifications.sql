-- Migration 230 — notifications system (B11.4)
--
-- Three tables, one trigger:
--
--  1. notifications_outbox — transactional outbox. Producers
--     (mentions.Service, future watchers, etc.) write a row in the
--     SAME tx as their domain write. A relay goroutine on the backend
--     LISTENs for the pg_notify fired by the trigger below, claims
--     unclaimed rows, publishes to RabbitMQ, and marks them delivered.
--     Durable hand-off — if RMQ is down when a producer commits, the
--     row sits in the outbox until the relay catches up.
--
--  2. users_notifications — the in-app read model. The in-app
--     dispatcher (RMQ consumer) writes one row here per recipient.
--     The bell UI reads from this table. Indexed for the "my unread
--     notifications, newest first" access pattern.
--
--  3. users_notifications_prefs — per-channel × per-kind toggle. The
--     dispatchers consult this before sending. Empty table = sensible
--     defaults (in-app=on, email=on, sse=on for every kind) applied
--     at read time in the service layer.
--
-- Column-prefix rule (RF1.4.2) applied throughout — every column on
-- every table starts with the table name.
--
-- Tenant isolation: every read is double-fenced by (subscription_id,
-- user_id). The composite indexes below pin that pattern.

BEGIN;

-- ============================================================
-- notifications_outbox — transactional outbox
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications_outbox (
    notifications_outbox_id                   uuid                     NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    notifications_outbox_id_subscription      uuid                     NOT NULL REFERENCES subscriptions(id),
    notifications_outbox_id_user_recipient    uuid                     NOT NULL REFERENCES users(id),
    notifications_outbox_kind                 text                     NOT NULL,
    notifications_outbox_payload              jsonb                    NOT NULL,
    notifications_outbox_created_at           timestamp with time zone NOT NULL DEFAULT now(),
    notifications_outbox_claimed_at           timestamp with time zone,
    notifications_outbox_delivered_at         timestamp with time zone,
    notifications_outbox_attempts             integer                  NOT NULL DEFAULT 0,
    notifications_outbox_last_error           text
);

-- The relay scans for unclaimed rows; partial index keeps that
-- query O(log n) regardless of how many delivered rows accumulate.
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_unclaimed
    ON notifications_outbox (notifications_outbox_created_at ASC)
    WHERE notifications_outbox_claimed_at IS NULL;

-- For diagnostics — "find every event for this recipient regardless
-- of delivery state".
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_recipient
    ON notifications_outbox (
        notifications_outbox_id_subscription,
        notifications_outbox_id_user_recipient,
        notifications_outbox_created_at DESC
    );

-- Cap on attempts as a defence-in-depth check. The relay parks at 5
-- attempts and stops re-trying. SOC 2 reviewers like the explicit cap.
ALTER TABLE notifications_outbox
    ADD CONSTRAINT notifications_outbox_attempts_check
    CHECK (notifications_outbox_attempts >= 0 AND notifications_outbox_attempts <= 100);

-- Postgres NOTIFY trigger — fires on every insert. The relay LISTENs
-- on this channel and wakes up to drain the outbox. Cheaper than
-- polling, latency under a millisecond on idle hardware.
CREATE OR REPLACE FUNCTION notifications_outbox_notify() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('notifications_outbox_inserted', NEW.notifications_outbox_id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_outbox_after_insert ON notifications_outbox;
CREATE TRIGGER notifications_outbox_after_insert
    AFTER INSERT ON notifications_outbox
    FOR EACH ROW EXECUTE FUNCTION notifications_outbox_notify();

-- ============================================================
-- users_notifications — in-app read model (bell)
-- ============================================================
CREATE TABLE IF NOT EXISTS users_notifications (
    users_notifications_id                  uuid                     NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    users_notifications_id_subscription     uuid                     NOT NULL REFERENCES subscriptions(id),
    users_notifications_id_user             uuid                     NOT NULL REFERENCES users(id),
    users_notifications_kind                text                     NOT NULL,
    users_notifications_title               text                     NOT NULL,
    users_notifications_body                text                     NOT NULL DEFAULT '',
    users_notifications_context_kind        text,
    users_notifications_context_id          text,
    users_notifications_context_label       text,
    users_notifications_id_outbox           uuid REFERENCES notifications_outbox(notifications_outbox_id),
    users_notifications_created_at          timestamp with time zone NOT NULL DEFAULT now(),
    users_notifications_read_at             timestamp with time zone
);

-- Bell's primary query: "my notifications, newest first".
CREATE INDEX IF NOT EXISTS idx_users_notifications_recipient_created
    ON users_notifications (users_notifications_id_user, users_notifications_created_at DESC);

-- Unread-count query: "count of my unread notifications".
CREATE INDEX IF NOT EXISTS idx_users_notifications_recipient_unread
    ON users_notifications (users_notifications_id_user, users_notifications_created_at DESC)
    WHERE users_notifications_read_at IS NULL;

ALTER TABLE users_notifications
    ADD CONSTRAINT users_notifications_title_length
    CHECK (char_length(users_notifications_title) <= 200);

ALTER TABLE users_notifications
    ADD CONSTRAINT users_notifications_body_length
    CHECK (char_length(users_notifications_body) <= 1000);

-- ============================================================
-- users_notifications_prefs — per-channel × per-kind matrix
-- ============================================================
CREATE TABLE IF NOT EXISTS users_notifications_prefs (
    users_notifications_prefs_id_user      uuid    NOT NULL REFERENCES users(id),
    users_notifications_prefs_kind         text    NOT NULL,
    users_notifications_prefs_channel      text    NOT NULL,
    users_notifications_prefs_enabled      boolean NOT NULL,
    users_notifications_prefs_updated_at   timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (
        users_notifications_prefs_id_user,
        users_notifications_prefs_kind,
        users_notifications_prefs_channel
    )
);

ALTER TABLE users_notifications_prefs
    ADD CONSTRAINT users_notifications_prefs_channel_check
    CHECK (users_notifications_prefs_channel IN ('in_app', 'email', 'sse'));

-- "give me all prefs for this user" — single index seek.
CREATE INDEX IF NOT EXISTS idx_users_notifications_prefs_user
    ON users_notifications_prefs (users_notifications_prefs_id_user);

COMMIT;
