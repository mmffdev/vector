-- ============================================================
-- MMFFDev - Vector: Master Reset Seed
-- Seed 010 — <seed> -m / <reset> -m
--
-- PURPOSE
--   Wipes all tenant data back to a clean, known default state so
--   subsequent seeds (workspace, backlog, topology, etc.) can be
--   applied from zero without FK collisions. Also seeds the canonical
--   master_record_tenant row with the ACME Bank testbed identity.
--
-- WHAT THIS DOES
--   1.  Clear artefact data (vector_artefacts schema)
--       - artefact_field_values
--       - artefacts
--       - artefact_number_sequence (per-type counters → reset)
--       - artefact_types WHERE scope IN ('work','strategy') AND source='tenant'
--         (system rows from 010/011/014 seeds are preserved)
--       - timeboxes_sprints
--       - timeboxes_releases
--       - topology_role_grants
--       - topology_view_state
--       - topology_nodes
--       - master_record_portfolio
--       - master_record_tenant (vector_artefacts) — replaced below
--
--   2.  Clear workspace data (mmff_vector schema)
--       - master_record_workspaces (all workspaces for subscription)
--       - master_record_portfolio (mmff_vector copy if present)
--       - subscription_portfolio_model_state
--       - obj_strategy_types_layers  (legacy mirror rows)
--       - subscription_workflows     (legacy mirror rows)
--       - subscription_workflow_transitions (legacy mirror rows)
--       - subscription_terminology   (legacy mirror rows)
--       - subscription_artifacts     (legacy mirror rows)
--       - o_flow_tenant              (tenant flow overrides)
--
--   3.  Seed master_record_tenant (vector_artefacts)
--       One row for the testbed workspace. The workspace_id used here
--       is the well-known dev workspace UUID
--       00000000-0000-0000-0000-000000000010 which the subsequent
--       <seed> workspace step creates in master_record_workspaces.
--       This seed does NOT create that workspace row — that belongs
--       to a separate workspace seed.
--
--   4.  Seed a single root topology node
--       One root topology_nodes row named "ACME Bank" with no parent,
--       scoped to the dev workspace and subscription.
--
-- WHAT THIS DOES NOT TOUCH
--   - users, sessions, audit_log (accounts + credentials unchanged)
--   - roles, permissions, role_permissions (RBAC catalogue unchanged)
--   - pages, page_roles, user_nav_prefs (nav registry unchanged)
--   - subscriptions, tenants (tenant anchor row unchanged)
--   - mmff_library.* (library is never modified by tenant resets)
--   - System artefact_types (source='system') — always preserved
--
-- EXECUTION
--   This script MUST be split and applied to the correct databases:
--
--   PART A — vector_artefacts DB (tunnel :5435, db vector_artefacts):
--     Apply lines between "BEGIN PART A" and "COMMIT PART A"
--
--   PART B — mmff_vector DB (tunnel :5435, db mmff_vector):
--     Apply lines between "BEGIN PART B" and "COMMIT PART B"
--
--   The <reset> -m command in the backend will call both in sequence.
--   Running manually:
--     psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts -f 010_master_reset_a.sql
--     psql -h localhost -p 5435 -U mmff_dev -d mmff_vector     -f 010_master_reset_b.sql
--
-- CONSTANTS
--   SUBSCRIPTION_ID : 00000000-0000-0000-0000-000000000001  (MMFFDev tenant)
--   DEV_WORKSPACE_ID: 00000000-0000-0000-0000-000000000010  (created by workspace seed)
--   GADMIN_USER_ID  : resolved at runtime from users WHERE email='gadmin@mmffdev.com'
--
-- ============================================================


-- ============================================================
-- PART A — target database: vector_artefacts
-- ============================================================

BEGIN; -- PART A

DO $$
DECLARE
    v_subscription_id UUID := '00000000-0000-0000-0000-000000000001';
    v_workspace_id    UUID := '00000000-0000-0000-0000-000000000010';
    v_gadmin_id       UUID;
    v_node_id         UUID := gen_random_uuid();
BEGIN

    -- ──────────────────────────────────────────────────────────
    -- 1a. Artefact field values (child of artefacts — delete first)
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.artefact_field_values
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 1b. Artefacts (core backlog rows — all scopes)
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.artefacts
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 1c. Number sequence counters (reset so next artefact starts at 1)
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.artefact_number_sequence
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 1d. Tenant-authored artefact types (scope=work or strategy,
    --     source=tenant). System rows (source='system') are preserved
    --     — they are seeded by migrations 010/011/034 and are
    --     shared infrastructure, not tenant data.
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.artefact_types
     WHERE subscription_id = v_subscription_id
       AND source = 'tenant';

    -- ──────────────────────────────────────────────────────────
    -- 1e. Timeboxes
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.timeboxes_sprints
     WHERE timeboxes_sprints_id_subscription = v_subscription_id;

    DELETE FROM vector_artefacts.timeboxes_releases
     WHERE timeboxes_releases_id_subscription = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 2a. Topology — role grants (child of topology_nodes)
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.users_roles_topology_nodes
     WHERE users_roles_topology_nodes_id_subscription = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 2b. Topology — view state (per-user canvas pan/zoom)
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.topology_view_states
     WHERE topology_view_states_id_subscription = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 2c. Topology — nodes (self-referential; delete all at once,
    --     parent_id ON DELETE RESTRICT would block ordered deletes
    --     so we disable constraint deferral via SET CONSTRAINTS ALL DEFERRED
    --     or delete children-first via recursive CTE.)
    --
    --     Approach: set archived_at on all first to break the
    --     RESTRICT check, then delete; or simply use a single
    --     DELETE with a CTE to order leaves first.
    -- ──────────────────────────────────────────────────────────

    -- Detach children from parents temporarily, then delete all.
    UPDATE vector_artefacts.topology_nodes
       SET parent_id = NULL
     WHERE subscription_id = v_subscription_id;

    DELETE FROM vector_artefacts.topology_nodes
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 3. Master record portfolio (adoption snapshot)
    -- ──────────────────────────────────────────────────────────
    DELETE FROM vector_artefacts.master_record_portfolio
     WHERE workspace_id = v_workspace_id;

    -- ──────────────────────────────────────────────────────────
    -- 4a. Upsert master_record_tenant (vector_artefacts)
    --     workspace_id references the well-known dev workspace.
    --     gadmin@mmffdev.com is the testbed owner.
    --     Note: the workspace row itself (master_record_workspaces
    --     in mmff_vector) is created by the workspace seed, not here.
    -- ──────────────────────────────────────────────────────────

    -- Resolve gadmin user id (soft cross-DB reference — store as UUID).
    -- We embed the well-known gadmin UUID directly to avoid a cross-DB
    -- SELECT. If the user row has been recreated with a different UUID,
    -- update this constant.
    -- gadmin@mmffdev.com is seeded in migration 001_init.sql with a
    -- gen_random_uuid() — resolve at seed time via a subquery if both
    -- DBs are accessible from the same session, otherwise hardcode below.
    --
    -- IMPORTANT: this seed targets vector_artefacts only in PART A.
    -- The gadmin UUID cannot be queried cross-DB from here. We store
    -- a sentinel NULL and the application layer resolves ownership on
    -- first load. Alternatively, the <reset> CLI command resolves the
    -- UUID and passes it as a parameter.
    --
    -- Stored as NULL here — workspace seed sets this correctly once the
    -- workspace row exists and the caller's user_id is known.

    INSERT INTO vector_artefacts.master_record_tenant (
        workspace_id,
        tenant_name,
        tenant_description,
        tenant_owner_user_id,
        tenant_data_region,
        tenant_timezone,
        tenant_date_format,
        tenant_datetime_format,
        tenant_workdays,
        tenant_week_start,
        tenant_rank_method,
        tenant_build_changeset_tracking,
        tenant_notes,
        tenant_primary_contact_email
    )
    VALUES (
        v_workspace_id,
        'ACME Bank',
        'MMFFDev Testbed',
        NULL,                                          -- resolved by workspace seed
        'euw2',
        'Europe/London',
        'DD/MM/YYYY',
        'DD/MM/YYYY HH:mm',
        ARRAY['mon','tue','wed','thu','fri']::text[],
        'mon',
        'manual',
        FALSE,                                         -- build_changeset_tracking
        NULL,                                          -- notes
        'cookra@me.com'
    )
    ON CONFLICT (workspace_id) DO UPDATE
       SET tenant_name                     = EXCLUDED.tenant_name,
           tenant_description              = EXCLUDED.tenant_description,
           tenant_data_region              = EXCLUDED.tenant_data_region,
           tenant_timezone                 = EXCLUDED.tenant_timezone,
           tenant_date_format              = EXCLUDED.tenant_date_format,
           tenant_datetime_format          = EXCLUDED.tenant_datetime_format,
           tenant_workdays                 = EXCLUDED.tenant_workdays,
           tenant_week_start               = EXCLUDED.tenant_week_start,
           tenant_rank_method              = EXCLUDED.tenant_rank_method,
           tenant_build_changeset_tracking = EXCLUDED.tenant_build_changeset_tracking,
           tenant_primary_contact_email    = EXCLUDED.tenant_primary_contact_email,
           tenant_updated_at               = now();

    -- ──────────────────────────────────────────────────────────
    -- 4b. Seed root topology node: "ACME Bank"
    --     One root node per tenant. No parent. Workspace-scoped to
    --     the dev workspace. label_override NULL → UI shows "Office".
    --     layout_mode = auto-horizontal (default canvas layout).
    -- ──────────────────────────────────────────────────────────
    INSERT INTO vector_artefacts.topology_nodes (
        id,
        workspace_id,
        subscription_id,
        parent_id,
        name,
        description,
        layout_mode,
        collapsed_default,
        sort_order
    )
    VALUES (
        v_node_id,
        v_workspace_id,
        v_subscription_id,
        NULL,                   -- root node
        'ACME Bank',
        '',
        'auto-horizontal',
        FALSE,                  -- root node always expanded by default
        0
    );

    RAISE NOTICE 'PART A complete: artefacts cleared, master_record_tenant upserted, topology root "ACME Bank" created (id=%)', v_node_id;

END $$;

COMMIT; -- PART A


-- ============================================================
-- PART B — target database: mmff_vector
-- ============================================================

BEGIN; -- PART B

DO $$
DECLARE
    v_subscription_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

    -- ──────────────────────────────────────────────────────────
    -- 5a. Legacy adoption mirror tables (from adoption saga)
    --     Deleted in FK-safe order: transitions → workflows →
    --     layers → model state.
    -- ──────────────────────────────────────────────────────────
    DELETE FROM mmff_vector.subscription_workflow_transitions
     WHERE subscription_id = v_subscription_id
       AND source_library_id IS NOT NULL;

    DELETE FROM mmff_vector.subscription_workflows
     WHERE subscription_id = v_subscription_id
       AND source_library_id IS NOT NULL;

    DELETE FROM mmff_vector.obj_strategy_types_layers
     WHERE subscription_id = v_subscription_id
       AND source_library_id IS NOT NULL;

    DELETE FROM mmff_vector.subscription_terminology
     WHERE subscription_id = v_subscription_id
       AND source_library_id IS NOT NULL;

    DELETE FROM mmff_vector.subscription_artifacts
     WHERE subscription_id = v_subscription_id
       AND source_library_id IS NOT NULL;

    DELETE FROM mmff_vector.subscription_portfolio_model_state
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 5b. Tenant flow overrides (o_flow_tenant rows for this
    --     subscription — system flows in o_flow_system are
    --     preserved as they are seeded by migrations 109/110).
    -- ──────────────────────────────────────────────────────────
    DELETE FROM mmff_vector.o_flow_tenant
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 5c. All workspaces for this subscription.
    --     Cascade: roles_workspaces (workspace FK) will be
    --     handled before this if ON DELETE CASCADE is set;
    --     otherwise delete roles_workspaces first.
    --
    --     master_record_workspaces has ON DELETE RESTRICT on
    --     created_by/archived_by (user FKs) — these are fine to
    --     delete directly since the user rows remain.
    -- ──────────────────────────────────────────────────────────

    -- Delete workspace role grants before workspaces (FK child).
    DELETE FROM mmff_vector.roles_workspaces
     WHERE workspace_id IN (
         SELECT id FROM mmff_vector.master_record_workspaces
          WHERE subscription_id = v_subscription_id
     );

    DELETE FROM mmff_vector.master_record_workspaces
     WHERE subscription_id = v_subscription_id;

    -- ──────────────────────────────────────────────────────────
    -- 5d. mmff_vector master_record_tenant (workspace settings
    --     mirror). This row is keyed on subscription_id. We
    --     reset it to default values; the application will
    --     overwrite it on first workspace-settings save.
    --     We do NOT delete it — the subscription row must always
    --     have exactly one master_record_tenant row (trigger
    --     on subscriptions INSERT enforces this).
    -- ──────────────────────────────────────────────────────────
    UPDATE mmff_vector.master_record_tenant
       SET workspace_name          = 'ACME Bank',
           description             = 'MMFFDev Testbed',
           owner_user_id           = NULL,
           data_region             = 'euw2',
           timezone                = 'Europe/London',
           date_format             = 'DD/MM/YYYY',
           datetime_format         = 'DD/MM/YYYY HH:mm',
           workdays                = ARRAY['mon','tue','wed','thu','fri']::text[],
           week_start              = 'mon',
           rank_method             = 'manual',
           build_changeset_tracking= FALSE,
           workspace_notes         = NULL,
           primary_contact_email   = 'cookra@me.com',
           updated_at              = now()
     WHERE subscription_id = v_subscription_id;

    IF NOT FOUND THEN
        -- Auto-seed trigger should have created this on subscription INSERT,
        -- but guard against a missing row.
        INSERT INTO mmff_vector.master_record_tenant (
            subscription_id,
            workspace_name,
            description,
            data_region,
            timezone,
            date_format,
            datetime_format,
            workdays,
            week_start,
            rank_method,
            build_changeset_tracking,
            primary_contact_email
        )
        VALUES (
            v_subscription_id,
            'ACME Bank',
            'MMFFDev Testbed',
            'euw2',
            'Europe/London',
            'DD/MM/YYYY',
            'DD/MM/YYYY HH:mm',
            ARRAY['mon','tue','wed','thu','fri']::text[],
            'mon',
            'manual',
            FALSE,
            'cookra@me.com'
        )
        ON CONFLICT (subscription_id) DO NOTHING;
    END IF;

    RAISE NOTICE 'PART B complete: legacy adoption tables cleared, workspaces cleared, master_record_tenant reset to ACME Bank testbed defaults.';

END $$;

COMMIT; -- PART B


-- ============================================================
-- VERIFICATION QUERIES (run after both parts to confirm state)
-- ============================================================
--
-- Run against vector_artefacts:
--
--   SELECT COUNT(*) FROM artefacts WHERE subscription_id = '00000000-0000-0000-0000-000000000001';
--   -- expect: 0
--
--   SELECT workspace_id, tenant_name, tenant_data_region FROM master_record_tenant;
--   -- expect: 00000000-0000-0000-0000-000000000010 | ACME Bank | euw2
--
--   SELECT id, name, parent_id FROM topology_nodes WHERE subscription_id = '00000000-0000-0000-0000-000000000001';
--   -- expect: 1 row, parent_id = NULL, name = 'ACME Bank'
--
-- Run against mmff_vector:
--
--   SELECT COUNT(*) FROM master_record_workspaces WHERE subscription_id = '00000000-0000-0000-0000-000000000001';
--   -- expect: 0 (workspace seed has not yet run)
--
--   SELECT workspace_name, data_region, primary_contact_email FROM master_record_tenant
--    WHERE subscription_id = '00000000-0000-0000-0000-000000000001';
--   -- expect: ACME Bank | euw2 | cookra@me.com
--
--   SELECT COUNT(*) FROM subscription_portfolio_model_state WHERE subscription_id = '00000000-0000-0000-0000-000000000001';
--   -- expect: 0
-- ============================================================
