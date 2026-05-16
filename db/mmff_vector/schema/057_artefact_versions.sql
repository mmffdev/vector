-- ============================================================
-- MMFFDev - Vector: Artefact version snapshots (Q10 Option D)
-- Migration 057 — applied on top of 056_artefact_notes.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 057_artefact_versions.sql
--
-- User-facing undo / version history. Polymorphic on
-- (artefact_type, artefact_id). One row per snapshot.
-- snapshot_jsonb: { core: {...}, field_values: [{...}, ...] }
--
-- Disaster recovery (PITR + pg_dump) is separate infrastructure.
-- Retention policy enforced by cleanup job (Phase 2).
-- ============================================================

BEGIN;

CREATE TABLE o_artefact_versions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    artefact_type   TEXT        NOT NULL REFERENCES o_artefact_type_registry(scope_key) ON DELETE RESTRICT,
    artefact_id     UUID        NOT NULL,
    version_num     INTEGER     NOT NULL,
    snapshot_jsonb  JSONB       NOT NULL,
    change_summary  TEXT,
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,

    CONSTRAINT o_av_version_num_positive CHECK (version_num > 0),
    UNIQUE (artefact_type, artefact_id, version_num)
);

CREATE INDEX idx_o_av_artefact
    ON o_artefact_versions (artefact_type, artefact_id, version_num DESC);

CREATE INDEX idx_o_av_expires
    ON o_artefact_versions (expires_at)
    WHERE expires_at IS NOT NULL;

COMMIT;
