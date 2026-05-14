-- ============================================================
-- MMFFDev - vector_artefacts: RF1.4.2.webhooks
-- Migration 055 — rename webhook_subscriptions → webhooks_subscriptions,
-- webhook_deliveries → webhooks_deliveries, and apply §2.3 column-
-- prefix + §2.4 PK/FK rules to both tables.
-- ============================================================

BEGIN;

ALTER TABLE webhook_subscriptions RENAME TO webhooks_subscriptions;
ALTER TABLE webhook_deliveries    RENAME TO webhooks_deliveries;

-- webhooks_subscriptions columns.
ALTER TABLE webhooks_subscriptions RENAME COLUMN id           TO webhooks_subscriptions_id;
ALTER TABLE webhooks_subscriptions RENAME COLUMN workspace_id TO webhooks_subscriptions_id_workspace;
ALTER TABLE webhooks_subscriptions RENAME COLUMN url          TO webhooks_subscriptions_url;
ALTER TABLE webhooks_subscriptions RENAME COLUMN events       TO webhooks_subscriptions_events;
ALTER TABLE webhooks_subscriptions RENAME COLUMN secret       TO webhooks_subscriptions_secret;
ALTER TABLE webhooks_subscriptions RENAME COLUMN is_active    TO webhooks_subscriptions_is_active;
ALTER TABLE webhooks_subscriptions RENAME COLUMN created_at   TO webhooks_subscriptions_created_at;
ALTER TABLE webhooks_subscriptions RENAME COLUMN updated_at   TO webhooks_subscriptions_updated_at;
ALTER TABLE webhooks_subscriptions RENAME COLUMN archived_at  TO webhooks_subscriptions_archived_at;

-- webhooks_deliveries columns.
ALTER TABLE webhooks_deliveries RENAME COLUMN id              TO webhooks_deliveries_id;
ALTER TABLE webhooks_deliveries RENAME COLUMN subscription_id TO webhooks_deliveries_id_webhooks_subscription;
ALTER TABLE webhooks_deliveries RENAME COLUMN event_type      TO webhooks_deliveries_event_type;
ALTER TABLE webhooks_deliveries RENAME COLUMN payload         TO webhooks_deliveries_payload;
ALTER TABLE webhooks_deliveries RENAME COLUMN attempts        TO webhooks_deliveries_attempts;
ALTER TABLE webhooks_deliveries RENAME COLUMN max_attempts    TO webhooks_deliveries_max_attempts;
ALTER TABLE webhooks_deliveries RENAME COLUMN claimed_at      TO webhooks_deliveries_claimed_at;
ALTER TABLE webhooks_deliveries RENAME COLUMN next_attempt_at TO webhooks_deliveries_next_attempt_at;
ALTER TABLE webhooks_deliveries RENAME COLUMN last_error      TO webhooks_deliveries_last_error;
ALTER TABLE webhooks_deliveries RENAME COLUMN created_at      TO webhooks_deliveries_created_at;

-- Rename indexes + constraints to match new names.
ALTER INDEX webhook_subscriptions_workspace RENAME TO webhooks_subscriptions_workspace;
ALTER INDEX webhook_deliveries_pending      RENAME TO webhooks_deliveries_pending;
ALTER TABLE webhooks_subscriptions RENAME CONSTRAINT webhook_subscriptions_url_nonempty
                                                  TO webhooks_subscriptions_url_nonempty;

-- Rename the FK constraint on webhooks_deliveries (auto-named by Postgres).
DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT conname INTO fk_name
      FROM pg_constraint
     WHERE conrelid = 'webhooks_deliveries'::regclass
       AND contype  = 'f';
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE webhooks_deliveries RENAME CONSTRAINT %I TO webhooks_deliveries_id_webhooks_subscription_fkey', fk_name);
    END IF;
END $$;

-- Recreate trigger + function.
CREATE OR REPLACE FUNCTION fn_webhooks_subscriptions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.webhooks_subscriptions_updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_webhook_subscriptions_touch_updated_at()
    RENAME TO fn_webhook_subscriptions_touch_updated_at_legacy_drop;
DROP TRIGGER IF EXISTS trg_webhook_subscriptions_touch_updated_at ON webhooks_subscriptions;
DROP FUNCTION IF EXISTS fn_webhook_subscriptions_touch_updated_at_legacy_drop();

CREATE TRIGGER trg_webhooks_subscriptions_touch_updated_at
    BEFORE UPDATE ON webhooks_subscriptions
    FOR EACH ROW EXECUTE FUNCTION fn_webhooks_subscriptions_touch_updated_at();

-- BIGSERIAL implicit sequence rename (so future ALTERs see consistent names).
ALTER SEQUENCE IF EXISTS webhook_deliveries_id_seq RENAME TO webhooks_deliveries_webhooks_deliveries_id_seq;

COMMIT;
