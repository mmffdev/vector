-- ============================================================
-- 243 — Sentinel user columns: per-user focus + scope defaults
--       (PLA062 S06 — Sentinel single-source-of-truth clamp)
--
-- Adds three columns to `users` so Sentinel can persist the user's
-- preferred topology focus + their default scope direction:
--
--   default_focus_node_id        uuid NULL
--       The user's persisted focus node. Resolution precedence in
--       sentinel.Middleware: URL ?focus= > this column > tenant root.
--       Nullable — every existing user backfills to NULL (= "no
--       preference set, fall through to tenant root").
--
--   sentinel_scope_up_default    bool NOT NULL DEFAULT true
--       Default value of the `scope_up` query param when the user
--       makes a request without one. true (Rally idiom) = include
--       ancestors of the focus node.
--
--   sentinel_scope_down_default  bool NOT NULL DEFAULT true
--       Default value of the `scope_down` query param when absent.
--       true (Rally idiom) = include descendants of the focus node.
--
-- After this migration lands, sentinel.PoolResolver.DefaultFocus can
-- read the column directly — the prepared sqlUserDefaultFocus query
-- in backend/internal/sentinel/sql.go is already wired up; the body
-- of DefaultFocus in resolver.go has a one-line uncomment pending
-- this migration (see TD-SEN-01 resolution note in sentinel_tech_debt.md).
--
-- The two scope-default columns are not yet read anywhere — they
-- exist so the future scope-picker UI (S08+) can persist a user's
-- preference. Middleware currently defaults both to true at request
-- time per Rally idiom; per-user override lands when a frontend
-- preference panel ships.
--
-- Idempotent via IF NOT EXISTS — safe to re-run.
--
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 243_sentinel_user_columns.sql
-- Down: db/mmff_vector/schema/down/243_sentinel_user_columns_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS default_focus_node_id uuid;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sentinel_scope_up_default boolean NOT NULL DEFAULT true;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sentinel_scope_down_default boolean NOT NULL DEFAULT true;

-- No FK constraint on default_focus_node_id: topology_nodes lives in
-- the vector_artefacts database (vaPool), not mmff_vector (pool).
-- Cross-DB FK is not enforceable at the SQL layer; sentinel.Middleware
-- already validates the focus belongs to the user's tenant before
-- using it (ErrFocusNotInTenant), so a stale UUID here surfaces as a
-- 403 + the resolver falls through to tenant root on the next request.

-- Index for the by-id lookup the resolver runs on every authenticated
-- request that doesn't carry a ?focus= param. Partial index keyed on
-- is_active = TRUE so dropped accounts don't bloat the index.
CREATE INDEX IF NOT EXISTS users_default_focus_node_id_idx
    ON users (id, default_focus_node_id)
    WHERE is_active = TRUE;

-- schema_migrations row is inserted by the migrator runner
-- (backend/cmd/migrate/main.go:292) — do NOT INSERT it here.

COMMIT;
