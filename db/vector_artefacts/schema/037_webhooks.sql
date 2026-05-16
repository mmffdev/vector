-- ============================================================
-- MMFFDev - vector_artefacts: Webhooks (B9)
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 037_webhooks.sql
--
-- Tables:
--   webhook_subscriptions  — one row per registered endpoint
--   webhook_deliveries     — outbox: one row per pending/attempted delivery
--
-- Delivery guarantee: at-least-once via FOR UPDATE SKIP LOCKED,
-- same pattern as artefacts_search_outbox.
--
-- Retry policy: exponential backoff up to max_attempts (10).
-- next_attempt_at is computed by the worker after each failure.
--
-- Signature: HMAC-SHA256 of the raw payload body, keyed on the
-- subscription's secret. Sent as X-Vector-Signature: sha256=<hex>.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID        NOT NULL,
    url             TEXT        NOT NULL,
    -- Comma-separated event filter, e.g. 'item.created,item.updated'.
    -- NULL or '*' means all events.
    events          TEXT,
    secret          TEXT        NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT webhook_subscriptions_url_nonempty CHECK (url <> '')
);

CREATE INDEX IF NOT EXISTS webhook_subscriptions_workspace
    ON webhook_subscriptions (workspace_id)
    WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION fn_webhook_subscriptions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_webhook_subscriptions_touch_updated_at ON webhook_subscriptions;
CREATE TRIGGER trg_webhook_subscriptions_touch_updated_at
    BEFORE UPDATE ON webhook_subscriptions
    FOR EACH ROW EXECUTE FUNCTION fn_webhook_subscriptions_touch_updated_at();

-- Outbox for at-least-once delivery. One row is inserted per
-- (subscription, event). The worker claims rows with FOR UPDATE
-- SKIP LOCKED, attempts delivery, and either deletes on success or
-- increments attempts + schedules next_attempt_at on failure.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id                  BIGSERIAL   PRIMARY KEY,
    subscription_id     UUID        NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    event_type          TEXT        NOT NULL,
    payload             JSONB       NOT NULL,
    attempts            INT         NOT NULL DEFAULT 0,
    max_attempts        INT         NOT NULL DEFAULT 10,
    claimed_at          TIMESTAMPTZ,
    next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_pending
    ON webhook_deliveries (next_attempt_at)
    WHERE claimed_at IS NULL AND attempts < max_attempts;

COMMIT;
