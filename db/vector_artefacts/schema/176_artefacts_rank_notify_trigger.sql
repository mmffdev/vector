-- ============================================================
-- 176_artefacts_rank_notify_trigger.sql
--
-- Cross-tab / cross-client live rank sync for the /scope grid.
--
-- WHY:
--   The realtime WS stack (backend/internal/realtime: hub + StartRankListener
--   LISTENing on channel `rank_changed` + the frontend useRefetchOnPush hook)
--   was purpose-built for Rally-style "reorder in one tab/client → every other
--   connected session refetches the list". But the publishing trigger lived in
--   the now-DROPPED mmff_vector DB (db/mmff_vector/schema/069_ranking_notify_
--   trigger.sql, attached to o_artefacts_execution_work_items). It was never
--   ported to the live `artefacts` table in vector_artefacts, so /rank/move
--   writes artefacts_position and fires NOTHING — the listener hears nothing,
--   and no tab/client ever learns a rank changed. This migration restores the
--   publisher on the live table.
--
-- WHAT:
--   notify_rank_changed() — generic AFTER trigger fn; resource type is a
--   trigger argument (TG_ARGV[0]) so one fn serves any future adopter table.
--   Emits a jsonb payload on pg_notify('rank_changed', …) matching the Go
--   listener contract (backend/internal/realtime/listener.go:17-22):
--     { resource_type, subscription_id, scope, scope_id, row_id, op }.
--
-- SCOPE MODEL (Rally global rank, per commit 0e349072 / main.go ranking
--   Register): rank is a SINGLE workspace-global namespace
--   (ScopeColumn = artefacts_id_workspace), NOT per-sprint. So every event
--   uses scope='backlog', scope_id=NULL — one topic per (resource, sub). The
--   frontend subscribes with rankTopic("work_item", subID, "backlog", null),
--   yielding the identical topic string `rank:work_item:<sub>:backlog:`.
--
-- NOISE CONTROL: on UPDATE we only NOTIFY when artefacts_position actually
--   changed. Every artefact UPDATE (title edits, status changes, the
--   updated_at touch trigger) would otherwise fire a rank NOTIFY and storm
--   every connected client with pointless refetches.
--
-- COLUMN PREFIX: all columns carry the full-table-name prefix per the
--   project HARD RULE (artefacts_id, artefacts_id_subscription,
--   artefacts_position) — unlike the legacy 069 which used bare id/sprint_id.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION notify_rank_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rec          record;
    resource_arg text;
    payload      jsonb;
BEGIN
    -- Resource type passed as a trigger argument so one function serves
    -- every adopter table (work_item today; future orderable resources later).
    resource_arg := TG_ARGV[0];

    IF (TG_OP = 'DELETE') THEN
        rec := OLD;
    ELSE
        rec := NEW;
    END IF;

    -- Rally global rank: one workspace-wide namespace, no per-sprint scoping.
    payload := jsonb_build_object(
        'resource_type',   resource_arg,
        'subscription_id', rec.artefacts_id_subscription,
        'scope',           'backlog',
        'scope_id',        NULL,
        'row_id',          rec.artefacts_id,
        'op',              TG_OP
    );

    -- pg_notify is async; fixed channel name, payload well under the 8000-byte
    -- NOTIFY limit. The StartRankListener Go goroutine republishes to the WS hub.
    PERFORM pg_notify('rank_changed', payload::text);

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- Separate INSERT/DELETE trigger (always fires — a new or removed row always
-- shifts the dense Prio rank) from the UPDATE trigger (fires only when the
-- position column actually moves), so unrelated artefact edits don't storm
-- every connected client with refetches.
DROP TRIGGER IF EXISTS trg_artefacts_rank_changed_ins_del ON artefacts;
CREATE TRIGGER trg_artefacts_rank_changed_ins_del
    AFTER INSERT OR DELETE
    ON artefacts
    FOR EACH ROW
    EXECUTE FUNCTION notify_rank_changed('work_item');

DROP TRIGGER IF EXISTS trg_artefacts_rank_changed_upd ON artefacts;
CREATE TRIGGER trg_artefacts_rank_changed_upd
    AFTER UPDATE OF artefacts_position
    ON artefacts
    FOR EACH ROW
    WHEN (OLD.artefacts_position IS DISTINCT FROM NEW.artefacts_position)
    EXECUTE FUNCTION notify_rank_changed('work_item');

-- schema_migrations row is inserted by the runner (backend/cmd/migrate),
-- not the migration body — matches every other file in this directory.

COMMIT;
