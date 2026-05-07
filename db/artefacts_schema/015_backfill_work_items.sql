-- ============================================================
-- PLA-0023 / 00472 — ETL backfill: obj_work_items → artefacts via postgres_fdw
-- Run against vector_artefacts:
--   go run ./backend/cmd/migrate -db vector_artefacts -env backend/.env.local
--
-- Reads from mmff_vector.obj_work_items (and related tables) via postgres_fdw,
-- upserts into vector_artefacts.artefacts (keyed on id), and records a run
-- summary in etl_backfill_audit.
--
-- Idempotent: safe to run multiple times. ON CONFLICT updates mutable fields
-- only — identity columns (artefact_type_id, subscription_id, workspace_id,
-- number) are never overwritten.
--
-- sprint_id is set to NULL: sprints are a separate table with different IDs;
-- sprint migration is out of scope for this story.
--
-- Down migration: db/artefacts_schema/down/015_backfill_work_items_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. postgres_fdw extension ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- ── 2. Foreign server pointing at the mmff_vector database ───────────────────
--
-- Both databases live on the same Postgres instance (localhost:5435 via SSH
-- tunnel). DROP … CASCADE cleans up any stale foreign tables / user mappings
-- from a previous partial run before recreating, making the block idempotent.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'fdw_mmff_vector') THEN
        DROP SERVER fdw_mmff_vector CASCADE;
    END IF;
END;
$$;

CREATE SERVER fdw_mmff_vector
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'mmff_vector');

-- User mapping password is injected at runtime via the session GUC
-- app.fdw_source_password (set by the Go migration runner from DB_PASSWORD).
-- No plaintext credential is committed to this file.
DO $$
DECLARE
  v_pw text;
BEGIN
  v_pw := current_setting('app.fdw_source_password', true);
  IF v_pw IS NULL OR v_pw = '' THEN
    RAISE EXCEPTION 'app.fdw_source_password is not set. The migration runner must inject DB_PASSWORD before running this migration.';
  END IF;
  EXECUTE format(
    'CREATE USER MAPPING IF NOT EXISTS FOR mmff_dev SERVER fdw_mmff_vector OPTIONS (user ''mmff_dev'', password %L)',
    v_pw
  );
END $$;

-- ── 3. Foreign tables ─────────────────────────────────────────────────────────

CREATE FOREIGN TABLE fdw_obj_work_items (
    id               uuid,
    subscription_id  uuid,
    key_num          bigint,
    title            text,
    description      text,
    owner_id         uuid,
    created_by       uuid,
    updated_by       uuid,
    created_at       timestamptz,
    updated_at       timestamptz,
    archived_at      timestamptz,
    item_type        text,
    parent_id        uuid,
    priority         text,
    story_points     integer,
    sprint_id        uuid,
    backlog_position integer,
    flow_state_id    uuid,
    due_date         date
)
SERVER fdw_mmff_vector
OPTIONS (schema_name 'public', table_name 'obj_work_items');

CREATE FOREIGN TABLE fdw_obj_flow_tenant (
    id              uuid,
    subscription_id uuid,
    canonical_code  text
)
SERVER fdw_mmff_vector
OPTIONS (schema_name 'public', table_name 'obj_flow_tenant');

CREATE FOREIGN TABLE fdw_workspaces (
    id              uuid,
    subscription_id uuid,
    name            text
)
SERVER fdw_mmff_vector
OPTIONS (schema_name 'public', table_name 'workspaces');

-- ── 4. Audit table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS etl_backfill_audit (
    run_at        timestamptz NOT NULL DEFAULT now(),
    source        text        NOT NULL,
    rows_inserted int         NOT NULL,
    rows_updated  int         NOT NULL,
    rows_total    int         NOT NULL
);

-- ── 5. Seed artefact types for both subscriptions ────────────────────────────
--
-- Subscription 00000000-0000-0000-0000-000000000001 is already seeded (migration
-- 010/014). Subscription 4dbcef71-f9d2-48e5-b19c-1bafc1767c67 has 9 source
-- rows and needs the 4 system work types + flows so artefact_type_id lookups
-- in the upsert below will resolve. seed_system_artefact_types is idempotent.
SELECT seed_system_artefact_types('00000000-0000-0000-0000-000000000001'::uuid);
SELECT seed_system_artefact_types('4dbcef71-f9d2-48e5-b19c-1bafc1767c67'::uuid);

-- ── 6. Main upsert ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_count_before  bigint;
    v_count_after   bigint;
    v_rows_upserted int;
    v_source_count  bigint;
BEGIN
    -- Snapshot artefact count before upsert to derive inserted vs updated.
    SELECT COUNT(*) INTO v_count_before FROM artefacts;
    SELECT COUNT(*) INTO v_source_count FROM fdw_obj_work_items;

    -- Upsert all source rows.
    --
    -- Flow state mapping:
    --   src.flow_state_id → fdw_obj_flow_tenant.canonical_code
    --   canonical_code    → flow_states.kind via CASE
    --   (artefact_type_id, kind) → first matching flow_states.id in vector_artefacts
    --
    -- workspace_id: prefer the real workspace row; fall back to subscription_id
    --   (soft FK not enforced — no workspace row for subscription 4dbcef71).
    --
    -- item_type → prefix: epic→EP, story→US, task→TA, defect→DE
    --
    INSERT INTO artefacts (
        id,
        subscription_id,
        workspace_id,
        artefact_type_id,
        number,
        title,
        description,
        parent_artefact_id,
        flow_state_id,
        created_by_user_id,
        assigned_to_user_id,
        owned_by_user_id,
        position,
        created_at,
        updated_at,
        archived_at,
        priority,
        story_points,
        due_date,
        sprint_id
    )
    SELECT
        src.id,
        src.subscription_id,

        -- workspace_id: real workspace or subscription_id as fallback.
        COALESCE(ws.id, src.subscription_id)  AS workspace_id,

        -- artefact_type_id resolved by (subscription_id, prefix).
        at.id                                  AS artefact_type_id,

        src.key_num                            AS number,
        src.title,
        src.description,

        -- parent_artefact_id: same UUID as in source (parents are in the same batch).
        src.parent_id                          AS parent_artefact_id,

        -- flow_state_id: sub-select resolves canonical_code → kind → flow_states.id.
        (
            SELECT fs.id
            FROM   flow_states  fs
            JOIN   flows        fl ON fl.id = fs.flow_id
            WHERE  fl.artefact_type_id = at.id
              AND  fs.kind = CASE oft.canonical_code
                                 WHEN 'backlog'   THEN 'todo'
                                 WHEN 'ready'     THEN 'todo'
                                 WHEN 'doing'     THEN 'in_progress'
                                 WHEN 'accepted'  THEN 'in_progress'
                                 WHEN 'completed' THEN 'done'
                                 ELSE NULL
                             END
            LIMIT 1
        )                                      AS flow_state_id,

        src.created_by                         AS created_by_user_id,
        NULL::uuid                             AS assigned_to_user_id,
        src.owner_id                           AS owned_by_user_id,

        COALESCE(src.backlog_position, 0)      AS position,
        src.created_at,
        src.updated_at,
        src.archived_at,
        src.priority,
        src.story_points,
        src.due_date,
        NULL::uuid                             AS sprint_id   -- out of scope
    FROM   fdw_obj_work_items   src
    -- LEFT JOIN so rows with NULL flow_state_id are not silently dropped;
    -- they land with a NULL flow_state_id in artefacts (resolvable post-migration).
    LEFT JOIN fdw_obj_flow_tenant  oft  ON oft.id              = src.flow_state_id
    JOIN   artefact_types       at   ON at.subscription_id  = src.subscription_id
                                    AND at.source            = 'system'
                                    AND at.scope             = 'work'
                                    AND at.archived_at       IS NULL
                                    AND at.prefix            = CASE src.item_type
                                                                   WHEN 'epic'   THEN 'EP'
                                                                   WHEN 'story'  THEN 'US'
                                                                   WHEN 'task'   THEN 'TA'
                                                                   WHEN 'defect' THEN 'DE'
                                                               END
    LEFT JOIN fdw_workspaces    ws   ON ws.subscription_id  = src.subscription_id

    ON CONFLICT (id) DO UPDATE SET
        title               = EXCLUDED.title,
        description         = EXCLUDED.description,
        parent_artefact_id  = EXCLUDED.parent_artefact_id,
        flow_state_id       = EXCLUDED.flow_state_id,
        created_by_user_id  = EXCLUDED.created_by_user_id,
        owned_by_user_id    = EXCLUDED.owned_by_user_id,
        position            = EXCLUDED.position,
        updated_at          = EXCLUDED.updated_at,
        archived_at         = EXCLUDED.archived_at,
        priority            = EXCLUDED.priority,
        story_points        = EXCLUDED.story_points,
        due_date            = EXCLUDED.due_date;
        -- NOTE: artefact_type_id, subscription_id, workspace_id, number are
        -- intentionally excluded — they are identity columns, not mutable data.

    GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;

    -- Warn if fewer rows landed than were in the source. This can happen when
    -- item_type is not one of epic/story/task/defect (no matching artefact_type).
    IF v_rows_upserted < v_source_count THEN
        RAISE WARNING 'ETL: % of % source rows were skipped (unknown item_type or missing artefact_type). Check fdw_obj_work_items.',
            v_source_count - v_rows_upserted, v_source_count;
    END IF;

    SELECT COUNT(*) INTO v_count_after FROM artefacts;

    INSERT INTO etl_backfill_audit (run_at, source, rows_inserted, rows_updated, rows_total)
    VALUES (
        now(),
        'obj_work_items',
        (v_count_after  - v_count_before)::int,                         -- net new rows
        (v_rows_upserted - (v_count_after - v_count_before))::int,      -- rows that conflicted
        v_rows_upserted
    );

    RAISE NOTICE 'ETL backfill obj_work_items: % upserted (% inserted, % updated)',
        v_rows_upserted,
        (v_count_after  - v_count_before),
        (v_rows_upserted - (v_count_after - v_count_before));
END;
$$;

COMMIT;
