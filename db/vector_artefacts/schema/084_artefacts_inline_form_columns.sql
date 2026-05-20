-- ============================================================
-- 084_artefacts_inline_form_columns.sql
--
-- Promote `colour`, `is_blocked`, `blocked_reason` from custom-field
-- bindings to first-class columns on artefacts. Adds the forward-ref
-- column for the milestone FK (the timebox_milestones table arrives
-- in 085; the FK constraint is added there).
--
-- WHY:
--   The new ArtefactInlineForm (inline expand on badge click) needs
--   to read+write these per artefact without per-type field-library
--   bindings. story_points already exists (migration 012); sprint_id
--   already exists as timebox_sprint_id (025); release_id as
--   timebox_release_id (026); topology_node_id (046).
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS on every column. Re-runnable.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/084_artefacts_inline_form_columns_DOWN.sql
-- ============================================================

BEGIN;

-- Per-artefact colour override. NULL = inherit from artefact_types.colour.
-- Same hex-format check as artefact_types.colour (migration 040).
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS colour TEXT;

ALTER TABLE artefacts
    DROP CONSTRAINT IF EXISTS artefacts_colour_hex_format;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_colour_hex_format
        CHECK (colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$');

COMMENT ON COLUMN artefacts.colour IS
    'Per-artefact colour override (CSS hex #RRGGBB). NULL = inherit from artefact_types.colour.';

-- Blocked state. is_blocked is the source of truth; blocked_reason is
-- free-text explaining why. The two are independent (clearing the
-- reason while still blocked is allowed) but the UI treats them as
-- a single concept.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS is_blocked     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

COMMENT ON COLUMN artefacts.is_blocked IS
    'Whether the artefact is blocked. Independent of flow_state.';

COMMENT ON COLUMN artefacts.blocked_reason IS
    'Free-text reason for the block. Surfaced only when is_blocked is true.';

-- Forward-ref column for the milestone FK. The FK constraint is added
-- in migration 085 once timebox_milestones exists. Until then the
-- column accepts any UUID; the writer-side service is responsible for
-- validating against the milestone table.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS timebox_milestone_id UUID;

COMMENT ON COLUMN artefacts.timebox_milestone_id IS
    'FK to timebox_milestones (constraint added in migration 085). Nullable; ON DELETE SET NULL.';

-- Hot-path indexes -----------------------------------------------------------

CREATE INDEX IF NOT EXISTS artefacts_blocked
    ON artefacts (subscription_id)
    WHERE is_blocked = true AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS artefacts_timebox_milestone
    ON artefacts (timebox_milestone_id)
    WHERE archived_at IS NULL AND timebox_milestone_id IS NOT NULL;

COMMIT;
