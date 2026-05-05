-- 114_remove_portfolio_model_from_sidebar.sql
--
-- Removes the standalone `/portfolio-model` entry from the sidebar
-- nav registry. The page is now reached via the "Portfolio Model"
-- tab on /workspace-settings (gadmin-only).
--
-- The route itself still exists (for deep-links and the canvas
-- substrate) — only the sidebar surface is being relocated.
--
-- The DELETE on pages cascades to page_roles via the
-- page_roles_page_id_fkey ON DELETE CASCADE constraint.
--
-- Idempotent: bare DELETE is a no-op when the row is absent.

DELETE FROM pages WHERE key_enum = 'portfolio-model';
