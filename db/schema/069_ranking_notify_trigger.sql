-- ============================================================
-- 069 — Generic ranking: NOTIFY trigger convention
--
-- Defines a single trigger function `notify_rank_changed()` that
-- every orderable resource attaches to. Emits a JSON payload on
-- the `rank_changed` channel; the Go WebSocket hub LISTENs once
-- per process and fans out to subscribed clients.
--
-- Payload shape (kept tiny — clients refetch the affected list):
--   {
--     "resource_type":   "work_item" | "defect" | ...,
--     "subscription_id": <uuid>,           -- tenant scope
--     "scope":           "sprint" | "backlog",
--     "scope_id":        <uuid> | null,    -- sprint id when scope=sprint
--     "row_id":          <uuid>,           -- the row that moved
--     "op":              "INSERT" | "UPDATE" | "DELETE"
--   }
--
-- The function reads `subscription_id`, `sprint_id`,
-- `backlog_position`, `sprint_position` from NEW (or OLD on
-- DELETE). All adopters MUST expose those four columns — that's
-- the position-columns convention from migration 068.
--
-- Backfill of 068's position columns happens here too, in step
-- 3, so the table is left in a consistent state with the new
-- invariant before the trigger fires for the first time.
-- ============================================================

-- 1. Trigger function (resource-agnostic).
CREATE OR REPLACE FUNCTION notify_rank_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rec          record;
    resource_arg text;
    payload      jsonb;
    scope_label  text;
    scope_id     uuid;
BEGIN
    -- Resource type is passed as a trigger argument so one
    -- function serves every adopter table.
    resource_arg := TG_ARGV[0];

    IF (TG_OP = 'DELETE') THEN
        rec := OLD;
    ELSE
        rec := NEW;
    END IF;

    IF rec.sprint_id IS NULL THEN
        scope_label := 'backlog';
        scope_id    := NULL;
    ELSE
        scope_label := 'sprint';
        scope_id    := rec.sprint_id;
    END IF;

    payload := jsonb_build_object(
        'resource_type',   resource_arg,
        'subscription_id', rec.subscription_id,
        'scope',           scope_label,
        'scope_id',        scope_id,
        'row_id',          rec.id,
        'op',              TG_OP
    );

    -- pg_notify is async; channel name is fixed, payload <8000 bytes.
    PERFORM pg_notify('rank_changed', payload::text);

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- 2. Attach the trigger to work_items (first adopter).
DROP TRIGGER IF EXISTS trg_o_wi_rank_changed
    ON o_artefacts_execution_work_items;

CREATE TRIGGER trg_o_wi_rank_changed
    AFTER INSERT OR UPDATE OR DELETE
    ON o_artefacts_execution_work_items
    FOR EACH ROW
    EXECUTE FUNCTION notify_rank_changed('work_item');

-- 3. Backfill position columns added in 068.
--
-- Order: deterministic by key_num ASC within scope. Gap = 100.
-- Two passes — one for the backlog cohort (sprint_id IS NULL),
-- one for each sprint cohort. row_number() partitioned by scope
-- assigns 100, 200, 300, ...
WITH ranked AS (
    SELECT
        id,
        sprint_id,
        row_number() OVER (
            PARTITION BY subscription_id, sprint_id
            ORDER BY key_num
        ) * 100 AS pos
    FROM o_artefacts_execution_work_items
    WHERE archived_at IS NULL
)
UPDATE o_artefacts_execution_work_items w
SET
    backlog_position = CASE WHEN ranked.sprint_id IS NULL     THEN ranked.pos ELSE NULL END,
    sprint_position  = CASE WHEN ranked.sprint_id IS NOT NULL THEN ranked.pos ELSE NULL END
FROM ranked
WHERE w.id = ranked.id;
