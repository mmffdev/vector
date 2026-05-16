-- ============================================================
-- 098 — workspaces + workspace_roles: workspace tier above org_nodes (PLA-0006 / 00373)
--
-- A tenant (subscriptions row) can hold MULTIPLE workspaces;
-- each workspace owns its own org_nodes tree. Workspaces are
-- the top-level tenant container — clamp predicate, role
-- grants, and addressable scoping all narrow through here.
--
-- Sole writer: backend/internal/workspaces/service.go (story
-- 00376). Direct INSERT/UPDATE/DELETE from anywhere else is
-- forbidden — will be policed by ripgrep CI test.
--
-- Soft-archive via archived_at (NULL = live). Archive places
-- the workspace and its tree in limbo (mirrors org_nodes
-- archive semantics); FKs and grants stay intact for restore.
--
-- workspace_roles mirrors org_node_roles: same role set
-- (admin/editor/viewer), single-admin partial unique index,
-- can_redelegate ships unused for MVP, revoke audit fields.
--
-- The org_nodes.workspace_id FK + Default workspace backfill
-- live in migration 099 (story 00374), NOT here.
-- ============================================================

BEGIN;

CREATE TABLE workspaces (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,

    name                TEXT            NOT NULL CHECK (length(trim(name)) > 0),
    slug                TEXT            NOT NULL CHECK (
                                            length(trim(slug)) > 0
                                            AND slug ~ '^[a-z0-9][a-z0-9-]*$'
                                        ),
    description         TEXT,

    created_by          UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    archived_at         TIMESTAMPTZ,
    archived_by         UUID            REFERENCES users(id) ON DELETE RESTRICT,

    -- Archive must record who did it: both NULL or both set.
    CONSTRAINT workspaces_archived_pair CHECK (
        (archived_at IS NULL AND archived_by IS NULL)
        OR (archived_at IS NOT NULL AND archived_by IS NOT NULL)
    )
);

-- Slug uniqueness only among LIVE workspaces in a subscription.
-- Archived workspaces release their slug for re-use.
CREATE UNIQUE INDEX workspaces_subscription_slug_live
    ON workspaces (subscription_id, slug)
    WHERE archived_at IS NULL;

-- Hot-path lookup: list workspaces for a tenant.
CREATE INDEX workspaces_subscription_idx
    ON workspaces (subscription_id);

CREATE TRIGGER trg_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE workspaces IS
    'Workspace tier above org_nodes (PLA-0006). A subscription holds 1..N workspaces; each workspace owns its own org_nodes tree. Sole writer: backend/internal/workspaces. archived_at = limbo; slug is unique only among live rows.';


CREATE TABLE workspace_roles (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID            NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    workspace_id    UUID            NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    role            TEXT            NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    can_redelegate  BOOLEAN         NOT NULL DEFAULT FALSE,

    granted_by      UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    granted_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID            REFERENCES users(id) ON DELETE RESTRICT,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- A revoke must record who revoked it.
    CONSTRAINT workspace_roles_revoked_pair CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    )
);

-- One active grant per (workspace, user). A user can be re-granted
-- after revocation; previous (revoked) rows are kept for audit.
CREATE UNIQUE INDEX workspace_roles_active_user
    ON workspace_roles (workspace_id, user_id)
    WHERE revoked_at IS NULL;

-- MVP-only constraint: at most one active admin per workspace.
-- Drop this index to enable multi-admin in Phase X.
CREATE UNIQUE INDEX workspace_roles_single_admin
    ON workspace_roles (workspace_id)
    WHERE role = 'admin' AND revoked_at IS NULL;

-- Hot-path: "which workspaces does user_id touch" for clamp.
CREATE INDEX workspace_roles_user_idx
    ON workspace_roles (user_id)
    WHERE revoked_at IS NULL;

CREATE TRIGGER trg_workspace_roles_updated_at
    BEFORE UPDATE ON workspace_roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE workspace_roles IS
    'Workspace-scoped role grants (PLA-0006). Mirrors org_node_roles at the workspace tier. revoked_at IS NULL = active. MVP single-admin constraint enforced via partial unique index workspace_roles_single_admin — drop to enable multi-admin in Phase X. can_redelegate ships from day one but MVP UI does not expose it.';

COMMIT;
