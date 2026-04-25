-- ============================================================
-- MMFFDev - Vector: Library release acknowledgements (Phase 3)
-- Migration 021 — applied on top of 020_portfolio_model_page.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 021_library_acknowledgements.sql
--
-- Per-subscription acknowledgement of an mmff_library release.
-- Lives in mmff_vector because acks are tenant state, not library
-- state — gadmins acknowledge for their subscription, and the row
-- references the subscription + acting user via real Postgres FKs.
--
-- The release_id column is an APP-ENFORCED FK into mmff_library.library_releases
-- (Postgres has no cross-DB RI). The reconciler treats unmatched
-- release_ids as orphans (logged, not auto-pruned).
--
-- Plan §12.3.
-- ============================================================

BEGIN;

CREATE TABLE library_acknowledgements (
    -- Composite PK: at most one ack per (subscription, release).
    subscription_id         UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    release_id              UUID        NOT NULL,                                            -- app-enforced FK to mmff_library.library_releases
    acknowledged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- Action the gadmin took. Mirrors the action_key vocabulary in
    -- mmff_library.library_release_actions (kept loose-coupled — no FK).
    action_taken            TEXT        NOT NULL CHECK (action_taken IN
                                ('upgrade_model','review_terminology','enable_flag','dismissed')),
    PRIMARY KEY (subscription_id, release_id)
);

CREATE INDEX idx_library_acks_subscription
    ON library_acknowledgements (subscription_id, acknowledged_at DESC);

CREATE INDEX idx_library_acks_release
    ON library_acknowledgements (release_id);

COMMENT ON TABLE library_acknowledgements IS
    'Per-subscription ack of a mmff_library release. release_id is an '
    'app-enforced FK into mmff_library.library_releases (no cross-DB RI). '
    'See plan §12.3.';

COMMIT;
