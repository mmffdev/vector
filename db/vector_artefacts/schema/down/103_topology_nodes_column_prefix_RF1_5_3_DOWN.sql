-- ============================================================
-- 103_topology_nodes_column_prefix_RF1_5_3_DOWN.sql
--
-- Reverses 103_topology_nodes_column_prefix_RF1_5_3.sql.
-- ============================================================

BEGIN;

-- ---- Constraint renames (reverse) ----

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_id_parent_fkey
                  TO topology_nodes_parent_id_fkey;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_name_chk
                  TO topology_nodes_name_check;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_manual_xy_pair_chk
                  TO topology_nodes_manual_xy_pair;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_layout_mode_chk
                  TO topology_nodes_layout_mode_check;

ALTER TABLE topology_nodes
    RENAME CONSTRAINT topology_nodes_colour_chk
                  TO topology_nodes_colour_check;

-- ---- Index renames (reverse) ----

ALTER INDEX idx_topology_nodes_id_workspace_id_parent
    RENAME TO idx_topology_nodes_workspace_parent;

ALTER INDEX idx_topology_nodes_id_workspace
    RENAME TO idx_topology_nodes_workspace;

ALTER INDEX idx_topology_nodes_id_workspace_id_parent_sort_order
    RENAME TO idx_topology_nodes_sibling_order;

-- ---- Column renames (reverse) ----

ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_updated_at         TO updated_at;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_created_at         TO created_at;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_archived_at        TO archived_at;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_sort_order         TO sort_order;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_collapsed_default  TO collapsed_default;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_height             TO height;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_width              TO width;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_y                  TO y;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_x                  TO x;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_layout_mode        TO layout_mode;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_avatar_url         TO avatar_url;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_colour             TO colour;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_icon               TO icon;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_label_override     TO label_override;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_description        TO description;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_name               TO name;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_id_parent          TO parent_id;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_id_subscription    TO subscription_id;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_id_workspace       TO workspace_id;
ALTER TABLE topology_nodes RENAME COLUMN topology_nodes_id                 TO id;

COMMIT;
