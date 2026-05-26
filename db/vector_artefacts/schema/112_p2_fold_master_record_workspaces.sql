-- ============================================================
-- 112_p2_fold_master_record_workspaces.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 4 of N. The MRW fold.
--
-- Special case: master_record_workspaces exists in BOTH DBs with
-- divergent schemas:
--   - mmff_vector.master_record_workspaces (10 cols, post-Pillar-1
--     prefix-swept) is the registry/lookup with subscription owner,
--     creator, archive-by columns — 30 rows in dev.
--   - vector_artefacts.master_record_workspaces (17 cols, fully
--     prefixed, PK normalized in Pillar 1) is the settings sidecar
--     with date format, timezone, workdays, rank method etc. — 3
--     rows in dev (2 overlap with mmff_v, 1 system row "MMFFDev"
--     with id 00000000-0000-0000-0000-000000000001 has no mmff_v
--     twin).
--
-- Fold action (per handover §"Master Record Workspaces fold"):
--   1. ADD the 4 missing columns to VA's table (registry fields):
--        master_record_workspaces_id_subscription
--        master_record_workspaces_slug
--        master_record_workspaces_id_user_created_by
--        master_record_workspaces_id_user_archived_by
--      Columns are NULLABLE here because the existing VA-only system
--      row "MMFFDev" cannot be retro-fitted with subscription/slug
--      values it never had. This is a documented deviation from the
--      mmff_v shape (which has these as NOT NULL on subscription /
--      created_by). A follow-up migration in Pillar 3 may tighten
--      NOT NULL once the orphan row is reconciled.
--   2. INSERT mmff_v rows that don't exist in VA (28 rows).
--   3. UPDATE VA rows that DO exist in mmff_v — set the 4 new
--      columns from mmff_v's value (2 rows).
--   4. The 1 VA-only system row keeps NULL for the 4 new columns.
--   5. Verify row count: VA total = (mmff_v total) + (VA-only rows
--      that have no mmff_v twin).
--   6. Add CHECK / UNIQUE constraints + indexes that mmff_v had.
--
-- The mmff_v MRW source table is NOT dropped in this wave — Pillar 3
-- handles the source-DB cleanup once the backend is repointed.
--
-- FKs from these 4 new columns to subscriptions / users are added
-- centrally in 118_p2_add_all_fks.sql after all 37 tables are in VA.
-- ============================================================

BEGIN;

-- ---- Step 1: ADD COLUMNS ----
ALTER TABLE public.master_record_workspaces
    ADD COLUMN master_record_workspaces_id_subscription uuid,
    ADD COLUMN master_record_workspaces_slug text,
    ADD COLUMN master_record_workspaces_id_user_created_by uuid,
    ADD COLUMN master_record_workspaces_id_user_archived_by uuid;

-- ---- Step 2: INSERT mmff_v rows that don't exist in VA ----
--
-- The mmff_v rows carry the 4 new column values; VA's 17 native
-- columns get sensible defaults via the table's column defaults
-- (most have DEFAULTs; master_record_workspaces_name takes the value
-- from mmff_v explicitly to avoid losing it).
INSERT INTO public.master_record_workspaces (
    master_record_workspaces_id,
    master_record_workspaces_name,
    master_record_workspaces_description,
    master_record_workspaces_created_at,
    master_record_workspaces_updated_at,
    master_record_workspaces_archived_at,
    master_record_workspaces_id_subscription,
    master_record_workspaces_slug,
    master_record_workspaces_id_user_created_by,
    master_record_workspaces_id_user_archived_by
)
SELECT
    s.master_record_workspaces_id,
    s.master_record_workspaces_name,
    s.master_record_workspaces_description,
    s.master_record_workspaces_created_at,
    s.master_record_workspaces_updated_at,
    s.master_record_workspaces_archived_at,
    s.master_record_workspaces_id_subscription,
    s.master_record_workspaces_slug,
    s.master_record_workspaces_id_user_created_by,
    s.master_record_workspaces_id_user_archived_by
FROM dblink(_p2_source_conn(),
    'SELECT master_record_workspaces_id, master_record_workspaces_id_subscription, master_record_workspaces_name, master_record_workspaces_slug, master_record_workspaces_description, master_record_workspaces_id_user_created_by, master_record_workspaces_created_at, master_record_workspaces_updated_at, master_record_workspaces_archived_at, master_record_workspaces_id_user_archived_by FROM public.master_record_workspaces')
AS s(
    master_record_workspaces_id uuid,
    master_record_workspaces_id_subscription uuid,
    master_record_workspaces_name text,
    master_record_workspaces_slug text,
    master_record_workspaces_description text,
    master_record_workspaces_id_user_created_by uuid,
    master_record_workspaces_created_at timestamp with time zone,
    master_record_workspaces_updated_at timestamp with time zone,
    master_record_workspaces_archived_at timestamp with time zone,
    master_record_workspaces_id_user_archived_by uuid
)
WHERE NOT EXISTS (
    SELECT 1 FROM public.master_record_workspaces v
    WHERE v.master_record_workspaces_id = s.master_record_workspaces_id
);

-- ---- Step 3: UPDATE rows that exist in both ----
--
-- For overlap rows we treat mmff_v as the authoritative source for
-- the REGISTRY columns: name, description, archived_at, and the 4
-- new fold columns. This is required to keep the
-- master_record_workspaces_archived_pair_chk consistent — a row
-- archived in mmff_v has archived_by set; we MUST also pull
-- archived_at from mmff_v or the pair becomes inconsistent in VA.
--
-- The 13 VA-only "settings sidecar" columns (timezone, date_format,
-- workdays, rank_method, owner, contact email, notes etc.) are
-- preserved as-is — those carry tenant settings that mmff_v never
-- owned.
UPDATE public.master_record_workspaces v
SET
    master_record_workspaces_name                  = s.master_record_workspaces_name,
    master_record_workspaces_description           = COALESCE(s.master_record_workspaces_description, v.master_record_workspaces_description),
    master_record_workspaces_archived_at           = s.master_record_workspaces_archived_at,
    master_record_workspaces_id_subscription       = s.master_record_workspaces_id_subscription,
    master_record_workspaces_slug                  = s.master_record_workspaces_slug,
    master_record_workspaces_id_user_created_by    = s.master_record_workspaces_id_user_created_by,
    master_record_workspaces_id_user_archived_by   = s.master_record_workspaces_id_user_archived_by
FROM dblink(_p2_source_conn(),
    'SELECT master_record_workspaces_id, master_record_workspaces_name, master_record_workspaces_description, master_record_workspaces_archived_at, master_record_workspaces_id_subscription, master_record_workspaces_slug, master_record_workspaces_id_user_created_by, master_record_workspaces_id_user_archived_by FROM public.master_record_workspaces')
AS s(
    master_record_workspaces_id uuid,
    master_record_workspaces_name text,
    master_record_workspaces_description text,
    master_record_workspaces_archived_at timestamp with time zone,
    master_record_workspaces_id_subscription uuid,
    master_record_workspaces_slug text,
    master_record_workspaces_id_user_created_by uuid,
    master_record_workspaces_id_user_archived_by uuid
)
WHERE v.master_record_workspaces_id = s.master_record_workspaces_id;

-- ---- Step 4: Add CHECKs + indexes from mmff_v side ----
ALTER TABLE public.master_record_workspaces
    ADD CONSTRAINT master_record_workspaces_archived_pair_chk CHECK (
        ((master_record_workspaces_archived_at IS NULL) AND (master_record_workspaces_id_user_archived_by IS NULL))
        OR
        ((master_record_workspaces_archived_at IS NOT NULL) AND (master_record_workspaces_id_user_archived_by IS NOT NULL))
    );

ALTER TABLE public.master_record_workspaces
    ADD CONSTRAINT master_record_workspaces_name_chk CHECK (
        (length(TRIM(BOTH FROM master_record_workspaces_name)) > 0)
    );

-- Slug CHECK is conditional: the VA-only orphan ("MMFFDev") has NULL
-- slug, so we use a NULL-tolerant CHECK that mirrors mmff_v's intent
-- without breaking the orphan. mmff_v's CHECK was NOT NULL-tolerant
-- because the column was NOT NULL there.
ALTER TABLE public.master_record_workspaces
    ADD CONSTRAINT master_record_workspaces_slug_chk CHECK (
        master_record_workspaces_slug IS NULL OR
        ((length(TRIM(BOTH FROM master_record_workspaces_slug)) > 0) AND
         (master_record_workspaces_slug ~ '^[a-z0-9][a-z0-9-]*$'::text))
    );

-- Partial unique index from mmff_v (subscription + slug, live rows
-- only). VA-only orphan with NULL slug is excluded automatically.
CREATE UNIQUE INDEX master_record_workspaces_id_subscription_slug_live_unique
    ON public.master_record_workspaces USING btree
    (master_record_workspaces_id_subscription, master_record_workspaces_slug)
    WHERE (master_record_workspaces_archived_at IS NULL);

CREATE INDEX idx_master_record_workspaces_id_subscription
    ON public.master_record_workspaces USING btree (master_record_workspaces_id_subscription);

-- ---- Step 5: parity verification ----
-- Expected:
--   source_count   = mmff_v.master_record_workspaces row count
--   va_post_count  = source_count + (VA-only rows pre-fold)
--
-- The VA-only count is computed by subtracting overlap from the
-- pre-fold VA total. We can't see "pre-fold" any more, so we use
-- the equivalent check: every mmff_v row has a VA twin, and the
-- difference (VA - mmff_v) equals the VA-only count we expected.
DO $$
DECLARE
    v_src_count    bigint;
    v_va_count     bigint;
    v_overlap      bigint;
    v_orphan_count bigint;
BEGIN
    v_src_count := _p2_source_rowcount('master_record_workspaces');
    SELECT count(*) INTO v_va_count FROM public.master_record_workspaces;

    -- Every mmff_v row must have a VA twin post-fold.
    SELECT count(*) INTO v_overlap
      FROM public.master_record_workspaces v
     WHERE EXISTS (
        SELECT 1 FROM dblink(_p2_source_conn(),
            'SELECT master_record_workspaces_id FROM public.master_record_workspaces')
        AS m(id uuid)
        WHERE m.id = v.master_record_workspaces_id
     );

    IF v_overlap <> v_src_count THEN
        RAISE EXCEPTION 'MRW fold: % source rows but only % have VA twins (overlap mismatch)',
            v_src_count, v_overlap;
    END IF;

    -- VA-only rows have NULL on the four fold columns (their values
    -- come from mmff_v; orphans have none).
    SELECT count(*) INTO v_orphan_count
      FROM public.master_record_workspaces v
     WHERE NOT EXISTS (
        SELECT 1 FROM dblink(_p2_source_conn(),
            'SELECT master_record_workspaces_id FROM public.master_record_workspaces')
        AS m(id uuid)
        WHERE m.id = v.master_record_workspaces_id
     );

    IF v_va_count <> v_src_count + v_orphan_count THEN
        RAISE EXCEPTION 'MRW fold: va_count=%, src_count=%, orphan_count=% — totals do not balance',
            v_va_count, v_src_count, v_orphan_count;
    END IF;

    RAISE NOTICE 'MRW fold OK: src=%, va_post=%, orphan=%',
        v_src_count, v_va_count, v_orphan_count;
END $$;

COMMIT;
