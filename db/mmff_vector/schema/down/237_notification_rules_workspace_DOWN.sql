-- DOWN for 237_notification_rules_workspace.sql
BEGIN;

DROP INDEX IF EXISTS idx_users_notification_rules_lookup;
CREATE INDEX IF NOT EXISTS idx_users_notification_rules_lookup
    ON users_notification_rules (
        users_notification_rules_id_subscription,
        users_notification_rules_type,
        users_notification_rules_target
    )
    WHERE users_notification_rules_enabled = TRUE;

ALTER TABLE users_notification_rules
    DROP COLUMN IF EXISTS users_notification_rules_id_workspace;

COMMIT;
