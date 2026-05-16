-- PLA-0055 story 00595 — artefacts.priority TEXT → priority_id UUID FK.
--
-- High-risk irreversible migration. Steps:
--   1) ADD COLUMN priority_id uuid NULL on artefacts.
--   2) Backfill priority_id from artefact_priorities by name + workspace:
--      - Non-NULL priority: match LOWER(a.priority) = LOWER(p.name) within
--        the artefact's workspace (workspace resolved via artefact_type).
--      - NULL priority: assign the workspace's pri_medium row — that is
--        the design default (story 00598 useDefaultPriority returns the
--        pri_medium row when present). Better than leaving NULL because
--        the new column will be NOT NULL after this migration.
--   3) Assert zero NULL priority_id post-backfill (RAISE EXCEPTION if any).
--   4) Assert zero orphan FK (every priority_id resolves) — defence in depth.
--   5) Add NOT NULL + FK constraint.
--   6) DROP the old priority TEXT column (and its CHECK constraint).
--
-- The migration runs inside one transaction so a failure rolls back the
-- column add cleanly.

BEGIN;

-- 1) Add the new column.
ALTER TABLE artefacts
  ADD COLUMN IF NOT EXISTS priority_id uuid NULL;

-- 2) Backfill.
DO $$
DECLARE
    v_matched      integer;
    v_defaulted    integer;
    v_still_null   integer;
    v_orphan       integer;
BEGIN
    -- 2a) Match by name within workspace (resolved via artefact_type).
    UPDATE artefacts a
       SET priority_id = p.id
      FROM artefacts_types at
      JOIN artefact_priorities p
        ON p.workspace_id = at.artefacts_types_id_workspace
       AND p.archived_at IS NULL
     WHERE a.artefact_type_id = at.artefacts_types_id
       AND a.priority IS NOT NULL
       AND LOWER(p.name) = LOWER(a.priority)
       AND a.priority_id IS NULL;

    GET DIAGNOSTICS v_matched = ROW_COUNT;
    RAISE NOTICE 'Migration 081: matched % artefacts by priority name', v_matched;

    -- 2b) NULL priority + any row that didn't match by name → default
    -- to the workspace's pri_medium row. Conservative + idempotent
    -- (only updates rows still NULL).
    UPDATE artefacts a
       SET priority_id = p.id
      FROM artefacts_types at
      JOIN artefact_priorities p
        ON p.workspace_id = at.artefacts_types_id_workspace
       AND p.slot = 'pri_medium'
       AND p.archived_at IS NULL
     WHERE a.artefact_type_id = at.artefacts_types_id
       AND a.priority_id IS NULL;

    GET DIAGNOSTICS v_defaulted = ROW_COUNT;
    RAISE NOTICE 'Migration 081: defaulted % artefacts to pri_medium', v_defaulted;

    -- 3) Hard assertion: zero NULL priority_id remain.
    SELECT COUNT(*) INTO v_still_null
      FROM artefacts WHERE priority_id IS NULL;
    IF v_still_null > 0 THEN
        RAISE EXCEPTION 'Migration 081: % artefacts still have NULL priority_id after backfill — workspace missing from priorities seed?', v_still_null;
    END IF;

    -- 4) Defence in depth: zero orphans.
    SELECT COUNT(*) INTO v_orphan
      FROM artefacts a
      LEFT JOIN artefact_priorities p ON p.id = a.priority_id
     WHERE p.id IS NULL;
    IF v_orphan > 0 THEN
        RAISE EXCEPTION 'Migration 081: % artefacts have orphan priority_id FK', v_orphan;
    END IF;
END $$;

-- 5) Lock the column shape: NOT NULL + FK to artefact_priorities.
ALTER TABLE artefacts
  ALTER COLUMN priority_id SET NOT NULL;

ALTER TABLE artefacts
  DROP CONSTRAINT IF EXISTS artefacts_priority_id_fk;
ALTER TABLE artefacts
  ADD CONSTRAINT artefacts_priority_id_fk
  FOREIGN KEY (priority_id) REFERENCES artefact_priorities(id);

-- 6) Drop the legacy TEXT column + its CHECK constraint.
ALTER TABLE artefacts
  DROP CONSTRAINT IF EXISTS artefacts_priority_check;
ALTER TABLE artefacts
  DROP COLUMN IF EXISTS priority;

COMMIT;
