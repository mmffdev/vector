-- ============================================================
-- 165_topology_node_form_layouts.sql
--
-- Per-(topology node + artefact type) versioned form-layout config, plus
-- a snapshot-ref column on artefacts pointing at the exact layout version
-- an artefact was created under.
--
-- WHY:
--   Form Layout Builder (Vector's differentiator — see
--   docs/superpowers/specs/2026-05-30-form-layout-builder-design.md).
--   A team (topology node) drags out its own form layout for an artefact
--   type; the layout is saved as JSON and TRAVELS WITH the artefact when
--   work crosses node boundaries (origin-ref + graceful Carried-fields
--   merge). Versioning is what makes "the story keeps the layout it was
--   created with" possible: saving a new layout for an existing
--   (node, type) flips the prior row's is_current=false and inserts a new
--   version; in-flight artefacts keep pointing at their stamped version.
--
-- IDEMPOTENCY:
--   CREATE TABLE / INDEX IF NOT EXISTS; ADD COLUMN IF NOT EXISTS; the FK
--   constraint is guarded by a pg_constraint probe. Re-running is a no-op.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/165_topology_node_form_layouts_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. topology_node_form_layouts ────────────────────────────────
-- One CURRENT layout per (node, type); historical versions retained
-- (is_current=false) so a stamped artefacts_id_form_layout always
-- resolves to the exact shape it was created under.
CREATE TABLE IF NOT EXISTS topology_node_form_layouts (
    topology_node_form_layouts_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Composite key: a layout belongs to one node + one artefact type.
    topology_node_form_layouts_id_topology_node  UUID NOT NULL
        REFERENCES topology_nodes (topology_nodes_id) ON DELETE CASCADE,
    topology_node_form_layouts_id_artefact_type  UUID NOT NULL
        REFERENCES artefacts_types (artefacts_types_id) ON DELETE CASCADE,

    -- Denormalised workspace scope for the sentinel clamp predicate
    -- (avoids a join back through topology_nodes on every read).
    topology_node_form_layouts_id_workspace      UUID NOT NULL,

    -- Monotonic version per (node, type). v1 on first save, v+1 each save.
    topology_node_form_layouts_version           INTEGER NOT NULL DEFAULT 1,

    -- The row-based layout document. Shape:
    --   { version, artefactTypeId, rows:[{ id, template, cells:[{ id, fieldKey, span }] }] }
    -- template ∈ {100,50-50,30-70,70-30,30-30-30}; fieldKey = core string
    -- key OR 'custom:<artefacts_fields_library_id>'; null = empty cell.
    topology_node_form_layouts_layout_json       JSONB NOT NULL,

    -- Exactly one current layout per (node, type); old versions = false.
    topology_node_form_layouts_is_current        BOOLEAN NOT NULL DEFAULT TRUE,

    topology_node_form_layouts_created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    topology_node_form_layouts_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    topology_node_form_layouts_created_by         UUID
);

-- Enforce "one current layout per (node, type)".
CREATE UNIQUE INDEX IF NOT EXISTS uq_topology_node_form_layouts_current
    ON topology_node_form_layouts (
        topology_node_form_layouts_id_topology_node,
        topology_node_form_layouts_id_artefact_type
    )
    WHERE topology_node_form_layouts_is_current;

-- Version history lookup for a given (node, type).
CREATE INDEX IF NOT EXISTS idx_topology_node_form_layouts_node_type
    ON topology_node_form_layouts (
        topology_node_form_layouts_id_topology_node,
        topology_node_form_layouts_id_artefact_type
    );

-- Workspace-scoped clamp predicate.
CREATE INDEX IF NOT EXISTS idx_topology_node_form_layouts_workspace
    ON topology_node_form_layouts (topology_node_form_layouts_id_workspace);

-- Updated-at trigger (mirrors topology_nodes pattern).
CREATE OR REPLACE FUNCTION topology_node_form_layouts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.topology_node_form_layouts_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_topology_node_form_layouts_updated_at
    ON topology_node_form_layouts;
CREATE TRIGGER trg_topology_node_form_layouts_updated_at
    BEFORE UPDATE ON topology_node_form_layouts
    FOR EACH ROW EXECUTE FUNCTION topology_node_form_layouts_set_updated_at();

COMMENT ON TABLE topology_node_form_layouts IS
    'Per-(topology node + artefact type) versioned form-layout JSON '
    '(Form Layout Builder, 2026-05-30). is_current flags the live layout; '
    'old versions retained so artefacts_id_form_layout snapshot refs always '
    'resolve. layout_json is a row-based grid document. Sole writer: '
    'backend/internal/formlayouts.';

-- ── 2. artefacts snapshot ref ────────────────────────────────────
-- The exact layout version an artefact was created under. NULL = no
-- saved layout existed at create time → render the default form.
-- ON DELETE SET NULL: dropping a layout version degrades the artefact to
-- the default form rather than orphaning it.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_id_form_layout uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'artefacts_id_form_layout_fk'
    ) THEN
        ALTER TABLE artefacts
            ADD CONSTRAINT artefacts_id_form_layout_fk
                FOREIGN KEY (artefacts_id_form_layout)
                REFERENCES topology_node_form_layouts (topology_node_form_layouts_id)
                ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_artefacts_id_form_layout
    ON artefacts (artefacts_id_form_layout)
    WHERE artefacts_id_form_layout IS NOT NULL;

COMMIT;
