-- PLA-0039 / Story 00531 (B22.11): two-transport audit segregation.
--
-- Adds source_transport to audit_log so every event records which HTTP
-- transport admitted the request:
--
--   'site'   — the BFF transport mounted at /_site (Next.js → backend),
--              callable only with a session cookie. The default for the
--              MVP scope; UI flows still land here.
--   'public' — the public, key-authenticated API transport mounted at
--              /samantha/v2 (frozen contract; future external callers).
--
-- A NULL value is reserved for legacy rows written before this column
-- existed. New writes MUST set the column; the audit.Logger surface
-- (PLA-0039 / Story 00531) requires the caller to pass a transport
-- value, sourced from request context (transport.FromContext) at the
-- handler boundary.
--
-- Idempotent: safe to re-run.

ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS source_transport TEXT
        CHECK (source_transport IN ('site', 'public'));

-- Partial index — only new (non-NULL) rows benefit from the index;
-- legacy rows remain queryable via the existing idx_audit_log_action.
CREATE INDEX IF NOT EXISTS idx_audit_log_source_transport
    ON audit_log(source_transport)
    WHERE source_transport IS NOT NULL;

COMMENT ON COLUMN audit_log.source_transport IS
    'Transport that admitted the request: ''site'' (BFF /_site) or ''public'' (/samantha/v2). NULL for pre-PLA-0039 rows.';
