-- ============================================================
-- 104_fix_updated_at_triggers_RF1_5_4.sql
--
-- RF1.5.4 — Wave-3 trigger-function repair (vector_artefacts side).
--
-- Repairs the same latent defect 256 fixes on mmff_vector:
-- per-table set_updated_at functions reference NEW.updated_at
-- but the column was renamed to <table>_updated_at.
--
-- Tables touched in wave 3:
--   - artefacts_adoption_states (artefact_adoption_state_set_updated_at)
--   - topology_nodes            (topology_nodes_set_updated_at)
--
-- artefacts_fields_library + artefacts_types_fields use the shared
-- set_updated_at() — they're broken too, but the shared function is
-- also used by artefacts (not yet swept), so we route them to new
-- per-table functions here and leave the shared one for now. When
-- artefacts is swept, its wave will give it its own function too
-- and we can drop the shared set_updated_at() in a final cleanup.
-- ============================================================

BEGIN;

-- ---- artefacts_adoption_states ----
CREATE OR REPLACE FUNCTION artefacts_adoption_states_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.artefacts_adoption_states_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_artefact_adoption_state_updated_at ON artefacts_adoption_states;
CREATE TRIGGER trg_artefacts_adoption_states_updated_at
    BEFORE UPDATE ON artefacts_adoption_states
    FOR EACH ROW EXECUTE FUNCTION artefacts_adoption_states_set_updated_at();

DROP FUNCTION IF EXISTS artefact_adoption_state_set_updated_at();

-- ---- topology_nodes ----
CREATE OR REPLACE FUNCTION topology_nodes_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.topology_nodes_updated_at = NOW();
    RETURN NEW;
END;
$$;

-- (trigger binding unchanged — trg_topology_nodes_updated_at already
--  points at topology_nodes_set_updated_at; only the body changes)

-- ---- artefacts_fields_library ----
CREATE OR REPLACE FUNCTION artefacts_fields_library_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.artefacts_fields_library_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS artefact_field_library_set_updated_at ON artefacts_fields_library;
CREATE TRIGGER trg_artefacts_fields_library_updated_at
    BEFORE UPDATE ON artefacts_fields_library
    FOR EACH ROW EXECUTE FUNCTION artefacts_fields_library_set_updated_at();

-- ---- artefacts_types_fields ----
CREATE OR REPLACE FUNCTION artefacts_types_fields_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.artefacts_types_fields_updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS artefact_type_fields_set_updated_at ON artefacts_types_fields;
CREATE TRIGGER trg_artefacts_types_fields_updated_at
    BEFORE UPDATE ON artefacts_types_fields
    FOR EACH ROW EXECUTE FUNCTION artefacts_types_fields_set_updated_at();

COMMIT;
