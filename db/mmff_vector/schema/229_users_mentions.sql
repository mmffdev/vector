-- Migration 229 — @-mention surface
--
-- Adds users_mentions: one row per fan-out target. The mentions
-- service writes one row per recipient at create time, so the inbox
-- query (read-by-user) is a flat index seek rather than a join.
--
-- Column naming follows the project-wide prefix rule (every column
-- starts with users_mentions_) per RF1.4.2 conventions.
--
-- Cross-DB note: users_mentions_id_subscription / id_workspace /
-- id_user_* are logical FKs to mmff_vector.subscriptions / workspaces
-- / users. They live in the same DB (mmff_vector), so the FK
-- constraints can be enforced server-side.
--
-- Tenant isolation: every read is double-fenced by
-- (id_subscription, id_user_mentioned). The composite index below
-- makes the inbox read O(log n) on rows-for-this-user.

BEGIN;

CREATE TABLE IF NOT EXISTS users_mentions (
    users_mentions_id                    uuid                     NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    users_mentions_id_subscription       uuid                     NOT NULL REFERENCES subscriptions(id),
    users_mentions_id_workspace          uuid                     NOT NULL,
    users_mentions_id_user_author        uuid                     NOT NULL REFERENCES users(id),
    users_mentions_id_user_mentioned     uuid                     NOT NULL REFERENCES users(id),
    users_mentions_context_kind          text                     NOT NULL,
    users_mentions_context_id            text                     NOT NULL,
    users_mentions_context_label         text                     NOT NULL,
    users_mentions_snippet               text                     NOT NULL DEFAULT '',
    users_mentions_created_at            timestamp with time zone NOT NULL DEFAULT now(),
    users_mentions_read_at               timestamp with time zone
);

-- Author can't mention themselves; that's a no-op in the service but
-- worth pinning in the schema as defence in depth.
ALTER TABLE users_mentions
    ADD CONSTRAINT users_mentions_no_self_mention
    CHECK (users_mentions_id_user_author <> users_mentions_id_user_mentioned);

-- Snippet cap — matches snippetMax in the service layer.
ALTER TABLE users_mentions
    ADD CONSTRAINT users_mentions_snippet_length
    CHECK (char_length(users_mentions_snippet) <= 280);

-- The dominant access pattern: "show me my unread mentions, newest
-- first" — the partial index on read_at IS NULL keeps the
-- only_unread=true path tight.
CREATE INDEX IF NOT EXISTS idx_users_mentions_recipient_created
    ON users_mentions (users_mentions_id_user_mentioned, users_mentions_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_mentions_recipient_unread
    ON users_mentions (users_mentions_id_user_mentioned, users_mentions_created_at DESC)
    WHERE users_mentions_read_at IS NULL;

-- Auditability: lets us answer "every mention authored by X in
-- subscription Y" without a full scan.
CREATE INDEX IF NOT EXISTS idx_users_mentions_author
    ON users_mentions (users_mentions_id_subscription, users_mentions_id_user_author, users_mentions_created_at DESC);

COMMIT;
