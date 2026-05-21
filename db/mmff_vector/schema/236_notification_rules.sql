-- Migration 236 — notification rules + tag-aware notifications
--
-- Adds the Rally-style notification-rules engine (B11.4 follow-up):
--
--   users_notification_rules
--     One row per user-defined rule. id_user is the owner; rule
--     fires only for that user. id_user IS NULL is reserved for
--     a FUTURE admin-defined defaults pass — NOT wired today; the
--     CRUD service rejects writes where id_user is NULL. The column
--     exists so we don't have to migrate later.
--
-- Tag taxonomy:
--
--   users_notifications.users_notifications_tag — a coarse bucket
--   distinct from `users_notifications_kind`. Today every row also
--   has a kind ('mention', 'library_release', etc); the tag layer
--   on top buckets these into the categories a user filters by in
--   their bell ('mention', 'artefact', 'note', 'comment'). Rules
--   that fire on artefact writes set tag = 'artefact'; mentions
--   landing through the @-mention surface set tag = 'mention'.
--
-- Audit trail:
--
--   users_notifications.users_notifications_id_rule — when set,
--   identifies the rule that fired this notification. NULL for
--   mentions and other producer-driven kinds. Procurement reviewers
--   trace any audit-bearing notification back to the rule that
--   matched it.

BEGIN;

-- ============================================================
-- users_notification_rules — rule registry
-- ============================================================
CREATE TABLE IF NOT EXISTS users_notification_rules (
    users_notification_rules_id                 uuid                     NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    users_notification_rules_id_subscription    uuid                     NOT NULL REFERENCES subscriptions(id),
    -- NULL = admin-defined default (NOT WIRED; service rejects).
    -- See migration comment block above for context.
    users_notification_rules_id_user            uuid                              REFERENCES users(id),
    users_notification_rules_name               text                     NOT NULL,
    -- Rule taxonomy. 'artefact' is the only one wired in the strawman.
    -- 'mention' / 'note' / 'comment' / 'owner_proposed' come later.
    users_notification_rules_type               text                     NOT NULL,
    -- For 'artefact' rules: the artefact_type id this rule targets.
    -- NULL for tag-only rules (e.g. 'every mention regardless of source').
    users_notification_rules_target             text,
    -- JSONB array of {field, operator, value} predicates. The engine
    -- AND-combines every predicate; OR-logic across rules is implicit
    -- (any matching rule fires its own notification).
    users_notification_rules_conditions         jsonb                    NOT NULL DEFAULT '[]'::jsonb,
    users_notification_rules_enabled            boolean                  NOT NULL DEFAULT TRUE,
    users_notification_rules_created_at         timestamp with time zone NOT NULL DEFAULT now(),
    users_notification_rules_updated_at         timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE users_notification_rules
    ADD CONSTRAINT users_notification_rules_name_length
    CHECK (char_length(users_notification_rules_name) BETWEEN 1 AND 100);

ALTER TABLE users_notification_rules
    ADD CONSTRAINT users_notification_rules_type_check
    CHECK (users_notification_rules_type IN ('artefact', 'mention', 'note', 'comment', 'owner_proposed'));

-- The evaluator's hot path: "give me all enabled rules for type=X
-- target=Y in subscription Z". Composite index pins it.
CREATE INDEX IF NOT EXISTS idx_users_notification_rules_lookup
    ON users_notification_rules (
        users_notification_rules_id_subscription,
        users_notification_rules_type,
        users_notification_rules_target
    )
    WHERE users_notification_rules_enabled = TRUE;

-- "Show me my rules" — the settings page's primary read.
CREATE INDEX IF NOT EXISTS idx_users_notification_rules_owner
    ON users_notification_rules (users_notification_rules_id_user, users_notification_rules_updated_at DESC);

-- ============================================================
-- users_notifications: add tag + rule trace
-- ============================================================
ALTER TABLE users_notifications
    ADD COLUMN IF NOT EXISTS users_notifications_tag        text;

ALTER TABLE users_notifications
    ADD COLUMN IF NOT EXISTS users_notifications_id_rule    uuid REFERENCES users_notification_rules(users_notification_rules_id);

-- Backfill existing rows. Everything pre-migration is a mention.
UPDATE users_notifications
   SET users_notifications_tag = 'mention'
 WHERE users_notifications_tag IS NULL
   AND users_notifications_kind = 'mention';

-- Catch-all for any non-mention row that snuck in pre-migration.
UPDATE users_notifications
   SET users_notifications_tag = users_notifications_kind
 WHERE users_notifications_tag IS NULL;

-- Tag is required going forward; dispatchers set it on insert.
-- We can't NOT NULL it yet because the backend dispatcher's INSERT
-- hasn't shipped — set the NOT NULL in a follow-up migration once
-- every code path writes a tag.

CREATE INDEX IF NOT EXISTS idx_users_notifications_tag
    ON users_notifications (users_notifications_id_user, users_notifications_tag, users_notifications_created_at DESC)
    WHERE users_notifications_tag IS NOT NULL;

COMMIT;
