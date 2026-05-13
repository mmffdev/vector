-- vector_artefacts: create audit_log
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P1
--
-- Source table: mmff_vector.audit_log (3672 rows at 2026-05-13).
-- Cross-DB FK note: user_id and subscription_id reference tables that still
-- live in mmff_vector. We DROP the DB-level FKs here and rely on the
-- application layer for referential integrity:
--   • Rows are append-only — no UPDATE / DELETE path that needs cascade.
--   • Original ON DELETE SET NULL behaviour is replaced by "stale id remains".
--     Acceptable for an audit trail; original intent was to preserve the row.
-- FKs will be restored within vector_artefacts after P6 (users + subscriptions
-- migrate in P6 / P5).
--
-- Indexes mirror mmff_vector exactly so query plans don't regress.

BEGIN;

CREATE TABLE audit_log (
    id               UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID,
    subscription_id  UUID,
    action           TEXT                     NOT NULL,
    resource         TEXT,
    resource_id      TEXT,
    metadata         JSONB,
    ip_address       INET,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    source_transport TEXT,
    CONSTRAINT audit_log_source_transport_check
        CHECK (source_transport = ANY (ARRAY['site'::text, 'public'::text]))
);

CREATE INDEX idx_audit_log_action            ON audit_log(action);
CREATE INDEX idx_audit_log_created           ON audit_log(created_at);
CREATE INDEX idx_audit_log_source_transport  ON audit_log(source_transport) WHERE source_transport IS NOT NULL;
CREATE INDEX idx_audit_log_subscription_id   ON audit_log(subscription_id);
CREATE INDEX idx_audit_log_user_id           ON audit_log(user_id);

COMMENT ON TABLE audit_log IS
    'Append-only audit trail. Moved from mmff_vector 2026-05-13. FKs to users/subscriptions are app-enforced (cross-DB).';

COMMIT;
