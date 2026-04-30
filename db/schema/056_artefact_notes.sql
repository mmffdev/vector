-- ============================================================
-- MMFFDev - Vector: Shared artefact notes (append-only threaded)
-- Migration 056 — applied on top of 055_artefacts_strategic.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 056_artefact_notes.sql
--
-- Single shared table for all artefact types. Polymorphic on
-- (artefact_type, artefact_id). Integrity enforced at service layer
-- via o_artefact_type_registry.
--
-- Append-only: no edit after posting. Thread context is preserved.
-- Soft-delete only (archived_at) for mod/gadmin content removal.
-- parent_note_id enables threading: NULL = top-level, set = reply.
-- ============================================================

BEGIN;

CREATE TABLE o_artefact_notes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    artefact_type   TEXT        NOT NULL REFERENCES o_artefact_type_registry(scope_key) ON DELETE RESTRICT,
    artefact_id     UUID        NOT NULL,
    parent_note_id  UUID        REFERENCES o_artefact_notes(id) ON DELETE SET NULL,
    content         TEXT        NOT NULL,
    created_by      UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at     TIMESTAMPTZ,

    CONSTRAINT o_an_content_nonempty CHECK (length(btrim(content)) > 0)
);

-- Primary query: all notes for an artefact in thread order.
CREATE INDEX idx_o_an_artefact
    ON o_artefact_notes (artefact_type, artefact_id, created_at)
    WHERE archived_at IS NULL;

-- Thread traversal: replies to a given note.
CREATE INDEX idx_o_an_parent
    ON o_artefact_notes (parent_note_id)
    WHERE parent_note_id IS NOT NULL AND archived_at IS NULL;

-- Subscription-scoped moderation queries.
CREATE INDEX idx_o_an_sub
    ON o_artefact_notes (subscription_id, created_at DESC)
    WHERE archived_at IS NULL;

-- ---- Unread tracking -------------------------------------------

CREATE TABLE o_artefact_note_reads (
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artefact_type   TEXT        NOT NULL REFERENCES o_artefact_type_registry(scope_key) ON DELETE CASCADE,
    artefact_id     UUID        NOT NULL,
    last_read_at    TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (user_id, artefact_type, artefact_id)
);

CREATE INDEX idx_o_anr_user
    ON o_artefact_note_reads (user_id, last_read_at DESC);

COMMIT;
