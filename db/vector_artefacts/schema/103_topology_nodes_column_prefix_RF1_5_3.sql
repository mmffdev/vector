-- ============================================================
-- 103_topology_nodes_column_prefix_RF1_5_3.sql
--
-- RF1.5.3 — Pillar 1 wave 3, table 5/5.
--
-- Applies the §2.3 column-prefix convention to topology_nodes — the
-- PLA-0006 federated-canvas substrate table. PK `id` becomes
-- `topology_nodes_id`. FK-shaped columns:
--   workspace_id    → topology_nodes_id_workspace
--     (app-soft — workspaces lives in mmff_vector)
--   subscription_id → topology_nodes_id_subscription
--     (app-soft — subscriptions lives in mmff_vector)
--   parent_id       → topology_nodes_id_parent
--     (self-FK — uses role suffix `_parent` per §2.4 and the wave-1
--     cost_centres precedent in migration 251)
--
-- INBOUND FKs (auto-retarget by Postgres on PK column rename — FKs
-- track column oid, not name):
--   1. topology_nodes.parent_id → topology_nodes(id) [self-FK]
--   2. artefacts.topology_node_id → topology_nodes(id) ON DELETE SET NULL
--   3. users_roles_topology_nodes.users_roles_topology_nodes_id_topology_node
--      → topology_nodes(id) ON DELETE RESTRICT
-- Inbound FK *column names* (artefacts.topology_node_id in particular)
-- stay bare here — artefacts is a different wave's table.
--
-- Trigger `trg_topology_nodes_updated_at` calls the bespoke function
-- `topology_nodes_set_updated_at()` which still references
-- `NEW.updated_at` post-rename — same caveat as wave-1's
-- cost_centres / set_updated_at situation. Trigger function body
-- sweep tracked separately.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE topology_nodes RENAME COLUMN id                TO topology_nodes_id;
ALTER TABLE topology_nodes RENAME COLUMN workspace_id      TO topology_nodes_id_workspace;
ALTER TABLE topology_nodes RENAME COLUMN subscription_id   TO topology_nodes_id_subscription;
ALTER TABLE topology_nodes RENAME COLUMN parent_id         TO topology_nodes_id_parent;
ALTER TABLE topology_nodes RENAME COLUMN name              TO topology_nodes_name;
ALTER TABLE topology_nodes RENAME COLUMN description       TO topology_nodes_description;
ALTER TABLE topology_nodes RENAME COLUMN label_override    TO topology_nodes_label_override;
ALTER TABLE topology_nodes RENAME COLUMN icon              TO topology_nodes_icon;
ALTER TABLE topology_nodes RENAME COLUMN colour            TO topology_nodes_colour;
ALTER TABLE topology_nodes RENAME COLUMN avatar_url        TO topology_nodes_avatar_url;
ALTER TABLE topology_nodes RENAME COLUMN layout_mode       TO topology_nodes_layout_mode;
ALTER TABLE topology_nodes RENAME COLUMN x                 TO topology_nodes_x;
ALTER TABLE topology_nodes RENAME COLUMN y                 TO topology_nodes_y;
ALTER TABLE topology_nodes RENAME COLUMN width             TO topology_nodes_width;
ALTER TABLE topology_nodes RENAME COLUMN height            TO topology_nodes_height;
ALTER TABLE topology_nodes RENAME COLUMN collapsed_default TO topology_nodes_collapsed_default;
ALTER TABLE topology_nodes RENAME COLUMN sort_order        TO topology_nodes_sort_order;
ALTER TABLE topology_nodes RENAME COLUMN archived_at       TO topology_nodes_archived_at;
ALTER TABLE topology_nodes RENAME COLUMN created_at        TO topology_nodes_created_at;
ALTER TABLE topology_nodes RENAME COLUMN updated_at        TO topology_nodes_updated_at;

-- ---- Index renames ----

-- topology_nodes_pkey already matches the <table>_pkey convention.

ALTER INDEX idx_topology_nodes_sibling_order
    RENAME TO idx_topology_nodes_id_workspace_id_parent_sort_order;

ALTER INDEX idx_topology_nodes_workspace
    RENAME TO idx_topology_nodes_id_workspace;

ALTER INDEX idx_topology_nodes_workspace_parent
    RENAME TO idx_topology_nodes_id_workspace_id_parent;

-- ---- Constraint renames ----

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_colour_check
                  TO topology_nodes_colour_chk;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_layout_mode_check
                  TO topology_nodes_layout_mode_chk;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_manual_xy_pair
                  TO topology_nodes_manual_xy_pair_chk;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_name_check
                  TO topology_nodes_name_chk;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_parent_id_fkey
                  TO topology_nodes_id_parent_fkey;

COMMIT;
