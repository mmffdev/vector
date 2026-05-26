-- ============================================================
-- 119_p3_drop_fdw_mmff_vector.sql
--
-- Pillar 3 step 2 — drop the 16 fdw_* foreign tables in
-- vector_artefacts that mirror mmff_vector tables, plus the
-- fdw_mmff_vector server + its user mapping.
--
-- After Pillar 2, every former-mmff_v table lives natively in
-- vector_artefacts. After Pillar 3 step 1 (commit bfd96136), the
-- backend repointed pool→vaPool, so no Go code SQL touches these
-- foreign tables anymore. Comments mentioning fdw_workspaces in
-- the workspacemasterrecord package are stale doc only.
--
-- KEEP: fdw_mmff_library + its user mapping. The shared library
-- spine still lives in mmff_library and we still cross-DB-read it.
--
-- Symmetric DOWN restores the 16 foreign tables but uses bare-column
-- shapes from the pre-Pillar-1 era — DOWN is best-effort because the
-- mmff_vector source columns will be gone after the Pillar 3 step 3
-- DROP DATABASE. This migration is effectively one-way once step 3
-- ships; DOWN is provided for safety until then.
-- ============================================================

BEGIN;

-- ---- Drop the 16 foreign tables ----
DROP FOREIGN TABLE IF EXISTS public.fdw_defects;
DROP FOREIGN TABLE IF EXISTS public.fdw_master_record_tenant;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_execution_types;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_execution_types_tenant;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_flow_tenant;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_flow_tenant_full;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_strategy_types;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_strategy_types_layers;
DROP FOREIGN TABLE IF EXISTS public.fdw_obj_work_items;
DROP FOREIGN TABLE IF EXISTS public.fdw_org_nodes;
DROP FOREIGN TABLE IF EXISTS public.fdw_portfolio_items;
DROP FOREIGN TABLE IF EXISTS public.fdw_portfolio_templates;
DROP FOREIGN TABLE IF EXISTS public.fdw_roles_org_nodes;
DROP FOREIGN TABLE IF EXISTS public.fdw_subscriptions;
DROP FOREIGN TABLE IF EXISTS public.fdw_user_stories;
DROP FOREIGN TABLE IF EXISTS public.fdw_workspaces;

-- ---- Drop the user mapping for fdw_mmff_vector ----
DROP USER MAPPING IF EXISTS FOR mmff_dev SERVER fdw_mmff_vector;

-- ---- Drop the server (CASCADE protects nothing — the foreign
--      tables above are all gone, and no other objects depend on it) ----
DROP SERVER IF EXISTS fdw_mmff_vector;

-- ---- DO NOT DROP EXTENSION postgres_fdw ----
-- fdw_mmff_library still uses it. Leave the extension in place.

COMMIT;
