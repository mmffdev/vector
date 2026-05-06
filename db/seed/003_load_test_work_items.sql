-- ============================================================
-- MMFFDev - Vector: Work Items LOAD-TEST seed
-- Seed 003 — generates a large tree to exercise the LL pagination tab.
--
-- Shape: 1000 epics × 2 stories × 4 tasks  =  11,000 rows.
--   - 1000 root epics (parent_id NULL, backlog_position spaced)
--   - 2 stories per epic (parent_id = epic.id)
--   - 4 tasks per story (parent_id = story.id, root_feature_id = epic.id)
--
-- All rows carry the "LoadTest " title prefix so they can be removed
-- atomically via db/seed/003_load_test_work_items_DOWN.sql.
--
-- Run:
--   PGPASSWORD=… psql -h localhost -p 5435 -U mmff_dev -d mmff_vector \
--     -v ON_ERROR_STOP=1 -f db/seed/003_load_test_work_items.sql
--
-- Subscription: 00000000-0000-0000-0000-000000000001 (MMFFDev dev tenant)
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_sub      UUID := '00000000-0000-0000-0000-000000000001';
  v_owner    UUID := 'ef289df1-fcc0-4a5b-bf1b-3d3cf59be708'; -- claude@mmffdev.com
  v_flow     UUID := '26942a35-b19a-44ac-8448-b8dbe38fe55e'; -- canonical "Backlog"
  v_key_base BIGINT;
  v_pos_base INT;
BEGIN
  SELECT COALESCE(MAX(key_num), 0) INTO v_key_base
  FROM o_artefacts_execution_work_items
  WHERE subscription_id = v_sub;

  SELECT COALESCE(MAX(backlog_position), 0) INTO v_pos_base
  FROM o_artefacts_execution_work_items
  WHERE subscription_id = v_sub
    AND parent_id IS NULL AND sprint_id IS NULL AND archived_at IS NULL;

  -- ── 1) 1000 epics ──────────────────────────────────────────────────────
  CREATE TEMP TABLE _seed_epics (idx INT PRIMARY KEY, id UUID NOT NULL)
    ON COMMIT DROP;

  WITH ins AS (
    INSERT INTO o_artefacts_execution_work_items
      (subscription_id, key_num, item_type, title,
       owner_id, created_by, flow_state_id, status, backlog_position)
    SELECT
      v_sub,
      v_key_base + i,
      'epic',
      'LoadTest Epic ' || i,
      v_owner, v_owner, v_flow, 'open',
      v_pos_base + i * 100
    FROM generate_series(1, 1000) AS i
    RETURNING id, key_num
  )
  INSERT INTO _seed_epics (idx, id)
  SELECT (key_num - v_key_base)::int, id FROM ins;

  -- ── 2) 2 stories per epic (2,000 stories) ──────────────────────────────
  CREATE TEMP TABLE _seed_stories (
    idx     INT PRIMARY KEY,
    id      UUID NOT NULL,
    epic_id UUID NOT NULL
  ) ON COMMIT DROP;

  WITH spec AS (
    SELECT
      e.idx                    AS epic_idx,
      e.id                     AS epic_id,
      s                        AS sub_idx,
      (e.idx - 1) * 2 + s      AS story_idx
    FROM _seed_epics e
    CROSS JOIN generate_series(1, 2) AS s
  ),
  ins AS (
    INSERT INTO o_artefacts_execution_work_items
      (subscription_id, key_num, item_type, title,
       owner_id, created_by, flow_state_id, status,
       parent_id, root_feature_id)
    SELECT
      v_sub,
      v_key_base + 1000 + sp.story_idx,
      'story',
      'LoadTest Story ' || sp.epic_idx || '.' || sp.sub_idx,
      v_owner, v_owner, v_flow, 'open',
      sp.epic_id, sp.epic_id
    FROM spec sp
    RETURNING id, key_num, parent_id
  )
  INSERT INTO _seed_stories (idx, id, epic_id)
  SELECT (key_num - v_key_base - 1000)::int, id, parent_id FROM ins;

  -- ── 3) 4 tasks per story (8,000 tasks) ─────────────────────────────────
  WITH spec AS (
    SELECT
      s.idx                    AS story_idx,
      s.id                     AS story_id,
      s.epic_id                AS epic_id,
      t                        AS sub_idx,
      (s.idx - 1) * 4 + t      AS task_idx
    FROM _seed_stories s
    CROSS JOIN generate_series(1, 4) AS t
  )
  INSERT INTO o_artefacts_execution_work_items
    (subscription_id, key_num, item_type, title,
     owner_id, created_by, flow_state_id, status,
     parent_id, root_feature_id)
  SELECT
    v_sub,
    v_key_base + 3000 + sp.task_idx,
    'task',
    'LoadTest Task ' || sp.story_idx || '.' || sp.sub_idx,
    v_owner, v_owner, v_flow, 'open',
    sp.story_id, sp.epic_id
  FROM spec sp;

  RAISE NOTICE 'LoadTest seed inserted: 1000 epics, 2000 stories, 8000 tasks (key_num %..%)',
    v_key_base + 1, v_key_base + 11000;
END
$$;

COMMIT;
