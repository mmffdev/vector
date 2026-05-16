-- RF1.4.2.topology — pluralise view_state, rename role-grants table to
-- users_roles_topology_nodes per §2.8 (legacy mmff_vector roles_org_nodes
-- is a separate drop; this commit only renames the canonical VA table).
BEGIN;

-- ── 1. topology_view_state → topology_view_states ────────────────
ALTER TABLE topology_view_state RENAME TO topology_view_states;
ALTER TABLE topology_view_states RENAME COLUMN id              TO topology_view_states_id;
ALTER TABLE topology_view_states RENAME COLUMN workspace_id    TO topology_view_states_id_workspace;
ALTER TABLE topology_view_states RENAME COLUMN subscription_id TO topology_view_states_id_subscription;
ALTER TABLE topology_view_states RENAME COLUMN user_id         TO topology_view_states_id_user;
ALTER TABLE topology_view_states RENAME COLUMN viewport_x      TO topology_view_states_viewport_x;
ALTER TABLE topology_view_states RENAME COLUMN viewport_y      TO topology_view_states_viewport_y;
ALTER TABLE topology_view_states RENAME COLUMN viewport_zoom   TO topology_view_states_viewport_zoom;
ALTER TABLE topology_view_states RENAME COLUMN updated_at      TO topology_view_states_updated_at;

ALTER INDEX idx_topology_view_state_workspace_user RENAME TO topology_view_states_id_workspace_id_user_idx;

ALTER TABLE topology_view_states RENAME CONSTRAINT topology_view_state_workspace_user_unique
                                                TO topology_view_states_id_workspace_id_user_key;

DROP TRIGGER IF EXISTS trg_topology_view_state_updated_at ON topology_view_states;
CREATE OR REPLACE FUNCTION topology_view_states_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.topology_view_states_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP FUNCTION IF EXISTS topology_view_state_set_updated_at();
CREATE TRIGGER trg_topology_view_states_updated_at
    BEFORE UPDATE ON topology_view_states
    FOR EACH ROW EXECUTE FUNCTION topology_view_states_set_updated_at();

-- ── 2. topology_role_grants → users_roles_topology_nodes ────────
ALTER TABLE topology_role_grants RENAME TO users_roles_topology_nodes;

ALTER TABLE users_roles_topology_nodes RENAME COLUMN id               TO users_roles_topology_nodes_id;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN workspace_id     TO users_roles_topology_nodes_id_workspace;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN subscription_id  TO users_roles_topology_nodes_id_subscription;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN node_id          TO users_roles_topology_nodes_id_topology_node;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN user_id          TO users_roles_topology_nodes_id_user;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN role_code        TO users_roles_topology_nodes_role_code;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN role_id          TO users_roles_topology_nodes_id_role;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN can_redelegate   TO users_roles_topology_nodes_can_redelegate;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN granted_by       TO users_roles_topology_nodes_id_user_granter;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN granted_at       TO users_roles_topology_nodes_granted_at;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN revoked_at       TO users_roles_topology_nodes_revoked_at;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN revoked_by       TO users_roles_topology_nodes_id_user_revoker;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN created_at       TO users_roles_topology_nodes_created_at;
ALTER TABLE users_roles_topology_nodes RENAME COLUMN updated_at       TO users_roles_topology_nodes_updated_at;

ALTER INDEX topology_role_grants_active_unique       RENAME TO users_roles_topology_nodes_active_unique;
ALTER INDEX topology_role_grants_single_admin_mvp    RENAME TO users_roles_topology_nodes_single_admin_mvp;
ALTER INDEX idx_topology_role_grants_user            RENAME TO users_roles_topology_nodes_id_workspace_id_user_idx;
ALTER INDEX idx_topology_role_grants_node            RENAME TO users_roles_topology_nodes_id_topology_node_idx;

ALTER TABLE users_roles_topology_nodes RENAME CONSTRAINT topology_role_grants_revoked_pair
                                                      TO users_roles_topology_nodes_revoked_pair;

-- Rename role_code CHECK + the node FK constraint.
DO $$
DECLARE
    rc_check text;
    node_fk  text;
BEGIN
    SELECT conname INTO rc_check FROM pg_constraint
        WHERE conrelid='users_roles_topology_nodes'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%users_roles_topology_nodes_role_code%';
    SELECT conname INTO node_fk FROM pg_constraint
        WHERE conrelid='users_roles_topology_nodes'::regclass AND contype='f';
    IF rc_check IS NOT NULL THEN EXECUTE format('ALTER TABLE users_roles_topology_nodes RENAME CONSTRAINT %I TO users_roles_topology_nodes_role_code_check', rc_check); END IF;
    IF node_fk IS NOT NULL THEN EXECUTE format('ALTER TABLE users_roles_topology_nodes RENAME CONSTRAINT %I TO users_roles_topology_nodes_id_topology_node_fkey', node_fk); END IF;
END $$;

DROP TRIGGER IF EXISTS trg_topology_role_grants_updated_at ON users_roles_topology_nodes;
CREATE OR REPLACE FUNCTION users_roles_topology_nodes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.users_roles_topology_nodes_updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP FUNCTION IF EXISTS topology_role_grants_set_updated_at();
CREATE TRIGGER trg_users_roles_topology_nodes_updated_at
    BEFORE UPDATE ON users_roles_topology_nodes
    FOR EACH ROW EXECUTE FUNCTION users_roles_topology_nodes_set_updated_at();

COMMIT;
