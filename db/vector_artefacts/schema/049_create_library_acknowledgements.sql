-- vector_artefacts: create library_acknowledgements
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P1
--
-- Source table: mmff_vector.library_acknowledgements (0 rows at 2026-05-13).
--
-- This is one half of the cross-DB library-release ack workflow:
--   • mmff_library.library_releases       (read-only source of releases)
--   • vector_artefacts.library_acknowledgements (per-subscription ack state) ← here
--
-- Cross-DB FK note: subscription_id and acknowledged_by_user_id reference
-- tables that still live in mmff_vector (subscriptions, users). We DROP
-- the DB-level FKs here and rely on the application layer for referential
-- integrity. Justification:
--   • Inserts happen behind the libraryreleases handler which validates
--     subscription ownership from the auth user before writing.
--   • acknowledged_by_user_id ON DELETE RESTRICT becomes "stale id remains" —
--     acceptable for an audit-trail-style log; readers tolerate it.
--   • subscription_id ON DELETE RESTRICT becomes "no DB protection" — the
--     subscription teardown path will need to either delete the matching
--     acks or accept the dangle (TD recommendation in plan doc).
-- FKs may be restored within vector_artefacts once subscriptions + users
-- migrate (P5/P6).
--
-- Indexes mirror mmff_vector exactly. No triggers on source table.

BEGIN;

CREATE TABLE library_acknowledgements (
    subscription_id         UUID        NOT NULL,
    release_id              UUID        NOT NULL,
    acknowledged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by_user_id UUID        NOT NULL,
    action_taken            TEXT        NOT NULL,
    CONSTRAINT library_acknowledgements_pkey
        PRIMARY KEY (subscription_id, release_id),
    CONSTRAINT library_acknowledgements_action_taken_check
        CHECK (action_taken = ANY (ARRAY[
            'upgrade_model'::text,
            'review_terminology'::text,
            'enable_flag'::text,
            'dismissed'::text
        ]))
);

CREATE INDEX idx_library_acks_release
    ON library_acknowledgements (release_id);

CREATE INDEX idx_library_acks_subscription
    ON library_acknowledgements (subscription_id, acknowledged_at DESC);

COMMENT ON TABLE library_acknowledgements IS
    'Per-subscription ack state for library_releases (mmff_library). '
    'Moved from mmff_vector 2026-05-13 (PLA-0023 P1). Cross-DB FKs to '
    'subscriptions / users are app-enforced.';

COMMENT ON COLUMN library_acknowledgements.release_id IS
    'App-enforced FK by value to mmff_library.library_releases.id. '
    'Not a Postgres FK (cross-database). Handler validates via libRO before '
    'INSERT so orphan rows cannot land from a malicious client.';

COMMIT;
