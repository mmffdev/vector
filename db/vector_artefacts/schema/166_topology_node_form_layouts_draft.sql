-- ============================================================
-- 166_topology_node_form_layouts_draft.sql
--
-- Adds a draft channel to topology_node_form_layouts: a work-in-progress
-- layout an author can "Save as Draft" and resume later, WITHOUT it ever
-- being rendered live by the runtime.
--
-- WHY:
--   Form Layout Builder follow-up (Request F, 2026-05-30). The Cancel
--   button is too easy to fat-finger and lose work; the author needs a
--   "Save as Draft" path so a half-built layout survives a close. A draft
--   is NOT a version: it must not burn a version number, must not flip the
--   published is_current row, and must NEVER be picked up by the runtime
--   form-rendering path (GetCurrent / artefacts_id_form_layout). Otherwise
--   someone's half-built layout goes live.
--
--   Model: one published-current row (is_current=TRUE, is_draft=FALSE) and
--   at most one draft row (is_current=FALSE, is_draft=TRUE) coexist per
--   (node, type). The published row is what the runtime reads; the draft is
--   what the builder reloads on reopen. Publishing ("Save layout") mints the
--   version, flips current, and deletes the draft (it is superseded).
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS; CREATE UNIQUE INDEX IF NOT EXISTS. Re-running
--   is a no-op. The existing uq_topology_node_form_layouts_current index is
--   unaffected (drafts have is_current=FALSE, so they never collide with the
--   one-current-per-(node,type) guarantee).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/166_topology_node_form_layouts_draft_DOWN.sql
-- ============================================================

BEGIN;

-- A draft is WIP that the runtime must never read. Default FALSE so every
-- existing row stays a published version.
ALTER TABLE topology_node_form_layouts
    ADD COLUMN IF NOT EXISTS topology_node_form_layouts_is_draft
        BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one draft per (node, type). The draft save path upserts onto this
-- index (ON CONFLICT DO UPDATE), so re-saving a draft overwrites it rather
-- than accumulating rows. Disjoint from uq_..._current (that index is
-- WHERE is_current; this one is WHERE is_draft; a row is never both).
CREATE UNIQUE INDEX IF NOT EXISTS uq_topology_node_form_layouts_draft
    ON topology_node_form_layouts (
        topology_node_form_layouts_id_topology_node,
        topology_node_form_layouts_id_artefact_type
    )
    WHERE topology_node_form_layouts_is_draft;

COMMENT ON COLUMN topology_node_form_layouts.topology_node_form_layouts_is_draft IS
    'TRUE = work-in-progress draft (is_current is FALSE). The runtime form '
    'renderer NEVER reads drafts (GetCurrent filters is_draft=FALSE); only '
    'the builder reloads them. At most one draft per (node, type). Request F, '
    '2026-05-30.';

COMMIT;
