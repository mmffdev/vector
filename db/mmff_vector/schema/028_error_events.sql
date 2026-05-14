-- ============================================================
-- MMFFDev - Vector: Per-subscription error event log
-- Migration 028 — applied on top of 025_nav_group_reorder.sql
-- (slots 026/027 reserved by parallel mmff_library work)
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 028_error_events.sql
--
-- Purpose
--   Append-only log of errors reported by handlers/clients via
--   reportError(code, context). One row per occurrence, scoped to
--   the originating subscription (and user, when known).
--
-- Cross-DB reference (NOT a real FK)
--   `code` is a string FK by value to mmff_library.error_codes.code.
--   Postgres has no cross-database FK; runtime validates by either
--   joining cross-DB at read time or by application logic at write
--   time. Library catalogue evolves independently — this table must
--   not break if a code is renamed/removed in the library; readers
--   join LEFT and surface the raw code if no library row matches.
--   See TD-LIB-007 below for the cap and pay-down.
--
-- Append-only enforcement
--   Matches item_state_history (migration 006): UPDATE and DELETE
--   are rejected by trigger. audit_log is convention-only; this
--   table follows the stricter pattern because error events feed
--   reliability dashboards where any silent edit corrupts the data.
--
-- Schema rationale
--   - No archived_at / no soft-archive: append-only audit data.
--   - No updated_at: rows are immutable; trigger blocks UPDATE.
--   - user_id ON DELETE SET NULL: a deleted user must not erase
--     their error history (audit/compliance). subscription_id stays
--     RESTRICT — losing a subscription drops all of its data via
--     explicit teardown, not via cascade from the parent table.
--   - context JSONB: arbitrary structured payload from the report
--     site. Keep small (< a few KB); link out to logs for blobs.
--   - request_id TEXT: matches go-chi middleware.RequestID output
--     (variable-length string, see backend/cmd/server/main.go).
-- ============================================================

BEGIN;

CREATE TABLE error_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    user_id         UUID                 REFERENCES users(id)         ON DELETE SET NULL,

    -- App-enforced FK by value to mmff_library.error_codes.code.
    -- See table-level note above; not a Postgres FK.
    code            TEXT        NOT NULL,

    -- Arbitrary structured payload from reportError(code, context).
    -- Expected shape: small JSON object keyed by short snake_case
    -- field names (e.g. {"handler":"...","status":500,
    -- "downstream":"library","detail":"..."}). Keep < ~4 KB; link
    -- out to logs/traces for blobs.
    context         JSONB,

    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Correlation handle to logs/traces. Matches the value set by
    -- chi middleware.RequestID (see backend/cmd/server/main.go).
    -- TEXT, not UUID — chi generates a non-UUID string.
    request_id      TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary read pattern: "show last N errors of code X for this
-- subscription". DESC on occurred_at so a reverse scan returns
-- newest first without an extra sort.
CREATE INDEX idx_error_events_subscription_code
    ON error_events (subscription_id, code, occurred_at DESC);

-- Secondary read pattern: "recent errors regardless of code" for
-- dashboards / alerting feeds.
CREATE INDEX idx_error_events_subscription_occurred
    ON error_events (subscription_id, occurred_at DESC);

-- ------------------------------------------------------------
-- Append-only guard: reject UPDATE and DELETE (matches
-- item_state_history pattern from migration 006).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Documentation: column comments for ops + future readers.
-- ------------------------------------------------------------
COMMENT ON TABLE  error_events IS
    'Per-subscription append-only log of reported errors. Matches '
    'item_state_history append-only pattern. UPDATE/DELETE rejected '
    'by trigger.';

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
