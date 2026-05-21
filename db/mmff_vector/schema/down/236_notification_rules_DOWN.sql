-- DOWN for 236_notification_rules.sql
BEGIN;

DROP INDEX IF EXISTS idx_users_notifications_tag;

ALTER TABLE users_notifications
    DROP COLUMN IF EXISTS users_notifications_id_rule;
ALTER TABLE users_notifications
    DROP COLUMN IF EXISTS users_notifications_tag;

DROP TABLE IF EXISTS users_notification_rules;

COMMIT;
