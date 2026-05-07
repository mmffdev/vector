-- ============================================================
-- MMFFDev - vector_artefacts: artefact_number_sequence
-- Run against vector_artefacts:
--   BACKEND_ENV=local go run ./cmd/migrate/... -db artefacts up
--
-- Per-(subscription, artefact_type) counter used to allocate artefact.number
-- atomically. next_num is the NEXT number to allocate (i.e. INSERT returns
-- next_num - 1).
--
-- Pre-populated from existing artefacts so new inserts continue from the
-- correct offset.
-- ============================================================

BEGIN;

CREATE TABLE artefact_number_sequence (
    subscription_id  UUID NOT NULL,
    artefact_type_id UUID NOT NULL REFERENCES artefact_types(id) ON DELETE RESTRICT,
    next_num         BIGINT NOT NULL DEFAULT 2,
    PRIMARY KEY (subscription_id, artefact_type_id)
);

COMMENT ON TABLE artefact_number_sequence IS
    'Per-(subscription, artefact_type) counter used to allocate artefact.number atomically. '
    'next_num is the NEXT number to allocate (i.e. INSERT returns next_num - 1).';

-- Pre-populate from existing artefacts so new inserts continue from the correct offset.
INSERT INTO artefact_number_sequence (subscription_id, artefact_type_id, next_num)
SELECT
    a.subscription_id,
    a.artefact_type_id,
    COALESCE(MAX(a.number), 0) + 1
FROM artefacts a
GROUP BY a.subscription_id, a.artefact_type_id
ON CONFLICT (subscription_id, artefact_type_id) DO NOTHING;

COMMIT;
