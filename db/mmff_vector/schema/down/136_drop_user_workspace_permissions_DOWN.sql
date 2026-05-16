-- ============================================================
-- MMFFDev - Vector: DOWN for 136 — recreate user_workspace_permissions
--
-- Rebuilds the table with its post-007 shape (FK to workspace, the
-- _uwp_* index names, the trg_uwp_updated_at trigger). Data is NOT
-- restored — this is structural rollback only.
-- ============================================================

BEGIN;

CREATE TABLE user_workspace_permissions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    can_view     BOOLEAN     NOT NULL DEFAULT FALSE,
    can_edit     BOOLEAN     NOT NULL DEFAULT FALSE,
    can_admin    BOOLEAN     NOT NULL DEFAULT FALSE,
    granted_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_workspace_permissions_user_id_workspace_id_key UNIQUE (user_id, workspace_id)
);

CREATE INDEX idx_uwp_user_id      ON user_workspace_permissions(user_id);
CREATE INDEX idx_uwp_workspace_id ON user_workspace_permissions(workspace_id);

CREATE TRIGGER trg_uwp_updated_at
    BEFORE UPDATE ON user_workspace_permissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
