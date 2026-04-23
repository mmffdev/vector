-- Migration 012: fix pages uniqueness for shared (created_by IS NULL) rows.
--
-- The old constraint UNIQUE (key_enum, tenant_id, created_by) treats NULL as
-- distinct, so two consecutive bookmark Pin calls (which insert with
-- created_by = NULL) produced duplicate pages rows for the same entity.
-- Replace with two partial unique indexes that collapse the NULL slot.

BEGIN;

-- 1. Dedupe existing duplicates: keep the oldest pages row per
--    (key_enum, tenant_id) where created_by IS NULL; rewire dependents,
--    delete losers.
WITH ranked AS (
    SELECT id, key_enum, tenant_id,
           ROW_NUMBER() OVER (PARTITION BY key_enum, tenant_id ORDER BY created_at, id) AS rn,
           FIRST_VALUE(id) OVER (PARTITION BY key_enum, tenant_id ORDER BY created_at, id) AS keeper_id
    FROM pages
    WHERE created_by IS NULL
),
losers AS (
    SELECT id, keeper_id FROM ranked WHERE rn > 1
)
-- Move backlinks onto the keeper. ON CONFLICT covers the case where the
-- keeper already had its own backlink row.
, _refs AS (
    UPDATE page_entity_refs r
       SET page_id = l.keeper_id
      FROM losers l
     WHERE r.page_id = l.id
       AND NOT EXISTS (
         SELECT 1 FROM page_entity_refs k
         WHERE k.page_id = l.keeper_id
           AND k.entity_kind = r.entity_kind
           AND k.entity_id = r.entity_id)
    RETURNING 1
)
DELETE FROM pages
 WHERE id IN (SELECT id FROM losers);

-- 2. Swap the constraint for partial indexes.
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_unique_key_per_scope;

-- Shared tenant-scoped pages (entity bookmarks): created_by IS NULL,
-- tenant_id IS NOT NULL. ON CONFLICT (key_enum, tenant_id) inference matches.
CREATE UNIQUE INDEX pages_unique_key_shared_tenant
    ON pages (key_enum, tenant_id)
    WHERE created_by IS NULL AND tenant_id IS NOT NULL;

-- System pages: both NULL. Seeded once; key_enum alone is the identity.
CREATE UNIQUE INDEX pages_unique_key_system
    ON pages (key_enum)
    WHERE created_by IS NULL AND tenant_id IS NULL;

-- User-custom pages: created_by set; tenant_id always set for these.
CREATE UNIQUE INDEX pages_unique_key_user
    ON pages (key_enum, tenant_id, created_by)
    WHERE created_by IS NOT NULL;

COMMIT;
