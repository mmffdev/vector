-- ============================================================
-- MMFFDev - vector_artefacts: helpers + reconciler for label-unique field library
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 039_seed_field_library_label_helpers.sql
--
-- Background:
--   Migration 038 added a partial unique index on
--     artefact_field_library (subscription_id, label, field_type)
--     WHERE archived_at IS NULL AND scope = 'tenant'
--   meaning a given label+type can only have one live tenant row per
--   subscription. Existing seeds 027/030/034 each insert their own
--   type-prefixed rows (blocked / pi_blocked / us_blocked) with identical
--   labels — on a *fresh* DB, the first seed wins, and the second+third
--   seeds' INSERTs no-op against the new index, leaving their bindings
--   broken because they look up by their own slug.
--
-- This migration:
--
--   1. Reconciles existing bindings — for any artefact_type that *should*
--      bind a given (label, field_type) but currently has no binding
--      because its expected slug (pi_*, us_*) was suppressed at insert
--      time, bind the live canonical row instead. Idempotent (ON CONFLICT
--      DO NOTHING).
--
--   2. Defines a SQL function `bind_field_by_label(...)` that future seeds
--      (or app-side provisioning) can call to bind by (label, field_type)
--      without caring which slug carries the canonical row. Existing seeds
--      do not yet use it; they will be migrated lazily as each is touched.
--
-- Out of scope:
--   - Deleting the orphan pi_*/us_* slug seeds. Those rows were archived
--     by migration 038 already; removing the seed code would break
--     historical replay. They stay as-is and the new index keeps them
--     archived.
--   - Renaming the surviving slug. Cosmetic; no consumer cares.
-- ============================================================

BEGIN;

-- ── 1. Reconcile bindings against canonical rows ─────────────────────────────
-- For each artefact_type that the legacy seeds wanted to bind to a
-- (label, field_type) pair, ensure it has at least one binding to the live
-- canonical row for that pair. We model the intended bindings as a CTE so
-- future label additions can be slotted in without changing the engine.

WITH intent (type_prefix, label, field_type) AS (
    VALUES
        -- Defect (027) — already binds via its own slugs; included for
        -- completeness so a fresh DB where the seed order differs still
        -- ends up correct.
        ('DE', 'Acceptance Criteria',  'richtext'),
        ('DE', 'Notes',                 'richtext'),
        ('DE', 'Blocked',               'boolean'),
        ('DE', 'Blocked Reason',        'textbox'),

        -- Portfolio Item (030)
        ('PI', 'Acceptance Criteria',   'richtext'),
        ('PI', 'Notes',                 'richtext'),
        ('PI', 'Blocked',               'boolean'),
        ('PI', 'Blocked Reason',        'textbox'),

        -- User Story (034)
        ('US', 'Acceptance Criteria',   'richtext'),
        ('US', 'Notes',                 'richtext'),
        ('US', 'Blocked',               'boolean'),
        ('US', 'Blocked Reason',        'textbox')
),
type_targets AS (
    SELECT i.label, i.field_type, at.id AS artefact_type_id
      FROM intent i
      JOIN artefact_types at
        ON at.subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
       AND at.prefix          = i.type_prefix
       AND at.archived_at IS NULL
),
canonicals AS (
    SELECT fl.id AS field_library_id, fl.label, fl.field_type
      FROM artefact_field_library fl
     WHERE fl.subscription_id = '00000000-0000-0000-0000-000000000001'::uuid
       AND fl.archived_at IS NULL
       AND fl.scope = 'tenant'
)
INSERT INTO artefact_type_fields (artefact_type_id, field_library_id, position, required)
SELECT
    tt.artefact_type_id,
    c.field_library_id,
    100,
    FALSE
  FROM type_targets tt
  JOIN canonicals  c
    ON c.label      = tt.label
   AND c.field_type = tt.field_type
ON CONFLICT (artefact_type_id, field_library_id) DO NOTHING;

-- ── 2. Helper for future seeds + provisioning ────────────────────────────────
-- Takes (subscription, type prefix, label, field_type) and binds the
-- canonical row. Returns the new binding id, or NULL if no canonical exists
-- (caller should insert the field first, then call this).

CREATE OR REPLACE FUNCTION bind_field_by_label(
    p_subscription_id UUID,
    p_type_prefix     TEXT,
    p_label           TEXT,
    p_field_type      TEXT,
    p_position        INT     DEFAULT 100,
    p_required        BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
    v_type_id    UUID;
    v_field_id   UUID;
    v_binding_id UUID;
BEGIN
    SELECT id INTO v_type_id
      FROM artefact_types
     WHERE subscription_id = p_subscription_id
       AND prefix = p_type_prefix
       AND archived_at IS NULL
     LIMIT 1;
    IF v_type_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_field_id
      FROM artefact_field_library
     WHERE subscription_id = p_subscription_id
       AND scope = 'tenant'
       AND label = p_label
       AND field_type = p_field_type
       AND archived_at IS NULL
     LIMIT 1;
    IF v_field_id IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO artefact_type_fields (artefact_type_id, field_library_id, position, required)
    VALUES (v_type_id, v_field_id, p_position, p_required)
    ON CONFLICT (artefact_type_id, field_library_id) DO NOTHING
    RETURNING id INTO v_binding_id;

    -- If ON CONFLICT triggered, RETURNING is null — fetch the existing.
    IF v_binding_id IS NULL THEN
        SELECT id INTO v_binding_id
          FROM artefact_type_fields
         WHERE artefact_type_id  = v_type_id
           AND field_library_id  = v_field_id;
    END IF;

    RETURN v_binding_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
