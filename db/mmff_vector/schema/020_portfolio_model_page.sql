-- ============================================================
-- MMFFDev - Vector: Register /portfolio-model nav entry
-- Migration 020 — applied on top of 019_pending_library_cleanup_jobs.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 020_portfolio_model_page.sql
--
-- Phase 2 of the mmff_library adoption plan: a read-only Settings
-- preview that renders the seeded MMFF portfolio model bundle. Lives
-- in the admin_settings group alongside Workspace / Portfolio / Account.
-- Gated to padmin + gadmin (matches portfolio-settings).
-- ============================================================

BEGIN;

-- Use the system-scoped partial unique index from migration 012
-- (renamed in migration 017 alongside tenant_id -> subscription_id):
--   pages_unique_key_system ON (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL
INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind, pinnable, default_pinned, default_order)
VALUES
    ('portfolio-model', 'Portfolio Model', '/portfolio-model', 'package', 'admin_settings', 'static', TRUE, TRUE, 2)
ON CONFLICT (key_enum) WHERE created_by IS NULL AND subscription_id IS NULL DO NOTHING;

INSERT INTO page_roles (page_id, role)
SELECT id, r::user_role
FROM pages, UNNEST(ARRAY['padmin', 'gadmin']) AS r
WHERE key_enum = 'portfolio-model' AND subscription_id IS NULL AND created_by IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
