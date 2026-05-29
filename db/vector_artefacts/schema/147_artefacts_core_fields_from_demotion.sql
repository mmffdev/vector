-- ============================================================
-- 147_artefacts_core_fields_from_demotion.sql
--
-- Core-field demotion (Phase B) — promote 17 fields out of the
-- artefacts_fields_library catalogue and onto artefacts as
-- first-class columns. 18 new columns total (notes splits into
-- text + jsonb to mirror description / description_doc).
--
-- Design: docs/superpowers/specs/2026-05-29-core-field-demotion-design.md
--
-- COLUMN-NAMING HARD RULE: every column on artefacts is prefixed
-- with the full table name (artefacts_*). No abbreviations, no
-- registry — the table name itself is the prefix. See
-- .claude/CLAUDE.md HARD RULE on column prefixing.
--
-- NOTES vs NOTES_DOC: matches the description / description_doc
-- pattern already on artefacts. The plain text column is the
-- search-indexable surface; the jsonb column carries the rich
-- TipTap document tree.
--
-- BOOLEAN DEFAULTS: is_expedite / is_ready / affects_doc are
-- NOT NULL DEFAULT false so existing rows stay valid and queries
-- never need IS DISTINCT FROM logic.
--
-- PARTIAL INDEXES: is_expedite + is_ready mirror the existing
-- idx_artefacts_id_subscription_blocked shape — predicate-narrowed
-- on (flag = true AND archived_at IS NULL) so they only cover the
-- "find live expedited / ready" query path. affects_doc has no
-- equivalent query yet so no index — add later if a usage appears.
--
-- CHECK CONSTRAINTS: defect_severity + defect_status are enum-
-- shaped text columns. CHECK constraint lists allowed values,
-- mirroring artefacts_fields_library_field_type_chk. NULL allowed
-- because not every artefact has a defect classification.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS. The two ADD CONSTRAINT lines have no IF NOT EXISTS
-- guard (Postgres doesn't support it for ADD CONSTRAINT) so a
-- re-apply will error on the second run; the constraints are
-- named explicitly so they're easy to drop+re-add manually if
-- needed. The DOWN script DROP CONSTRAINT IF EXISTS handles the
-- forward path cleanly.
--
-- ROLLBACK: db/vector_artefacts/schema/down/147_artefacts_core_fields_from_demotion_DOWN.sql
-- ============================================================

BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_defect_severity            text,
    ADD COLUMN IF NOT EXISTS artefacts_environment                text,
    ADD COLUMN IF NOT EXISTS artefacts_estimate_hours             numeric,
    ADD COLUMN IF NOT EXISTS artefacts_estimate_remaining         numeric,
    ADD COLUMN IF NOT EXISTS artefacts_is_expedite                boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS artefacts_notes                      text,
    ADD COLUMN IF NOT EXISTS artefacts_notes_doc                  jsonb,
    ADD COLUMN IF NOT EXISTS artefacts_planned_finish_date        date,
    ADD COLUMN IF NOT EXISTS artefacts_planned_start_date         date,
    ADD COLUMN IF NOT EXISTS artefacts_actual_start_date          date,
    ADD COLUMN IF NOT EXISTS artefacts_estimate_initial           numeric,
    ADD COLUMN IF NOT EXISTS artefacts_estimate_updated           numeric,
    ADD COLUMN IF NOT EXISTS artefacts_flow_state_changed_at      timestamptz,
    ADD COLUMN IF NOT EXISTS artefacts_strategic_investment_group text,
    ADD COLUMN IF NOT EXISTS artefacts_is_ready                   boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS artefacts_affects_doc                boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS artefacts_count_child_test_cases     integer     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS artefacts_defect_status              text;

-- Partial indexes — mirror idx_artefacts_id_subscription_blocked shape.
CREATE INDEX IF NOT EXISTS idx_artefacts_id_subscription_expedite
    ON artefacts (artefacts_id_subscription)
    WHERE artefacts_is_expedite = true
      AND artefacts_archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_artefacts_id_subscription_ready
    ON artefacts (artefacts_id_subscription)
    WHERE artefacts_is_ready = true
      AND artefacts_archived_at IS NULL;

-- CHECK constraints on enum-shaped text columns.
ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_severity_chk
        CHECK (artefacts_defect_severity IS NULL
            OR artefacts_defect_severity = ANY (ARRAY['low','medium','high','critical']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_status_chk
        CHECK (artefacts_defect_status IS NULL
            OR artefacts_defect_status   = ANY (ARRAY['open','triaged','in_progress','fixed','verified','closed','wontfix','duplicate']));

COMMIT;
