-- ============================================================
-- MMFFDev - Vector: Library cleanup job queue (Phase 0 / TD-LIB-003)
-- Migration 019 — applied on top of 018_subscription_tier.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 019_pending_library_cleanup_jobs.sql
--
-- Postgres-backed work queue for the archive saga: when a
-- subscription archives a library-derived entity (preset adoption,
-- portfolio template instance, etc.), the cleanup of cross-DB
-- side-effects has to happen reliably outside the originating txn.
-- Cross-DB transactions don't exist in Postgres, so we enqueue
-- here, commit, and a worker drains via FOR UPDATE SKIP LOCKED.
--
-- Worker contract (see dev/planning/feature_library_db_and_portfolio_presets_v3.md §4):
--   - Claim N rows where status='pending' AND visible_at <= NOW()
--     using SELECT ... FOR UPDATE SKIP LOCKED LIMIT N.
--   - Execute the cleanup (call library write API, delete tenant
--     mirror rows, etc.).
--   - On success: DELETE the row.
--   - On failure: UPDATE status='pending', attempts=attempts+1,
--     visible_at=NOW() + backoff(attempts), last_error=msg.
--   - When attempts >= max_attempts: status='dead' for ops review.
-- ============================================================

BEGIN;

CREATE TABLE pending_library_cleanup_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,

    -- What kind of cleanup this row represents. Vocabulary owned by
    -- the worker code; CHECK keeps writers from inventing new kinds.
    job_kind        TEXT        NOT NULL CHECK (job_kind IN (
                        'preset_archive_propagation',
                        'template_instance_unlink',
                        'library_mirror_purge'
                    )),

    -- Free-form payload the worker needs to execute the job
    -- (entity ids, library row references, etc.). Keep small.
    payload         JSONB       NOT NULL,

    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','dead')),
    attempts        INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts    INT         NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
    last_error      TEXT,

    -- Earliest time a worker may claim this row. Updated on retry
    -- with exponential backoff. NOW() at insert means immediate.
    visible_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: workers poll for "pending and visible". Partial index
-- keeps it small as 'dead' rows accumulate.
CREATE INDEX idx_pending_library_cleanup_jobs_claimable
    ON pending_library_cleanup_jobs (visible_at)
    WHERE status = 'pending';

-- Ops queries: "show me dead-letter rows for this subscription".
CREATE INDEX idx_pending_library_cleanup_jobs_dead
    ON pending_library_cleanup_jobs (subscription_id, updated_at DESC)
    WHERE status = 'dead';

CREATE TRIGGER trg_pending_library_cleanup_jobs_updated_at
    BEFORE UPDATE ON pending_library_cleanup_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE pending_library_cleanup_jobs IS
    'Postgres-backed work queue for cross-DB cleanup of library-derived entities. '
    'Claimed via SELECT ... FOR UPDATE SKIP LOCKED. See feature_library_db_and_portfolio_presets_v3.md §4.';

COMMIT;
