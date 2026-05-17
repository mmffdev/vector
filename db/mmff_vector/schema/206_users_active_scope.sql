-- ============================================================
-- 206 — users.active_scope_node_id
--
-- Persists the user's last-selected scope node so it is restored
-- on next login. NULL means no scope selected (first-time user
-- or scope was explicitly cleared). The FK is intentionally
-- deferrable — if a topology node is deleted, the column is
-- nulled by the ON DELETE SET NULL action rather than blocking
-- the delete.
-- ============================================================

-- No FK — topology_nodes lives in vector_artefacts (separate DB).
-- Validity is enforced at the application layer: on login, the stored
-- node ID is checked against the user's live grants; stale values are
-- cleared then.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS active_scope_node_id UUID;

CREATE INDEX IF NOT EXISTS idx_users_active_scope_node_id
    ON users(active_scope_node_id)
    WHERE active_scope_node_id IS NOT NULL;
