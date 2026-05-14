-- ============================================================
-- MMFFDev - mmff_library: Release-channel tables (Phase 3)
-- Run against the mmff_library database:
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 006_release_channel.sql
--
-- Plan §12: a release-notification channel that lets MMFF publish
-- library updates and gives subscribers an upgrade path.
--
-- Three tables ship here:
--   library_releases        — one row per published release
--   library_release_actions — payloads describing what each release does
--   library_release_log     — append-only audit of who applied what
--
-- Acknowledgements live in mmff_vector (per-subscription state); see
-- db/schema/021_library_acknowledgements.sql.
--
-- Grants for these tables ship in 007_grants_release_channel.sql so the
-- two files compose cleanly with the Phase-1 grant matrix.
-- ============================================================

BEGIN;

-- ─── 12.1 library_releases ──────────────────────────────────────────
CREATE TABLE library_releases (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    library_version           TEXT        NOT NULL,
    title                     TEXT        NOT NULL,
    summary_md                TEXT        NOT NULL,
    body_md                   TEXT,
    severity                  TEXT        NOT NULL CHECK (severity IN ('info','action','breaking')),
    audience_tier             TEXT[],                                          -- NULL = all tiers
    audience_subscription_ids UUID[],                                          -- NULL = all subscriptions
    affects_model_family_id   UUID,                                            -- nullable: not every release targets a family
    released_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at                TIMESTAMPTZ,
    archived_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Idempotency key for ON CONFLICT in release artifacts (plan §13).
    UNIQUE (library_version, title)
);

CREATE INDEX idx_library_releases_active
    ON library_releases (released_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX idx_library_releases_family
    ON library_releases (affects_model_family_id)
    WHERE affects_model_family_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX idx_library_releases_severity
    ON library_releases (severity, released_at DESC)
    WHERE archived_at IS NULL;

CREATE TRIGGER trg_library_releases_updated_at
    BEFORE UPDATE ON library_releases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE library_releases IS
    'Per-release metadata for the notification channel. Published rows surface in '
    'gadmin notifications until acknowledged (acks live in mmff_vector). '
    'See plan §12.1.';
COMMENT ON COLUMN library_releases.severity IS
    'info = banner, action = persistent badge, breaking = blocks /portfolio-model. Plan §12.6.';
COMMENT ON COLUMN library_releases.audience_tier IS
    'NULL = visible to every subscription tier. Otherwise array of tier values from mmff_vector.subscriptions.tier.';

-- ─── 12.2 library_release_actions ───────────────────────────────────
CREATE TABLE library_release_actions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id  UUID        NOT NULL REFERENCES library_releases(id) ON DELETE CASCADE,
    action_key  TEXT        NOT NULL CHECK (action_key IN
                    ('upgrade_model','review_terminology','enable_flag','dismissed')),
    label       TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sort_order  INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (release_id, action_key)
);

CREATE INDEX idx_library_release_actions_release
    ON library_release_actions (release_id, sort_order);

CREATE TRIGGER trg_library_release_actions_updated_at
    BEFORE UPDATE ON library_release_actions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE library_release_actions IS
    'Per-release suggested actions (upgrade model, review terminology, enable flag, '
    'dismissable). Plan §12.2.';

-- ─── 12.4 library_release_log ───────────────────────────────────────
-- Insert-only by contract; enforced at the grant layer (admin INSERT/SELECT,
-- publish INSERT-only, ack/ro have no access). UPDATE/DELETE blocked by
-- a trigger as defence-in-depth in case a future grant changes drift.
CREATE TABLE library_release_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    library_version TEXT        NOT NULL,
    release_id      UUID        REFERENCES library_releases(id) ON DELETE SET NULL,
    file_name       TEXT        NOT NULL,
    sha256          TEXT        NOT NULL,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by      TEXT        NOT NULL DEFAULT current_user
);

CREATE INDEX idx_library_release_log_version
    ON library_release_log (library_version, applied_at DESC);

CREATE INDEX idx_library_release_log_release
    ON library_release_log (release_id) WHERE release_id IS NOT NULL;

-- Belt-and-braces: block any UPDATE/DELETE no matter who tries.
CREATE OR REPLACE FUNCTION trg_library_release_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'library_release_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_library_release_log_no_update
    BEFORE UPDATE OR DELETE ON library_release_log
    FOR EACH ROW EXECUTE FUNCTION trg_library_release_log_immutable();

COMMENT ON TABLE library_release_log IS
    'Append-only audit of release artifacts applied to mmff_library. Plan §12.4. '
    'UPDATE/DELETE blocked by trigger; grant matrix also denies UPDATE/DELETE.';

COMMIT;
