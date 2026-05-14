-- RF1.4.2.webhooks DOWN — manual apply.
BEGIN;

ALTER SEQUENCE IF EXISTS webhooks_deliveries_webhooks_deliveries_id_seq RENAME TO webhook_deliveries_id_seq;

DROP TRIGGER IF EXISTS trg_webhooks_subscriptions_touch_updated_at ON webhooks_subscriptions;

CREATE OR REPLACE FUNCTION fn_webhook_subscriptions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS fn_webhooks_subscriptions_touch_updated_at();

DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT conname INTO fk_name
      FROM pg_constraint
     WHERE conrelid = 'webhooks_deliveries'::regclass
       AND contype  = 'f';
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE webhooks_deliveries RENAME CONSTRAINT %I TO webhook_deliveries_subscription_id_fkey', fk_name);
    END IF;
END $$;

ALTER TABLE webhooks_subscriptions RENAME CONSTRAINT webhooks_subscriptions_url_nonempty
                                                  TO webhook_subscriptions_url_nonempty;

ALTER INDEX webhooks_deliveries_pending      RENAME TO webhook_deliveries_pending;
ALTER INDEX webhooks_subscriptions_workspace RENAME TO webhook_subscriptions_workspace;

ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_created_at      TO created_at;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_last_error      TO last_error;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_next_attempt_at TO next_attempt_at;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_claimed_at      TO claimed_at;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_max_attempts    TO max_attempts;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_attempts        TO attempts;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_payload         TO payload;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_event_type      TO event_type;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_id_webhooks_subscription TO subscription_id;
ALTER TABLE webhooks_deliveries RENAME COLUMN webhooks_deliveries_id              TO id;

ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_archived_at  TO archived_at;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_updated_at   TO updated_at;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_created_at   TO created_at;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_is_active    TO is_active;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_secret       TO secret;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_events       TO events;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_url          TO url;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_id_workspace TO workspace_id;
ALTER TABLE webhooks_subscriptions RENAME COLUMN webhooks_subscriptions_id           TO id;

ALTER TABLE webhooks_deliveries    RENAME TO webhook_deliveries;
ALTER TABLE webhooks_subscriptions RENAME TO webhook_subscriptions;

CREATE TRIGGER trg_webhook_subscriptions_touch_updated_at
    BEFORE UPDATE ON webhook_subscriptions
    FOR EACH ROW EXECUTE FUNCTION fn_webhook_subscriptions_touch_updated_at();

COMMIT;
