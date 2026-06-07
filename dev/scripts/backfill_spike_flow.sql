-- ============================================================
-- Backfill: seed a default flow for the user's custom "Spike" work type by
-- cloning the Story flow it was created "behaves like".
--
-- WHY: Spike (a38301f1...) was created via CreateWorkType BEFORE the
-- flow-seeding feature existed, so it has no default flow → invisible to
-- Transition Rules + cannot move through states. Story (f2b9775d...) in the
-- same workspace (a4df2e21...) has the canonical 5-state flow; clone it.
--
-- SCOPE: the active dev workspace a4df2e21 only. The broader finding —
-- ~160 flowless work types across ~30 workspaces — is tracked as
-- TD-WORKTYPE-FLOWS-TENANT-WIDE; that belongs in the workspace-creation seed
-- path, NOT this one-shot. Do not widen this script.
--
-- IDEMPOTENT: no-op if Spike already has a default flow.
-- ============================================================

DO $$
DECLARE
    src_type uuid := 'f2b9775d-fc93-4090-8865-c67242f1d98c'; -- Story
    dst_type uuid := 'a38301f1-bb57-46c5-b09b-5bda681c8bd8'; -- Spike
    src_flow uuid;
    new_flow uuid;
    rec      RECORD;
    id_map   jsonb := '{}'::jsonb;
BEGIN
    -- Guard: skip if Spike already has a default flow.
    IF EXISTS (SELECT 1 FROM flows WHERE flows_id_artefact_type = dst_type
                 AND flows_is_default AND flows_archived_at IS NULL) THEN
        RAISE NOTICE 'Spike already has a default flow — no-op.';
        RETURN;
    END IF;

    SELECT flows_id INTO src_flow FROM flows
      WHERE flows_id_artefact_type = src_type AND flows_is_default
        AND flows_archived_at IS NULL LIMIT 1;
    IF src_flow IS NULL THEN
        RAISE EXCEPTION 'Source Story flow not found — aborting.';
    END IF;

    -- New default flow for Spike.
    INSERT INTO flows (flows_id_artefact_type, flows_name, flows_is_default)
    VALUES (dst_type, 'Spike default flow', TRUE)
    RETURNING flows_id INTO new_flow;

    -- Clone states, building an old→new id map.
    FOR rec IN
        SELECT flows_states_id, flows_states_name, flows_states_kind, flows_states_colour,
               flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable
        FROM flows_states
        WHERE flows_states_id_flow = src_flow AND flows_states_archived_at IS NULL
        ORDER BY flows_states_sort_order
    LOOP
        DECLARE new_state uuid;
        BEGIN
            INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind,
                flows_states_colour, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
            VALUES (new_flow, rec.flows_states_name, rec.flows_states_kind, rec.flows_states_colour,
                rec.flows_states_sort_order, rec.flows_states_is_initial, rec.flows_states_is_pullable)
            RETURNING flows_states_id INTO new_state;
            id_map := id_map || jsonb_build_object(rec.flows_states_id::text, new_state::text);
        END;
    END LOOP;

    -- Clone transitions, remapping from/to via the id map.
    FOR rec IN
        SELECT flows_transitions_id_state_from AS f, flows_transitions_id_state_to AS t
        FROM flows_transitions WHERE flows_transitions_id_flow = src_flow
    LOOP
        IF id_map ? rec.f::text AND id_map ? rec.t::text THEN
            INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
            VALUES (new_flow, (id_map ->> rec.f::text)::uuid, (id_map ->> rec.t::text)::uuid)
            ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) DO NOTHING;
        END IF;
    END LOOP;

    RAISE NOTICE 'Spike flow seeded from Story (% states cloned).', (SELECT count(*) FROM flows_states WHERE flows_states_id_flow = new_flow);
END $$;
