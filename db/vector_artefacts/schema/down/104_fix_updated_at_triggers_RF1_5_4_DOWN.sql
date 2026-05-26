-- ============================================================
-- DOWN: 104_fix_updated_at_triggers_RF1_5_4_DOWN.sql
-- Reverts wave-3 trigger-function repair. Restores per-table
-- function bodies to NEW.updated_at and re-binds triggers to
-- shared set_updated_at() where appropriate. Use only if you've
-- also reverted 094–103.
-- ============================================================

BEGIN;

-- artefacts_adoption_states
CREATE OR REPLACE FUNCTION artefact_adoption_state_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_artefacts_adoption_states_updated_at ON artefacts_adoption_states;
CREATE TRIGGER trg_artefact_adoption_state_updated_at
    BEFORE UPDATE ON artefacts_adoption_states
    FOR EACH ROW EXECUTE FUNCTION artefact_adoption_state_set_updated_at();
DROP FUNCTION IF EXISTS artefacts_adoption_states_set_updated_at();

-- topology_nodes
CREATE OR REPLACE FUNCTION topology_nodes_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- artefacts_fields_library
DROP TRIGGER IF EXISTS trg_artefacts_fields_library_updated_at ON artefacts_fields_library;
CREATE TRIGGER artefact_field_library_set_updated_at
    BEFORE UPDATE ON artefacts_fields_library
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS artefacts_fields_library_set_updated_at();

-- artefacts_types_fields
DROP TRIGGER IF EXISTS trg_artefacts_types_fields_updated_at ON artefacts_types_fields;
CREATE TRIGGER artefact_type_fields_set_updated_at
    BEFORE UPDATE ON artefacts_types_fields
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS artefacts_types_fields_set_updated_at();

COMMIT;
