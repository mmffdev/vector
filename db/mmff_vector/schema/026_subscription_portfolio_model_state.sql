-- ============================================================
-- MMFFDev - Vector: Per-subscription portfolio-model adoption state
-- Migration 026 — applied on top of 025_nav_group_reorder.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 026_subscription_portfolio_model_state.sql
--
-- Tracks which mmff_library portfolio_models a subscription has
-- adopted, who clicked "adopt" (a padmin), when, and the lifecycle
-- state of that adoption. The adoption itself is a multi-step saga
-- (snapshot library → mirror tables → flip subscription pointer →
-- enqueue cross-DB cleanup; see feature_library_db_and_portfolio_presets_v3.md
-- §10–§11), so a `status` column is needed to track in-flight,
-- successful, failed, and rolled-back adoptions.
--
-- Cross-DB note: `adopted_model_id` references
-- `mmff_library.portfolio_models.id`. Postgres has no cross-DB
-- foreign keys, so this is an APP-ENFORCED reference — the adoption
-- handler is the only writer and must validate against the library
-- before INSERT. See c_polymorphic_writes.md for the writer-rules
-- pattern; reconciler in feature_library_db_and_portfolio_presets_v3.md
-- §8 sweeps for orphans nightly.
--
-- Uniqueness: a subscription may have at most ONE non-terminal
-- adoption row at a time (`pending`/`in_progress`/`completed`).
-- Failed and rolled-back rows stay for audit but don't block a new
-- attempt. Enforced by partial unique index on subscription_id where
-- archived_at IS NULL AND status NOT IN ('failed','rolled_back').
-- (Plan v3 §7 originally used `subscription_id` as PK without a status
-- vocabulary; this migration deliberately supersedes that draft to
-- support the in-flight saga states the adoption handler needs.)
-- ============================================================

BEGIN;

CREATE TABLE subscription_portfolio_model_state (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    subscription_id     UUID        NOT NULL
                                    REFERENCES subscriptions(id) ON DELETE RESTRICT,

    -- App-enforced FK to mmff_library.portfolio_models.id. Postgres
    -- cannot enforce cross-DB FKs; the adoption handler validates
    -- this reference before INSERT. See migration header.
    adopted_model_id    UUID        NOT NULL,

    -- Padmin who initiated the adoption. Role is enforced at the
    -- handler layer (padmin-only endpoint). RESTRICT so a user with
    -- a non-archived adoption cannot be hard-deleted.
    adopted_by_user_id  UUID        NOT NULL
                                    REFERENCES users(id) ON DELETE RESTRICT,

    adopted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Lifecycle vocabulary owned by the adoption saga:
    --   pending      — row created, snapshot not yet taken
    --   in_progress  — snapshot taken, mirror writes underway
    --   completed    — adoption succeeded; subscription is on this model
    --   failed       — saga aborted; cleanup ran
    --   rolled_back  — saga succeeded then later reversed
    -- Confirm against feature_library_db_and_portfolio_presets_v3.md
    -- before adding new values; CHECK keeps writers honest.
    status              TEXT        NOT NULL
                                    CHECK (status IN (
                                        'pending',
                                        'in_progress',
                                        'completed',
                                        'failed',
                                        'rolled_back'
                                    )),

    archived_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "what is subscription X's current adoption?" Live rows only.
CREATE INDEX idx_subscription_portfolio_model_state_subscription_id
    ON subscription_portfolio_model_state (subscription_id)
    WHERE archived_at IS NULL;

-- Operator/UI lookups: filter by lifecycle state within a subscription.
CREATE INDEX idx_subscription_portfolio_model_state_status
    ON subscription_portfolio_model_state (subscription_id, status)
    WHERE archived_at IS NULL;

-- A subscription may have at most ONE non-terminal adoption at a time.
-- Failed/rolled_back rows are audit-only and don't block a fresh attempt.
CREATE UNIQUE INDEX idx_subscription_portfolio_model_state_active_unique
    ON subscription_portfolio_model_state (subscription_id)
    WHERE archived_at IS NULL
      AND status NOT IN ('failed', 'rolled_back');

CREATE TRIGGER trg_subscription_portfolio_model_state_updated_at
    BEFORE UPDATE ON subscription_portfolio_model_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE subscription_portfolio_model_state IS
    'Per-subscription adoption record for an mmff_library portfolio_models row. '
    'One non-terminal row per subscription (partial unique index). See '
    'feature_library_db_and_portfolio_presets_v3.md §11 for the adoption saga.';

COMMENT ON COLUMN subscription_portfolio_model_state.adopted_model_id IS
    'App-enforced FK to mmff_library.portfolio_models.id. Cross-DB FKs '
    'do not exist in Postgres; the adoption handler validates this '
    'reference at write time and the nightly reconciler sweeps for orphans. '
    'See c_polymorphic_writes.md for the writer-rules pattern.';

COMMENT ON COLUMN subscription_portfolio_model_state.adopted_by_user_id IS
    'Padmin user who initiated the adoption. Role enforced at the handler '
    '(padmin-only endpoint), not at the DB. RESTRICT prevents hard-delete '
    'of a user while their adoption is live.';

COMMENT ON COLUMN subscription_portfolio_model_state.status IS
    'Adoption-saga lifecycle: pending, in_progress, completed, failed, '
    'rolled_back. CHECK constraint pins the vocabulary; new values require '
    'a migration + handler update.';

COMMIT;
