-- DOWN counterpart of 112_p2_fold_master_record_workspaces.sql
--
-- Reverses the MRW fold: removes inserted/updated mmff_v rows from
-- VA, drops the 4 added columns, drops the added CHECKs and the
-- unique index. The VA-only system row "MMFFDev" survives.

BEGIN;

-- 1. Drop CHECKs we added.
ALTER TABLE public.master_record_workspaces
    DROP CONSTRAINT IF EXISTS master_record_workspaces_archived_pair_chk,
    DROP CONSTRAINT IF EXISTS master_record_workspaces_name_chk,
    DROP CONSTRAINT IF EXISTS master_record_workspaces_slug_chk;

-- 2. Drop indexes we added.
DROP INDEX IF EXISTS master_record_workspaces_id_subscription_slug_live_unique;
DROP INDEX IF EXISTS idx_master_record_workspaces_id_subscription;

-- 3. Delete rows that came from mmff_v (every row that has any of
-- the 4 fold columns populated).
DELETE FROM public.master_record_workspaces
WHERE master_record_workspaces_id_subscription IS NOT NULL
   OR master_record_workspaces_slug IS NOT NULL
   OR master_record_workspaces_id_user_created_by IS NOT NULL
   OR master_record_workspaces_id_user_archived_by IS NOT NULL;

-- 4. Drop the 4 columns we added.
ALTER TABLE public.master_record_workspaces
    DROP COLUMN IF EXISTS master_record_workspaces_id_user_archived_by,
    DROP COLUMN IF EXISTS master_record_workspaces_id_user_created_by,
    DROP COLUMN IF EXISTS master_record_workspaces_slug,
    DROP COLUMN IF EXISTS master_record_workspaces_id_subscription;

COMMIT;
