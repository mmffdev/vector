-- ============================================================
-- 129_notif_v2_users_inbox.sql
--
-- Notifications v2 — in-app bell read-model.
--
-- Written by the in_app dispatcher after delivery. This is the
-- source of truth for the bell icon unread count and the inbox list.
-- UNIQUE (id_user, id_event) prevents duplicate inbox entries.
-- Partial index on (id_user, created_at DESC WHERE read_at IS NULL)
-- drives the unread-count query efficiently.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+9 — notifications_users_inbox_v2".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_users_inbox_v2 (
    notifications_users_inbox_v2_id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_users_inbox_v2_id_user        uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    notifications_users_inbox_v2_id_event       uuid        NOT NULL
        REFERENCES notifications_events_v2(notifications_events_v2_id) ON DELETE CASCADE,
    notifications_users_inbox_v2_title          text        NOT NULL,
    notifications_users_inbox_v2_body           text        NOT NULL DEFAULT '',
    notifications_users_inbox_v2_priority       text        NOT NULL,
    notifications_users_inbox_v2_event_type     text        NOT NULL,
    notifications_users_inbox_v2_context_kind   text        NULL,
    notifications_users_inbox_v2_context_id     text        NULL,
    notifications_users_inbox_v2_context_label  text        NULL,
    notifications_users_inbox_v2_created_at     timestamptz NOT NULL DEFAULT now(),
    notifications_users_inbox_v2_read_at        timestamptz NULL
);

-- One inbox row per (user, event) — idempotency
CREATE UNIQUE INDEX notifications_users_inbox_v2_user_event_uidx
    ON notifications_users_inbox_v2 (
        notifications_users_inbox_v2_id_user,
        notifications_users_inbox_v2_id_event
    );

-- User's inbox sorted most-recent-first
CREATE INDEX notifications_users_inbox_v2_user_timeline_idx
    ON notifications_users_inbox_v2 (
        notifications_users_inbox_v2_id_user,
        notifications_users_inbox_v2_created_at DESC
    );

-- Unread count query (partial on unread rows only)
CREATE INDEX notifications_users_inbox_v2_unread_idx
    ON notifications_users_inbox_v2 (
        notifications_users_inbox_v2_id_user,
        notifications_users_inbox_v2_created_at DESC
    )
    WHERE notifications_users_inbox_v2_read_at IS NULL;

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_users_inbox_v2_unread_idx;
-- DROP INDEX IF EXISTS notifications_users_inbox_v2_user_timeline_idx;
-- DROP INDEX IF EXISTS notifications_users_inbox_v2_user_event_uidx;
-- DROP TABLE IF EXISTS notifications_users_inbox_v2;

COMMIT;
