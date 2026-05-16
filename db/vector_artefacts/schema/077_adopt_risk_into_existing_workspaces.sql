-- ============================================================
-- MMFFDev - vector_artefacts: PLA-0052 Story 7
-- Migration 077 — backfill Risk into workspaces using the tenant-mirror pattern
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 077_adopt_risk_into_existing_workspaces.sql
--
-- The artefact-type substrate supports two patterns:
--   (a) system-only: scope='work' source='system' rows are used directly. The
--       dev subscription (…0001) uses this — no tenant work-rows exist.
--   (b) tenant-mirror: portfoliomodels.adopt_work_types copies system rows
--       into per-workspace source='tenant' rows on workspace provisioning.
--
-- For PLA-0052, the system Risk row (mig 071) covers pattern (a) — used by
-- the dev sub today. This migration backfills pattern (b): for every
-- workspace that has at least one source='tenant' work-row (proving it
-- adopted via the mirror pattern), insert a tenant Risk row that mirrors
-- the system Risk row from mig 071.
--
-- For today's data this is a no-op (no workspace currently uses the mirror
-- pattern for work-scope types — only strategy-scope). It establishes the
-- contract for future workspace provisioning + multi-tenant onboarding.
--
-- Depends on: mig 071 (system Risk row).
-- Idempotent via the live unique index uq_artefacts_types_workspace_scope_prefix.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_system_risk_id UUID;
    v_target RECORD;
    v_inserted INTEGER := 0;
BEGIN
    -- Resolve the system Risk row (the template we mirror).
    SELECT artefacts_types_id INTO v_system_risk_id
      FROM artefacts_types
     WHERE artefacts_types_prefix = 'RSK'
       AND artefacts_types_source = 'system'
       AND artefacts_types_archived_at IS NULL
       AND artefacts_types_id_subscription = '00000000-0000-0000-0000-000000000001'::uuid;

    IF v_system_risk_id IS NULL THEN
        RAISE EXCEPTION 'Migration 077: system Risk row not found. Apply mig 071 first.';
    END IF;

    -- Target: (subscription_id, workspace_id) pairs that have at least one
    -- existing source='tenant' work-scope artefact_type row AND don't yet
    -- have a Risk tenant row.
    FOR v_target IN
        SELECT DISTINCT
            at.artefacts_types_id_subscription AS sub_id,
            at.artefacts_types_id_workspace    AS ws_id
          FROM artefacts_types at
         WHERE at.artefacts_types_scope = 'work'
           AND at.artefacts_types_source = 'tenant'
           AND at.artefacts_types_archived_at IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM artefacts_types existing
                WHERE existing.artefacts_types_id_workspace = at.artefacts_types_id_workspace
                  AND existing.artefacts_types_prefix = 'RSK'
                  AND existing.artefacts_types_archived_at IS NULL
           )
    LOOP
        INSERT INTO artefacts_types (
            artefacts_types_id_subscription,
            artefacts_types_id_workspace,
            artefacts_types_scope,
            artefacts_types_source,
            artefacts_types_name,
            artefacts_types_prefix,
            artefacts_types_sort_order,
            artefacts_types_colour,
            artefacts_types_allows_children,
            artefacts_types_description
        )
        VALUES (
            v_target.sub_id,
            v_target.ws_id,
            'work',
            'tenant',
            'Risk',
            'RSK',
            25,
            '#dc2626',
            TRUE,
            'A risk to delivery, security, compliance, or operations. Tracked with severity × probability scoring and a mitigation lifecycle.'
        )
        ON CONFLICT (
            artefacts_types_id_workspace,
            artefacts_types_scope,
            artefacts_types_prefix
        ) WHERE artefacts_types_archived_at IS NULL
        DO NOTHING;

        v_inserted := v_inserted + 1;
    END LOOP;

    RAISE NOTICE 'Migration 077: inserted % tenant Risk rows across mirror-pattern workspaces', v_inserted;
END
$$;

COMMIT;
