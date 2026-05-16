-- PLA-0054 story 00583 — backfill artefacts_types_slot on existing rows.
--
-- WHY: migration 078 added the slot column nullable. This migration
-- populates the 5 system slots (wrk_epic, wrk_story, wrk_defect,
-- wrk_task, wrk_risk) for every existing work-scope artefact_type row
-- whose name matches the canonical vocabulary. Custom tenant types
-- keep slot=NULL — they have no project-locked slot.
--
-- Mapping is by LOWER(artefacts_types_name); the names we're matching
-- come from seed migrations (003-onwards + 071 for Risk) and are
-- known to be stable on `main`. A future gadmin rename will not break
-- the slot because the slot is the durable handle; this migration is
-- a one-shot bridge from "name-as-identity" to "slot-as-identity".
--
-- Idempotent: only updates rows where artefacts_types_slot IS NULL.
-- The unique partial index from mig 078 prevents two rows with the
-- same slot in the same workspace, so re-running is a no-op.
--
-- Drift audit: any work-scope row not matching one of the 5 canonical
-- names is logged via RAISE NOTICE so an operator can review whether
-- it should carry a slot (custom name for the canonical idea) or stay
-- NULL (a real custom type).

BEGIN;

DO $$
DECLARE
    v_updated INTEGER;
    v_unmapped RECORD;
    v_unmapped_count INTEGER := 0;
BEGIN
    -- 1) Apply the canonical mapping. Only system + tenant work rows
    --    where slot is still NULL.
    WITH mapping(name_lower, slot) AS (
        VALUES
            ('epic',   'wrk_epic'),
            ('story',  'wrk_story'),
            ('defect', 'wrk_defect'),
            ('task',   'wrk_task'),
            ('risk',   'wrk_risk')
    )
    UPDATE artefacts_types at
       SET artefacts_types_slot = m.slot
      FROM mapping m
     WHERE LOWER(at.artefacts_types_name) = m.name_lower
       AND at.artefacts_types_scope = 'work'
       AND at.artefacts_types_slot IS NULL
       AND at.artefacts_types_archived_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'Migration 079: backfilled slot on % work-scope rows', v_updated;

    -- 2) Audit-log work-scope rows that still carry NULL slot after
    --    the backfill. Operator-visible only; not an error — custom
    --    artefact types are expected to keep NULL.
    FOR v_unmapped IN
        SELECT artefacts_types_id_workspace AS ws,
               artefacts_types_name        AS name,
               artefacts_types_source      AS source
          FROM artefacts_types
         WHERE artefacts_types_scope = 'work'
           AND artefacts_types_slot IS NULL
           AND artefacts_types_archived_at IS NULL
         ORDER BY artefacts_types_id_workspace, artefacts_types_name
    LOOP
        v_unmapped_count := v_unmapped_count + 1;
        RAISE NOTICE 'Migration 079: NULL slot (custom or non-canonical) — workspace=% name=% source=%',
            v_unmapped.ws, v_unmapped.name, v_unmapped.source;
    END LOOP;

    RAISE NOTICE 'Migration 079: % work-scope row(s) remain with NULL slot (expected for custom tenant types)',
        v_unmapped_count;
END $$;

COMMIT;
