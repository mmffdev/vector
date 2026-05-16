-- RF1.4.2.errors (VA side) — error_events → errors_events.
BEGIN;

ALTER TABLE error_events RENAME TO errors_events;

ALTER TABLE errors_events RENAME COLUMN id              TO errors_events_id;
ALTER TABLE errors_events RENAME COLUMN subscription_id TO errors_events_id_subscription;
ALTER TABLE errors_events RENAME COLUMN user_id         TO errors_events_id_user;
ALTER TABLE errors_events RENAME COLUMN code            TO errors_events_code;
ALTER TABLE errors_events RENAME COLUMN context         TO errors_events_context;
ALTER TABLE errors_events RENAME COLUMN occurred_at     TO errors_events_occurred_at;
ALTER TABLE errors_events RENAME COLUMN request_id      TO errors_events_request_id;
ALTER TABLE errors_events RENAME COLUMN created_at      TO errors_events_created_at;

ALTER INDEX idx_error_events_subscription_code     RENAME TO idx_errors_events_id_subscription_code;
ALTER INDEX idx_error_events_subscription_occurred RENAME TO idx_errors_events_id_subscription_occurred;

DROP TRIGGER IF EXISTS trg_error_events_no_update ON errors_events;
DROP TRIGGER IF EXISTS trg_error_events_no_delete ON errors_events;

CREATE OR REPLACE FUNCTION errors_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'errors_events is append-only (op=%, id=%)',
        TG_OP, COALESCE(OLD.errors_events_id, NEW.errors_events_id)
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS error_events_append_only();

CREATE TRIGGER trg_errors_events_no_update
    BEFORE UPDATE ON errors_events
    FOR EACH ROW EXECUTE FUNCTION errors_events_append_only();
CREATE TRIGGER trg_errors_events_no_delete
    BEFORE DELETE ON errors_events
    FOR EACH ROW EXECUTE FUNCTION errors_events_append_only();

COMMIT;
