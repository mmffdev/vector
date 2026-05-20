-- DOWN for 230_notifications.sql
BEGIN;

DROP TRIGGER IF EXISTS notifications_outbox_after_insert ON notifications_outbox;
DROP FUNCTION IF EXISTS notifications_outbox_notify();

DROP TABLE IF EXISTS users_notifications_prefs;
DROP TABLE IF EXISTS users_notifications;
DROP TABLE IF EXISTS notifications_outbox;

COMMIT;
