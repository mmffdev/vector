-- vector_artefacts: create error_events
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P1
--
-- Source table: mmff_vector.error_events (18 rows at 2026-05-13).
--
-- Cross-DB FK note: subscription_id and user_id reference tables that
-- still live in mmff_vector (subscriptions, users). We DROP the DB-level
-- FKs here and rely on the application layer for referential integrity:
--   • Table is append-only — UPDATE/DELETE rejected by trigger, so
--     ON DELETE behaviour never fires through the parent FK.
--   • Original ON DELETE SET NULL (user_id) becomes "stale id remains" —
--     acceptable for an error log; readers tolerate missing user matches
--     the same way they already tolerate missing error_codes matches
--     (LEFT JOIN cross-DB, surface raw value if no match).
--   • Original ON DELETE RESTRICT (subscription_id) becomes "no protection"
--     at the DB layer; the subscription teardown path will need to
--     decide whether to delete error_events rows or let them dangle
--     (see TD recommendation in plan doc).
-- FKs may be restored within vector_artefacts after P5 (subscriptions)
-- and P6 (users) migrate.
--
-- Indexes + append-only triggers mirror mmff_vector exactly.

BEGIN;

CREATE TABLE error_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL,
    user_id         UUID,
    code            TEXT        NOT NULL,
    context         JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_error_events_subscription_code
    ON error_events (subscription_id, code, occurred_at DESC);

CREATE INDEX idx_error_events_subscription_occurred
    ON error_events (subscription_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION error_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'error_events is append-only (op=%, id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_error_events_no_update
    BEFORE UPDATE ON error_events
    FOR EACH ROW EXECUTE FUNCTION error_events_append_only();

CREATE TRIGGER trg_error_events_no_delete
    BEFORE DELETE ON error_events
    FOR EACH ROW EXECUTE FUNCTION error_events_append_only();

COMMENT ON TABLE  error_events IS
    'Per-subscription append-only log of reported errors. Moved from '
    'mmff_vector 2026-05-13. FKs to users/subscriptions are app-enforced '
    '(cross-DB). UPDATE/DELETE rejected by trigger.';

COMMENT ON COLUMN error_events.code IS
    'App-enforced FK by value to mmff_library.error_codes.code. '
    'Not a Postgres FK (cross-database). Readers should LEFT JOIN '
    'across DBs and tolerate missing matches.';

COMMENT ON COLUMN error_events.context IS
    'Optional structured payload from reportError(code, context). '
    'Small JSON object (< ~4 KB) of short snake_case keys. Link out '
    'to logs/traces for anything larger.';

COMMENT ON COLUMN error_events.request_id IS
    'Correlation handle to logs/traces. Matches go-chi '
    'middleware.RequestID output (TEXT, not UUID).';

COMMIT;
