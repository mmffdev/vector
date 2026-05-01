-- Migration 066: expand item_type check constraint to include task and defect
-- The unified work items table was initially constrained to epic/story only.
-- Tasks and defects are now first-class citizens in o_artefacts_execution_work_items.

ALTER TABLE o_artefacts_execution_work_items
  DROP CONSTRAINT o_wi_item_type_valid;

ALTER TABLE o_artefacts_execution_work_items
  ADD CONSTRAINT o_wi_item_type_valid
    CHECK (item_type = ANY (ARRAY['epic'::text, 'story'::text, 'task'::text, 'defect'::text]));
