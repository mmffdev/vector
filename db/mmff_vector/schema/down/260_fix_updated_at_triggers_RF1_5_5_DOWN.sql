-- ============================================================
-- DOWN: 260_fix_updated_at_triggers_RF1_5_5_DOWN.sql
--
-- Reverts wave-4 trigger-function repair. Restores each trigger
-- binding to the shared set_updated_at() function and drops the
-- per-table functions. Use only if you've also reverted 257–259.
-- ============================================================

BEGIN;

-- users_custom_page_views: restore trigger to shared set_updated_at()
DROP TRIGGER IF EXISTS trg_users_custom_page_views_updated_at ON users_custom_page_views;
CREATE TRIGGER trg_user_custom_page_views_updated_at
    BEFORE UPDATE ON users_custom_page_views
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS users_custom_page_views_set_updated_at();

-- users_custom_pages: restore trigger to shared set_updated_at()
DROP TRIGGER IF EXISTS trg_users_custom_pages_updated_at ON users_custom_pages;
CREATE TRIGGER trg_user_custom_pages_updated_at
    BEFORE UPDATE ON users_custom_pages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS users_custom_pages_set_updated_at();

-- master_record_workspaces: restore trigger to shared set_updated_at()
DROP TRIGGER IF EXISTS trg_master_record_workspaces_updated_at ON master_record_workspaces;
CREATE TRIGGER trg_master_record_workspaces_updated_at
    BEFORE UPDATE ON master_record_workspaces
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS master_record_workspaces_set_updated_at();

COMMIT;
