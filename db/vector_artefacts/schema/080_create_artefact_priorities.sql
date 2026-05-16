-- PLA-0055 story 00594 — artefact_priorities table per workspace.
--
-- WHY: today priority is a hardcoded 4-value TEXT enum (critical/high/
-- medium/low) baked into a CHECK on artefacts.priority. Tenants who
-- want a 5th value ("Showstopper") cannot have one. This migration
-- creates a per-workspace priorities catalogue with the same slot
-- pattern we used for artefact_types in PLA-0054:
--
--   - System-seeded canonical slots stay stable across all tenants
--     (pri_critical, pri_high, pri_medium, pri_low) — invisible to
--     users, project-locked, append-only.
--   - Tenants can add custom priorities (slot = NULL).
--   - Gadmin can rename the display name freely — the slot is the
--     durable handle used by chip filters via the catalogue context.
--
-- The follow-up migration (081) backfills artefacts.priority_id from
-- the old TEXT column and drops the legacy TEXT/CHECK. This migration
-- only stands the substrate up; it does NOT touch artefacts.
--
-- Cross-DB FK note: workspaces lives in mmff_vector, so workspace_id
-- here is a plain UUID without a database-level FK — same pattern as
-- artefacts_types_id_workspace on artefacts_types. Application-layer
-- validation in the artefactpriorities service is the actual guard.

BEGIN;

CREATE TABLE IF NOT EXISTS artefact_priorities (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid        NOT NULL,
    name         text        NOT NULL,
    slot         text        NULL,
    sort_order   integer     NOT NULL DEFAULT 0,
    colour       text        NULL,
    archived_at  timestamptz NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT artefact_priorities_slot_vocab_chk CHECK (
        slot IS NULL
        OR slot IN ('pri_critical', 'pri_high', 'pri_medium', 'pri_low')
    )
);

-- One row per slot per workspace; NULL slots unconstrained (custom rows).
CREATE UNIQUE INDEX IF NOT EXISTS artefact_priorities_slot_per_workspace_uniq
  ON artefact_priorities (workspace_id, slot)
  WHERE slot IS NOT NULL
    AND archived_at IS NULL;

-- Lookup index for the workspace-clamped list query.
CREATE INDEX IF NOT EXISTS artefact_priorities_workspace_live_idx
  ON artefact_priorities (workspace_id)
  WHERE archived_at IS NULL;

-- Seed: one row per slot, per known workspace. "Known workspaces" is
-- sourced from artefacts_types (the only place vector_artefacts knows
-- about workspace_id). For each distinct workspace_id present there,
-- INSERT the 4 system priorities — skipping any that already exist
-- (idempotent: re-running the migration is a no-op).
DO $$
DECLARE
    v_ws uuid;
    v_inserted integer := 0;
BEGIN
    FOR v_ws IN
        SELECT DISTINCT artefacts_types_id_workspace
          FROM artefacts_types
         WHERE artefacts_types_id_workspace IS NOT NULL
    LOOP
        -- INSERT only the slots not already seeded into this workspace.
        -- The partial unique index ensures correctness; this NOT EXISTS
        -- guard makes re-running the migration a true no-op without
        -- needing an ON CONFLICT target (Postgres requires either a
        -- named constraint or an index column list with predicate).
        INSERT INTO artefact_priorities (workspace_id, name, slot, sort_order, colour)
        SELECT v_ws, seed.name, seed.slot, seed.sort_order, seed.colour
          FROM (VALUES
              ('Critical', 'pri_critical', 0, '#DC2626'),
              ('High',     'pri_high',     1, '#EA580C'),
              ('Medium',   'pri_medium',   2, '#CA8A04'),
              ('Low',      'pri_low',      3, '#65A30D')
          ) AS seed(name, slot, sort_order, colour)
         WHERE NOT EXISTS (
             SELECT 1 FROM artefact_priorities p
              WHERE p.workspace_id = v_ws
                AND p.slot = seed.slot
                AND p.archived_at IS NULL
         );
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted > 0 THEN
            RAISE NOTICE 'Migration 080: seeded % priorities into workspace %', v_inserted, v_ws;
        END IF;
    END LOOP;
END $$;

COMMIT;
