-- vector_artefacts: per-workspace portfolio adoption state
-- Migration 050 — PLA-0026 / Story 00560 (SA2)
-- 2026-05-13
--
-- Replaces mmff_vector.subscription_portfolio_model_state as the
-- canonical adoption-saga state machine on the VA substrate.
--
-- Schema decisions:
--   - workspace_id (NOT NULL) is the primary scoping key — matches the
--     VA convention used by artefact_types, flows, master_record_portfolio.
--   - subscription_id (NOT NULL) is kept as a denorm companion so cross-
--     DB queries (canary tests, admin tooling) don't need a join through
--     mmff_vector.master_record_workspaces. Validated by the Go service;
--     no Postgres-level cross-DB FK exists.
--   - adopted_model_id references mmff_library.portfolio_models.id —
--     app-enforced cross-DB reference, same discipline as the mmff_vector
--     predecessor. See c_polymorphic_writes.md.
--   - adopted_by_user_id is a cross-DB reference to mmff_vector.users.id
--     — app-enforced; no FK constraint possible across DBs.
--   - Status vocabulary is identical to the predecessor table so the
--     Go state helpers can target either DB without vocabulary changes.
--
-- Partial unique index: at most ONE non-terminal row per workspace at a
-- time (status NOT IN ('failed','rolled_back') AND archived_at IS NULL).
-- Mirrors idx_subscription_portfolio_model_state_active_unique on the
-- mmff_vector predecessor.
--
-- DOWN: DROP TABLE artefact_adoption_state CASCADE;

BEGIN;

CREATE TABLE artefact_adoption_state (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    workspace_id        UUID        NOT NULL,
    subscription_id     UUID        NOT NULL,

    -- App-enforced FK to mmff_library.portfolio_models.id.
    model_id            UUID        NOT NULL,

    -- App-enforced cross-DB reference to mmff_vector.users.id.
    adopted_by_user_id  UUID        NOT NULL,

    adopted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Lifecycle vocabulary (same as mmff_vector predecessor):
    --   pending      — row created, snapshot not yet taken
    --   in_progress  — snapshot taken, VA writes underway
    --   completed    — adoption succeeded
    --   failed       — saga aborted
    --   rolled_back  — saga succeeded then later reversed
    status              TEXT        NOT NULL
                                    CHECK (status IN (
                                        'pending',
                                        'in_progress',
                                        'completed',
                                        'failed',
                                        'rolled_back'
                                    )),

    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "what is workspace X's current adoption?" Live rows only.
CREATE INDEX idx_artefact_adoption_state_workspace_id
    ON artefact_adoption_state (workspace_id)
    WHERE archived_at IS NULL;

-- Cross-DB admin / canary: look up by subscription_id.
CREATE INDEX idx_artefact_adoption_state_subscription_id
    ON artefact_adoption_state (subscription_id)
    WHERE archived_at IS NULL;

-- At most ONE non-terminal adoption per workspace at a time.
CREATE UNIQUE INDEX idx_artefact_adoption_state_workspace_active
    ON artefact_adoption_state (workspace_id)
    WHERE archived_at IS NULL
      AND status NOT IN ('failed', 'rolled_back');

CREATE OR REPLACE FUNCTION artefact_adoption_state_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_artefact_adoption_state_updated_at
    BEFORE UPDATE ON artefact_adoption_state
    FOR EACH ROW EXECUTE FUNCTION artefact_adoption_state_set_updated_at();

COMMENT ON TABLE artefact_adoption_state IS
    'Per-workspace portfolio adoption record for a portfolio_models row '
    'from mmff_library. Replaces mmff_vector.subscription_portfolio_model_state '
    'on the vector_artefacts substrate (PLA-0026 SA2, 2026-05-13). '
    'One non-terminal row per workspace (partial unique index). '
    'Status vocabulary: pending | in_progress | completed | failed | rolled_back.';

COMMIT;
