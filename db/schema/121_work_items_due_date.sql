-- db/schema/121_work_items_due_date.sql
--
-- PLA-0021 / 00460 (WS4-C) — add nullable due_date to work items.
-- Replaces the synthetic dueLabel(updated_at) frontend helper with a
-- real per-row date the user can edit inline. Idempotent ADD COLUMN so
-- a re-run during a partial deploy is safe.

ALTER TABLE o_artefacts_execution_work_items
    ADD COLUMN IF NOT EXISTS due_date DATE NULL;
