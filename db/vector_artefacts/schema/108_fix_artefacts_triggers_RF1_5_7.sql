-- ============================================================
-- 108_fix_artefacts_triggers_RF1_5_7.sql
--
-- RF1.5.7 — Wave-7 trigger-function repair (vector_artefacts side).
--
-- After 107 renames every bare column on `artefacts`, the two
-- triggers on the table need their function bodies and (in one
-- case) their binding repaired:
--
--   1. trg artefacts_set_updated_at — currently uses the shared
--      set_updated_at() which references NEW.updated_at. Post-107
--      that column is artefacts_updated_at, so any UPDATE on the
--      table would throw:
--        ERROR:  record "new" has no field "updated_at"
--      Per the wave-1/2/3/4/6a precedent (256, 260, 263, 104, 265),
--      route this table onto its own artefacts_set_updated_at()
--      function. The shared set_updated_at() is left intact for any
--      remaining tables that still use it; final cleanup happens
--      once Pillar 1 is fully shipped across both DBs.
--
--   2. trg artefacts_search_enqueue — bespoke function
--      artefacts_search_enqueue() references NEW.id explicitly
--      (now NEW.artefacts_id). It also INSERTs into the now-prefixed
--      artefacts_search_outbox(artefact_id) — after wave-5 (105) that
--      column is artefacts_search_outbox_id_artefact. Both refs
--      get repaired. The trigger BINDING also references column
--      names in `UPDATE OF title, description` — re-bound here to
--      `UPDATE OF artefacts_title, artefacts_description`.
--
-- Wave 7 is the final wave on the vector_artefacts side (modulo the
-- JSON wire-tag follow-up). After this migration applies, every table
-- in vector_artefacts is fully prefixed and every trigger function on
-- those tables has been repaired.
-- ============================================================

BEGIN;

-- ---- artefacts.set_updated_at — per-table function ----

CREATE OR REPLACE FUNCTION artefacts_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.artefacts_updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Re-bind the trigger to the new per-table function.
-- The trigger NAME already happens to match the new function name —
-- DROP then re-CREATE to switch the binding cleanly.
DROP TRIGGER IF EXISTS artefacts_set_updated_at ON artefacts;
CREATE TRIGGER artefacts_set_updated_at
    BEFORE UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_set_updated_at();

-- ---- artefacts_search_enqueue — body + binding ----
--
-- Pre-107 references:
--   NEW.id  → NEW.artefacts_id
-- INSERT target column on outbox (post-105):
--   artefacts_search_outbox(artefact_id)
--     → artefacts_search_outbox(artefacts_search_outbox_id_artefact)
-- pg_notify payload stays the same (artefact UUID as text).
CREATE OR REPLACE FUNCTION artefacts_search_enqueue() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO artefacts_search_outbox (artefacts_search_outbox_id_artefact)
    VALUES (NEW.artefacts_id)
    ON CONFLICT DO NOTHING;
    PERFORM pg_notify('search_index_queue', NEW.artefacts_id::text);
    RETURN NEW;
END;
$$;

-- Re-bind the trigger so its `UPDATE OF title, description` clause
-- tracks the rename to artefacts_title / artefacts_description.
DROP TRIGGER IF EXISTS artefacts_search_enqueue ON artefacts;
CREATE TRIGGER artefacts_search_enqueue
    AFTER INSERT OR UPDATE OF artefacts_title, artefacts_description ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_search_enqueue();

COMMIT;
