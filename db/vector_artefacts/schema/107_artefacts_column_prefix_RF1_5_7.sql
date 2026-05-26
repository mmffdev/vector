-- ============================================================
-- 107_artefacts_column_prefix_RF1_5_7.sql
--
-- RF1.5.7 — Pillar 1 wave 7, table 1/1 (vector_artefacts side).
--
-- Applies the §2.3 column-prefix convention to vector_artefacts.artefacts
-- — the substrate table for the artefact-types system. 26 bare columns,
-- 136 live rows, heavily referenced across backend/internal/ (sole
-- writer = artefactitems; heavy readers = fields, portfoliomodels,
-- notifications/rules, searchworker).
--
-- This is the LAST bare-column table in vector_artefacts. After this
-- wave Pillar 1 is structurally complete on the VA side (modulo the
-- JSON wire-tag follow-up; see TD entry below).
--
-- The PK becomes <table>_id per §2.4; FKs follow §2.4 PK/FK shape
-- (FK = <table>_id_<target>[_<role>]) with precedents from 094-106:
--   - artefact_priorities (094)
--   - artefacts_search_outbox (105 — inbound FK source already swept)
--   - topology_nodes (103)
--   - master_record_workspaces PK normalize (106)
--
-- 3 columns are ALREADY in prefix shape from prior waves:
--   - artefacts_id_timebox_sprint    (timeboxes wave)
--   - artefacts_id_timebox_release   (timeboxes wave)
--   - artefacts_id_timebox_milestone (timeboxes wave)
-- These are NOT renamed.
--
-- Self-FK: parent_artefact_id → artefacts_id_parent per topology_nodes
-- precedent (migration 103 used `parent_id → topology_nodes_id_parent`).
--
-- JSON wire-tags on backend/internal/artefactitems/types.go and related
-- struct types are NOT touched in this wave — a follow-up TD entry covers
-- the wire-contract rewrite and frontend coordination. This wave only
-- renames DB columns + Go SQL string literals + db:"" struct tags. The
-- wire surface ({"id":"…","title":"…","status":"…"}) is unchanged.
--
-- Inbound FKs (3 — auto-retarget by oid on PK rename):
--   1. artefacts.parent_artefact_id  → artefacts(id)  [self-FK]
--   2. artefacts_fields_values.artefacts_fields_values_id_artefact
--      → artefacts(id) ON DELETE CASCADE
--   3. artefacts_search_outbox.artefacts_search_outbox_id_artefact
--      → artefacts(id) ON DELETE CASCADE
-- All 3 retarget cleanly.
--
-- No sequences (no bigserial/serial columns — PK is uuid).
--
-- Triggers (2):
--   - artefacts_set_updated_at         (uses shared set_updated_at)
--   - artefacts_search_enqueue         (uses bespoke artefacts_search_enqueue
--                                       which references NEW.id explicitly)
-- Both trigger function bodies repaired in migration 108 alongside this
-- ALTER. The trigger BINDING for artefacts_search_enqueue references
-- column names in `UPDATE OF title, description` — re-bound in 108 to
-- track the rename to artefacts_title / artefacts_description.
-- ============================================================

BEGIN;

-- ---- Column renames ----

-- PK
ALTER TABLE artefacts RENAME COLUMN id                  TO artefacts_id;

-- FKs (§2.4 PK/FK shape)
ALTER TABLE artefacts RENAME COLUMN subscription_id     TO artefacts_id_subscription;
ALTER TABLE artefacts RENAME COLUMN workspace_id        TO artefacts_id_workspace;
ALTER TABLE artefacts RENAME COLUMN artefact_type_id    TO artefacts_id_artefact_type;
ALTER TABLE artefacts RENAME COLUMN parent_artefact_id  TO artefacts_id_parent;
ALTER TABLE artefacts RENAME COLUMN flow_state_id       TO artefacts_id_flow_state;
ALTER TABLE artefacts RENAME COLUMN created_by_user_id  TO artefacts_id_user_created_by;
ALTER TABLE artefacts RENAME COLUMN assigned_to_user_id TO artefacts_id_user_assigned_to;
ALTER TABLE artefacts RENAME COLUMN owned_by_user_id    TO artefacts_id_user_owned_by;
ALTER TABLE artefacts RENAME COLUMN topology_node_id    TO artefacts_id_topology_node;
ALTER TABLE artefacts RENAME COLUMN priority_id         TO artefacts_id_priority;

-- (already prefixed in earlier waves — NOT renamed)
--   artefacts_id_timebox_sprint
--   artefacts_id_timebox_release
--   artefacts_id_timebox_milestone

-- Plain columns
ALTER TABLE artefacts RENAME COLUMN number              TO artefacts_number;
ALTER TABLE artefacts RENAME COLUMN title               TO artefacts_title;
ALTER TABLE artefacts RENAME COLUMN description         TO artefacts_description;
ALTER TABLE artefacts RENAME COLUMN position            TO artefacts_position;
ALTER TABLE artefacts RENAME COLUMN story_points        TO artefacts_story_points;
ALTER TABLE artefacts RENAME COLUMN due_date            TO artefacts_due_date;
ALTER TABLE artefacts RENAME COLUMN search_index        TO artefacts_search_index;
ALTER TABLE artefacts RENAME COLUMN content_embedding   TO artefacts_content_embedding;
ALTER TABLE artefacts RENAME COLUMN colour              TO artefacts_colour;
ALTER TABLE artefacts RENAME COLUMN is_blocked          TO artefacts_is_blocked;
ALTER TABLE artefacts RENAME COLUMN blocked_reason      TO artefacts_blocked_reason;
ALTER TABLE artefacts RENAME COLUMN description_doc    TO artefacts_description_doc;

-- Timestamps
ALTER TABLE artefacts RENAME COLUMN created_at          TO artefacts_created_at;
ALTER TABLE artefacts RENAME COLUMN updated_at          TO artefacts_updated_at;
ALTER TABLE artefacts RENAME COLUMN archived_at         TO artefacts_archived_at;

-- ---- Index renames ----

-- artefacts_pkey already matches the <table>_pkey convention.

ALTER INDEX artefacts_assignee
    RENAME TO idx_artefacts_id_user_assigned_to;

ALTER INDEX artefacts_blocked
    RENAME TO idx_artefacts_id_subscription_blocked;

ALTER INDEX artefacts_description_doc_gin
    RENAME TO idx_artefacts_description_doc_gin;

ALTER INDEX artefacts_due_date
    RENAME TO idx_artefacts_due_date;

ALTER INDEX artefacts_flow_state
    RENAME TO idx_artefacts_id_flow_state;

ALTER INDEX artefacts_id_timebox_milestone_idx
    RENAME TO idx_artefacts_id_timebox_milestone;

ALTER INDEX artefacts_id_timebox_release
    RENAME TO idx_artefacts_id_timebox_release;

ALTER INDEX artefacts_id_timebox_sprint
    RENAME TO idx_artefacts_id_timebox_sprint;

ALTER INDEX artefacts_number_unique_per_type
    RENAME TO artefacts_id_subscription_id_artefact_type_number_unique;

ALTER INDEX artefacts_parent
    RENAME TO idx_artefacts_id_parent_position;

ALTER INDEX artefacts_search_gist
    RENAME TO idx_artefacts_search_index;

ALTER INDEX artefacts_subscription
    RENAME TO idx_artefacts_id_subscription;

ALTER INDEX artefacts_topology_node_id_live_idx
    RENAME TO idx_artefacts_id_topology_node;

ALTER INDEX artefacts_workspace_type_position
    RENAME TO idx_artefacts_id_workspace_id_artefact_type_position;

-- ---- Constraint renames ----

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_colour_hex_format
                  TO artefacts_colour_hex_format_chk;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_story_points_nonneg
                  TO artefacts_story_points_nonneg_chk;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_artefact_type_id_fkey
                  TO artefacts_id_artefact_type_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_flow_state_id_fkey
                  TO artefacts_id_flow_state_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_parent_artefact_id_fkey
                  TO artefacts_id_parent_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_topology_node_id_fkey
                  TO artefacts_id_topology_node_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_priority_id_fk
                  TO artefacts_id_priority_fkey;

-- Already in convention shape (no rename needed):
--   artefacts_pkey
--   artefacts_id_timebox_milestone_fkey
--   artefacts_id_timebox_release_fkey
--   artefacts_id_timebox_sprint_fkey

COMMIT;
