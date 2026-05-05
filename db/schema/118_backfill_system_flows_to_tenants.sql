-- ============================================================
-- MMFFDev - Vector: Backfill o_flow_tenant from o_flow_system
--                   for every existing subscription
-- Migration 118 — applied on top of 117_flows_manage_permission.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 118_backfill_system_flows_to_tenants.sql
--
-- WHY ----------------------------------------------------------
-- o_flow_system holds the vendor default flows per system artefact
-- type (work_items / defects / tasks / test_cases / epics / strategic),
-- written by migrations 105/108/109/110. The runtime never reads
-- o_flow_system — it only reads o_flow_tenant.
--
-- The original plan was for "subscription provisioning" to copy
-- o_flow_system rows into o_flow_tenant on subscription create.
-- That hook was never wired, so existing tenants ended up with no
-- system flows in o_flow_tenant at all (the Work Items tab in
-- Workspace Settings showed System types as empty for them).
--
-- This migration is the one-shot backfill: for every existing
-- subscription, copy every o_flow_system row into o_flow_tenant
-- with the same target type, position, name, canonical_code, and
-- description. ON CONFLICT DO NOTHING means re-runs and partially-
-- seeded subscriptions are safe.
--
-- Subscription-create hook (going forward) is still TODO; this
-- migration only covers what already exists today.
-- ============================================================

BEGIN;

INSERT INTO o_flow_tenant
    (subscription_id, system_artefact_type_id, flow_position, name, canonical_code, description)
SELECT s.id, fs.system_artefact_type_id, fs.flow_position, fs.name, fs.canonical_code, fs.description
FROM   subscriptions   s
CROSS  JOIN o_flow_system fs
ON CONFLICT DO NOTHING;

COMMIT;
