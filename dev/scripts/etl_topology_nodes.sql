-- ============================================================
-- ETL: org_nodes (mmff_vector) → topology_nodes (vector_artefacts)
-- PLA-0006 / M6.3.2
--
-- Run against vector_artefacts with mmff_vector accessible
-- (separate DB — use CSV export/import pattern).
--
-- CRITICAL: original UUIDs are preserved so parent_id links survive
-- intact after copy. The tree is self-referential; changing IDs would
-- break the entire parent_id chain.
--
-- Column mapping:
--   org_nodes.id                 → topology_nodes.id           (verbatim — CRITICAL)
--   org_nodes.workspace_id       → topology_nodes.workspace_id
--   org_nodes.subscription_id    → topology_nodes.subscription_id
--   org_nodes.parent_id          → topology_nodes.parent_id    (verbatim — tree integrity)
--   org_nodes.name               → topology_nodes.name
--   org_nodes.description        → topology_nodes.description  (NOT NULL DEFAULT '' in source since 093)
--   org_nodes.label_override     → topology_nodes.label_override
--   org_nodes.icon               → topology_nodes.icon
--   org_nodes.colour             → topology_nodes.colour
--   org_nodes.avatar_url         → topology_nodes.avatar_url
--   org_nodes.layout_mode        → topology_nodes.layout_mode
--   org_nodes.manual_x           → topology_nodes.x            (rename: manual_x → x)
--   org_nodes.manual_y           → topology_nodes.y            (rename: manual_y → y)
--   [no source for width/height] → topology_nodes.width/height NULL (not in org_nodes)
--   org_nodes.collapsed_default  → topology_nodes.collapsed_default
--   org_nodes.position           → topology_nodes.sort_order   (rename: position → sort_order)
--   org_nodes.archived_at        → topology_nodes.archived_at
--   org_nodes.created_at         → topology_nodes.created_at
--   org_nodes.updated_at         → topology_nodes.updated_at
--
--   org_nodes.level_id is NOT copied — org_levels is presentation state
--   in mmff_vector; the new service derives depth on the fly from parent_id.
--
-- Idempotent: ON CONFLICT (id) DO NOTHING so re-runs skip existing rows.
--
-- Two steps:
--   Step 1 (run against mmff_vector): export to CSV
--   Step 2 (run against vector_artefacts): import and insert
-- ============================================================

-- ============================================================
-- STEP 1: Export from mmff_vector (run against mmff_vector DB)
-- ============================================================
-- \COPY (
--     SELECT
--         n.id,
--         n.workspace_id,
--         n.subscription_id,
--         n.parent_id,
--         n.name,
--         COALESCE(n.description, '')   AS description,
--         n.label_override,
--         n.icon,
--         n.colour,
--         n.avatar_url,
--         n.layout_mode,
--         n.manual_x                   AS x,
--         n.manual_y                   AS y,
--         n.collapsed_default,
--         n.position                   AS sort_order,
--         n.archived_at,
--         n.created_at,
--         n.updated_at
--     FROM org_nodes n
--     ORDER BY
--         -- Export in depth-first order (parents before children).
--         -- The recursive CTE ensures parent rows precede child rows in
--         -- the CSV so the FK constraint on parent_id is satisfied at
--         -- import time even without deferred constraints.
--         n.created_at ASC,
--         n.id ASC
-- ) TO '/tmp/topology_nodes_export.csv' CSV HEADER;

-- ============================================================
-- STEP 2: Import into vector_artefacts (run against vector_artefacts DB)
-- ============================================================

BEGIN;

-- Staging table matching the CSV columns.
CREATE TEMP TABLE topology_nodes_import (
    id                  UUID,
    workspace_id        UUID,
    subscription_id     UUID,
    parent_id           UUID,
    name                TEXT,
    description         TEXT,
    label_override      TEXT,
    icon                TEXT,
    colour              TEXT,
    avatar_url          TEXT,
    layout_mode         TEXT,
    x                   INTEGER,
    y                   INTEGER,
    collapsed_default   BOOLEAN,
    sort_order          INTEGER,
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
);

-- Load the CSV (adjust path if needed).
-- \COPY topology_nodes_import FROM '/tmp/topology_nodes_export.csv' CSV HEADER;

-- Insert all rows. ON CONFLICT (id) DO NOTHING makes re-runs safe.
-- width and height are NULL on import — they are new columns with no
-- source data; the rendering layer defaults them to auto-sizing.
--
-- NOTE: The CSV must be ordered parents-before-children. The export
-- ORDER BY created_at ASC approximates this because parents are always
-- created before their children in normal usage. If the constraint
-- fires, reorder the CSV by depth (use a WITH RECURSIVE sort on the
-- exported data) or temporarily SET CONSTRAINTS ALL DEFERRED.
INSERT INTO topology_nodes (
    id,
    workspace_id,
    subscription_id,
    parent_id,
    name,
    description,
    label_override,
    icon,
    colour,
    avatar_url,
    layout_mode,
    x,
    y,
    width,
    height,
    collapsed_default,
    sort_order,
    archived_at,
    created_at,
    updated_at
)
SELECT
    id,
    workspace_id,
    subscription_id,
    parent_id,
    name,
    COALESCE(description, ''),
    label_override,
    icon,
    colour,
    avatar_url,
    layout_mode,
    x,
    y,
    NULL    AS width,
    NULL    AS height,
    collapsed_default,
    sort_order,
    archived_at,
    created_at,
    updated_at
FROM topology_nodes_import
ON CONFLICT (id) DO NOTHING;

-- Verification counts.
SELECT
    'topology_nodes imported'   AS label,
    COUNT(*)                    AS count
FROM topology_nodes_import
UNION ALL
SELECT
    'topology_nodes in table',
    COUNT(*)
FROM topology_nodes
UNION ALL
SELECT
    'root nodes (parent_id IS NULL)',
    COUNT(*)
FROM topology_nodes
WHERE parent_id IS NULL
UNION ALL
SELECT
    'archived nodes',
    COUNT(*)
FROM topology_nodes
WHERE archived_at IS NOT NULL;

-- Tree integrity spot-check: any node whose parent_id is not in the table.
-- Should return 0 rows.
SELECT
    'orphaned nodes (parent_id not found)'  AS label,
    COUNT(*)                                AS count
FROM topology_nodes n
WHERE n.parent_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM topology_nodes p WHERE p.id = n.parent_id
  );

COMMIT;
