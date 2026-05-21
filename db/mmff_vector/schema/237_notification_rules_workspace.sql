-- Migration 237 — notification rules gain workspace context
--
-- The artefact-types schema is per-workspace (one "Defect" row per
-- workspace, each potentially with its own renamed fields). For
-- notification rules to be unambiguous, every rule must declare WHICH
-- workspace's types it cares about.
--
-- Two changes:
--
--  1. Add users_notification_rules_id_workspace (uuid, NOT NULL going
--     forward — but nullable in the column to leave room for a future
--     "any workspace I can see" rule scope).
--
--  2. The semantics of users_notification_rules_target shift: it was
--     an artefact_type id (UUID); going forward it's the artefact-type
--     NAME (text, e.g. "Defect"). This works because: the field stayed
--     text in mig 236, no production rules exist yet (we shipped the
--     scaffold overnight), and the evaluator query joins on name +
--     workspace_id to find the matching type rows.
--
-- No backfill — the strawman has no live rules. New rules from this
-- point forward declare workspace + name.

BEGIN;

ALTER TABLE users_notification_rules
    ADD COLUMN IF NOT EXISTS users_notification_rules_id_workspace uuid;

-- Index for the evaluator's hot path (now keyed on workspace + name).
DROP INDEX IF EXISTS idx_users_notification_rules_lookup;
CREATE INDEX IF NOT EXISTS idx_users_notification_rules_lookup
    ON users_notification_rules (
        users_notification_rules_id_subscription,
        users_notification_rules_id_workspace,
        users_notification_rules_type,
        users_notification_rules_target
    )
    WHERE users_notification_rules_enabled = TRUE;

COMMIT;
