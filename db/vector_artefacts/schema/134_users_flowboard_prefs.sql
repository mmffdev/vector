-- ============================================================
-- 134_users_flowboard_prefs.sql
--
-- FlowBoard — per-user card-field preferences, keyed by artefact type.
--
-- A row records which fields a user wants shown on FlowBoard cards for
-- a given artefact type. Absence of a row means "use the sidecar default"
-- (Rally-matching: ["id","title","assignee","points","priority"]).
--
-- UNIQUE (user_id, artefact_type_id) so each (user, type) pair has
-- exactly one preference row. workspace_id is denormalised for the
-- sentinel clamp so query-by-workspace needs no join.
--
-- Part of the FlowBoard PLA — S01 schema migrations (FB1.1).
-- See docs/superpowers/specs/2026-05-27-flowboard-design.md §3.3.
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE users_flowboard_prefs (
    users_flowboard_prefs_id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    users_flowboard_prefs_user_id          uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    users_flowboard_prefs_artefact_type_id uuid        NOT NULL
        REFERENCES artefacts_types(artefacts_types_id) ON DELETE CASCADE,
    users_flowboard_prefs_card_fields      JSONB       NOT NULL,
    users_flowboard_prefs_workspace_id     uuid        NOT NULL,
    users_flowboard_prefs_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One prefs row per (user, artefact type) — idempotency
CREATE UNIQUE INDEX users_flowboard_prefs_user_type_uidx
    ON users_flowboard_prefs (
        users_flowboard_prefs_user_id,
        users_flowboard_prefs_artefact_type_id
    );

-- Workspace-clamped look-up (sentinel scope)
CREATE INDEX users_flowboard_prefs_workspace_idx
    ON users_flowboard_prefs (users_flowboard_prefs_workspace_id);

COMMIT;
