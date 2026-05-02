-- ============================================================
-- 074 — page_addressables: universal addressable element registry
--
-- Every panel, table, navigation block, and addressable element
-- in the product is one row here. Source of truth for the
-- substrate that supersedes the paneId string registry from 071.
--
-- Address form: samantha._viewport.<slot>._kind.name[._kind.name…]
-- with leading underscore on every system segment so the address
-- self-tokenizes (segments alternate _system / user-name).
--
-- Six closed-vocabulary viewport slots:
--   app | header | footer | side_bar | modal | toast
--
-- Sole writer: backend/internal/addressables/service.go (PLA-0005
-- story 00246). Direct INSERTs from anywhere else are forbidden
-- and policed by the ripgrep CI test (story 00260).
--
-- Sources:
--   build       — declared at build time via reconcile job
--   runtime     — registered by a live mount in dev mode (page
--                 newly authored, not yet reconciled)
--   custom_app  — registered by a Samantha SDK custom app at runtime
--
-- Build wins: source='build' rows refuse runtime overwrites.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS page_addressables (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       UUID        REFERENCES page_addressables(id) ON DELETE CASCADE,
    kind            TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    address         TEXT        NOT NULL,
    page_route      TEXT        NOT NULL,
    source          TEXT        NOT NULL CHECK (source IN ('build', 'runtime', 'custom_app')),
    custom_app_id   UUID,
    soft_archived   BOOLEAN     NOT NULL DEFAULT FALSE,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sibling-uniqueness: within a given parent, the (kind, name) pair
-- must be unique among live (non-archived) rows. Archived siblings
-- can share the triple so we keep history without blocking re-adds.
CREATE UNIQUE INDEX IF NOT EXISTS page_addressables_sibling_unique
    ON page_addressables (parent_id, kind, name)
    WHERE soft_archived = FALSE;

-- For root-level (parent_id IS NULL) the partial index above does
-- not enforce uniqueness across NULLs, so add a second partial
-- index that treats NULL parents as a single bucket per page_route.
CREATE UNIQUE INDEX IF NOT EXISTS page_addressables_root_unique
    ON page_addressables (page_route, kind, name)
    WHERE soft_archived = FALSE AND parent_id IS NULL;

-- Snapshot read path: GET /api/addressables/snapshot resolves by
-- address; partial index keeps it fast and skips tombstones.
CREATE INDEX IF NOT EXISTS page_addressables_address_idx
    ON page_addressables (address)
    WHERE soft_archived = FALSE;

-- Snapshot read path keyed by route (per-page snapshot bundle).
CREATE INDEX IF NOT EXISTS page_addressables_route_idx
    ON page_addressables (page_route, soft_archived);

-- last_seen_at is the GC marker for runtime-source rows that have
-- not been mounted in N days; the reconciler uses this to soft-archive
-- stale runtime/custom_app rows. Build rows are immune to GC.
CREATE INDEX IF NOT EXISTS page_addressables_gc_idx
    ON page_addressables (last_seen_at)
    WHERE source IN ('runtime', 'custom_app') AND soft_archived = FALSE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION page_addressables_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_addressables_updated_at ON page_addressables;
CREATE TRIGGER page_addressables_updated_at
    BEFORE UPDATE ON page_addressables
    FOR EACH ROW EXECUTE FUNCTION page_addressables_set_updated_at();

COMMIT;
