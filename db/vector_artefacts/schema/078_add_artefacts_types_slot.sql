-- PLA-0054 story 00582 — slot enum substrate on artefacts_types.
--
-- WHY: chip filters today match by lowercased name ("epic", "risk", …)
-- which breaks the moment a gadmin renames the type. The fix is to wire
-- chips by stable per-tenant UUID; the slot enum lets pages/sidecars
-- reference a project-locked handle ("wrk_risk") that resolves to the
-- right tenant UUID via the catalogue at mount time.
--
-- Vocabulary (project-locked, append-only — never visible to users):
--   wrk_epic    — top of the work hierarchy
--   wrk_story   — mid-tier user story
--   wrk_defect  — bug / quality issue
--   wrk_task    — leaf execution unit
--   wrk_risk    — risk artefact (PLA-0052)
--
-- Custom (tenant-extended) artefact types carry slot = NULL. Only the
-- system-seeded canonical types in each workspace get a non-NULL slot.
--
-- Invariants enforced here:
--   1. CHECK constraint accepts NULL ∪ {wrk_epic, wrk_story, wrk_defect,
--      wrk_task, wrk_risk}. Bogus slot values rejected at write time.
--   2. Unique partial index on (workspace_id, slot) WHERE slot IS NOT NULL
--      AND archived_at IS NULL — so within one workspace each slot
--      appears at most once. NULLs are unconstrained (custom types).

BEGIN;

ALTER TABLE artefacts_types
  ADD COLUMN IF NOT EXISTS artefacts_types_slot text;

ALTER TABLE artefacts_types
  DROP CONSTRAINT IF EXISTS artefacts_types_slot_vocab_chk;

ALTER TABLE artefacts_types
  ADD CONSTRAINT artefacts_types_slot_vocab_chk
  CHECK (
    artefacts_types_slot IS NULL
    OR artefacts_types_slot IN (
      'wrk_epic', 'wrk_story', 'wrk_defect', 'wrk_task', 'wrk_risk'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS artefacts_types_slot_per_workspace_uniq
  ON artefacts_types (artefacts_types_id_workspace, artefacts_types_slot)
  WHERE artefacts_types_slot IS NOT NULL
    AND artefacts_types_archived_at IS NULL;

COMMIT;
