-- db/schema/down/121_work_items_due_date_DOWN.sql
--
-- DOWN for 121_work_items_due_date.sql — drop the nullable due_date
-- column from o_artefacts_execution_work_items. Idempotent so a partial
-- rollback can re-run safely.

ALTER TABLE o_artefacts_execution_work_items
    DROP COLUMN IF EXISTS due_date;
