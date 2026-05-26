-- ============================================================
-- 107_artefacts_column_prefix_RF1_5_7_DOWN.sql
--
-- Reverses 107_artefacts_column_prefix_RF1_5_7.sql.
-- Must be applied AFTER 108 has been reversed (because 108
-- rebinds the trigger and rewrites function bodies to the new
-- prefixed column names).
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_id_priority_fkey
                  TO artefacts_priority_id_fk;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_id_topology_node_fkey
                  TO artefacts_topology_node_id_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_id_parent_fkey
                  TO artefacts_parent_artefact_id_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_id_flow_state_fkey
                  TO artefacts_flow_state_id_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_id_artefact_type_fkey
                  TO artefacts_artefact_type_id_fkey;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_story_points_nonneg_chk
                  TO artefacts_story_points_nonneg;

ALTER TABLE artefacts
    RENAME CONSTRAINT artefacts_colour_hex_format_chk
                  TO artefacts_colour_hex_format;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_artefacts_id_workspace_id_artefact_type_position
    RENAME TO artefacts_workspace_type_position;

ALTER INDEX idx_artefacts_id_topology_node
    RENAME TO artefacts_topology_node_id_live_idx;

ALTER INDEX idx_artefacts_id_subscription
    RENAME TO artefacts_subscription;

ALTER INDEX idx_artefacts_search_index
    RENAME TO artefacts_search_gist;

ALTER INDEX idx_artefacts_id_parent_position
    RENAME TO artefacts_parent;

ALTER INDEX artefacts_id_subscription_id_artefact_type_number_unique
    RENAME TO artefacts_number_unique_per_type;

ALTER INDEX idx_artefacts_id_timebox_sprint
    RENAME TO artefacts_id_timebox_sprint;

ALTER INDEX idx_artefacts_id_timebox_release
    RENAME TO artefacts_id_timebox_release;

ALTER INDEX idx_artefacts_id_timebox_milestone
    RENAME TO artefacts_id_timebox_milestone_idx;

ALTER INDEX idx_artefacts_id_flow_state
    RENAME TO artefacts_flow_state;

ALTER INDEX idx_artefacts_due_date
    RENAME TO artefacts_due_date;

ALTER INDEX idx_artefacts_description_doc_gin
    RENAME TO artefacts_description_doc_gin;

ALTER INDEX idx_artefacts_id_subscription_blocked
    RENAME TO artefacts_blocked;

ALTER INDEX idx_artefacts_id_user_assigned_to
    RENAME TO artefacts_assignee;

-- ---- Column renames (reverse) ----

ALTER TABLE artefacts RENAME COLUMN artefacts_archived_at         TO archived_at;
ALTER TABLE artefacts RENAME COLUMN artefacts_updated_at          TO updated_at;
ALTER TABLE artefacts RENAME COLUMN artefacts_created_at          TO created_at;

ALTER TABLE artefacts RENAME COLUMN artefacts_description_doc     TO description_doc;
ALTER TABLE artefacts RENAME COLUMN artefacts_blocked_reason      TO blocked_reason;
ALTER TABLE artefacts RENAME COLUMN artefacts_is_blocked          TO is_blocked;
ALTER TABLE artefacts RENAME COLUMN artefacts_colour              TO colour;
ALTER TABLE artefacts RENAME COLUMN artefacts_content_embedding   TO content_embedding;
ALTER TABLE artefacts RENAME COLUMN artefacts_search_index        TO search_index;
ALTER TABLE artefacts RENAME COLUMN artefacts_due_date            TO due_date;
ALTER TABLE artefacts RENAME COLUMN artefacts_story_points        TO story_points;
ALTER TABLE artefacts RENAME COLUMN artefacts_position            TO position;
ALTER TABLE artefacts RENAME COLUMN artefacts_description         TO description;
ALTER TABLE artefacts RENAME COLUMN artefacts_title               TO title;
ALTER TABLE artefacts RENAME COLUMN artefacts_number              TO number;

ALTER TABLE artefacts RENAME COLUMN artefacts_id_priority         TO priority_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_topology_node    TO topology_node_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_user_owned_by    TO owned_by_user_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_user_assigned_to TO assigned_to_user_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_user_created_by  TO created_by_user_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_flow_state       TO flow_state_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_parent           TO parent_artefact_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_artefact_type    TO artefact_type_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_workspace        TO workspace_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id_subscription     TO subscription_id;
ALTER TABLE artefacts RENAME COLUMN artefacts_id                  TO id;

-- ---- Trigger finalize (paired with 108 DOWN teardown) ----
--
-- 108 DOWN dropped the per-table set_updated_at function/trigger and
-- the search_enqueue trigger. Now that 107 has reversed the column
-- renames back to bare, we can re-create the pre-RF1.5.7 trigger
-- bindings with `UPDATE OF title, description` and the bare-column
-- function bodies (`NEW.updated_at`, `NEW.id`, etc.).

-- Rebind set_updated_at to the shared bare-column function.
CREATE TRIGGER artefacts_set_updated_at
    BEFORE UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Restore bare-column body for the search_enqueue function.
-- NOTE: the outbox target column is whatever 105 left it as. When
-- 107 DOWN runs in isolation (105 NOT reversed — the standard
-- in-place rollback path), the outbox column is the prefixed
-- artefacts_search_outbox_id_artefact. If 105 has ALSO been
-- reversed before this finalize block runs, the outbox column is
-- the bare artefact_id and this CREATE will fail at first INSERT
-- attempt — re-rollback 105 LAST, not before 107 DOWN.
CREATE OR REPLACE FUNCTION artefacts_search_enqueue() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO artefacts_search_outbox (artefacts_search_outbox_id_artefact)
    VALUES (NEW.id)
    ON CONFLICT DO NOTHING;
    PERFORM pg_notify('search_index_queue', NEW.id::text);
    RETURN NEW;
END;
$$;

CREATE TRIGGER artefacts_search_enqueue
    AFTER INSERT OR UPDATE OF title, description ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_search_enqueue();

COMMIT;
