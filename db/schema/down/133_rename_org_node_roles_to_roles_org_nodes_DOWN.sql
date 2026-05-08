-- DOWN for db/schema/133_rename_org_node_roles_to_roles_org_nodes.sql
-- Reverses everything in inverse order.

BEGIN;

ALTER TRIGGER trg_roles_org_nodes_updated_at ON roles_org_nodes
    RENAME TO trg_org_node_roles_updated_at;

ALTER TABLE roles_org_nodes
    RENAME CONSTRAINT roles_org_nodes_role_check
    TO org_node_roles_role_check;

ALTER TABLE roles_org_nodes
    RENAME CONSTRAINT roles_org_nodes_revoked_pair
    TO org_node_roles_revoked_pair;

ALTER INDEX idx_roles_org_nodes_node
    RENAME TO idx_org_node_roles_node;
ALTER INDEX idx_roles_org_nodes_user
    RENAME TO idx_org_node_roles_user;
ALTER INDEX roles_org_nodes_single_admin_mvp
    RENAME TO org_node_roles_single_admin_mvp;
ALTER INDEX roles_org_nodes_active_unique
    RENAME TO org_node_roles_active_unique;
ALTER INDEX roles_org_nodes_pkey
    RENAME TO org_node_roles_pkey;

ALTER TABLE roles_org_nodes RENAME TO org_node_roles;

COMMIT;
