-- ============================================================
-- 145_saved_views.sql
--
-- Saved views substrate — Rally-style "Save As New View" /
-- "Manage Saved Views". One table serves multiple consumers via
-- the `kind` discriminator (objecttree | page_layout) and three
-- sharing scopes (user | node | workspace).
--
-- Design: docs/superpowers/specs/2026-05-28-saved-views-design.md
--
-- WHY ONE TABLE: every saved view is the same shape — a JSON body
-- interpreted by its consumer, keyed by (kind, target, scope). The
-- consumer (ObjectTreeV2, future custom pages, etc.) owns the body
-- schema; the table is consumer-agnostic.
--
-- WHY DENORMALISED IDS: every read clamps on (subscription, scope,
-- scope_id, kind, target). Storing the four IDs on the row means
-- single index hit, no joins. Pattern matches `artefacts` table.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS + CREATE OR REPLACE TRIGGER FUNCTION.
--
-- ROLLBACK: db/vector_artefacts/schema/down/145_saved_views_DOWN.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS saved_views (
    saved_views_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    saved_views_id_subscription UUID NOT NULL,

    saved_views_kind            TEXT NOT NULL,
    saved_views_scope           TEXT NOT NULL,

    saved_views_id_user         UUID,
    saved_views_id_node         UUID,
    saved_views_id_workspace    UUID,

    saved_views_target          TEXT NOT NULL,
    saved_views_name            TEXT NOT NULL,
    saved_views_body            JSONB NOT NULL DEFAULT '{}'::jsonb,

    saved_views_id_user_created_by UUID NOT NULL,
    saved_views_created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_views_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_views_archived_at     TIMESTAMPTZ,

    CONSTRAINT saved_views_kind_check
        CHECK (saved_views_kind IN ('objecttree', 'page_layout')),

    CONSTRAINT saved_views_scope_check
        CHECK (saved_views_scope IN ('user', 'node', 'workspace')),

    CONSTRAINT saved_views_one_scope_id
        CHECK (
            (saved_views_scope = 'user'      AND saved_views_id_user      IS NOT NULL AND saved_views_id_node IS NULL     AND saved_views_id_workspace IS NULL)
         OR (saved_views_scope = 'node'      AND saved_views_id_user      IS NULL     AND saved_views_id_node IS NOT NULL AND saved_views_id_workspace IS NULL)
         OR (saved_views_scope = 'workspace' AND saved_views_id_user      IS NULL     AND saved_views_id_node IS NULL     AND saved_views_id_workspace IS NOT NULL)
        ),

    CONSTRAINT saved_views_archived_after_created
        CHECK (saved_views_archived_at IS NULL OR saved_views_archived_at >= saved_views_created_at),

    CONSTRAINT saved_views_body_size_cap
        CHECK (octet_length(saved_views_body::text) <= 65536)
);

COMMENT ON TABLE saved_views IS
    'Saved view configurations — Rally-style "Save As New View" / "Manage Saved Views". '
    'One table serves multiple consumers via kind discriminator (objecttree, page_layout). '
    'Scope discriminator (user/node/workspace) controls sharing. '
    'Permission rules enforced in backend/internal/savedviews/service.go.';

COMMENT ON COLUMN saved_views.saved_views_target IS
    'OPAQUE INTERNAL IDENTIFIER following `<kind>:<stable-id>` convention. '
    'Examples: objecttree:work_items, objecttree:risks, future custom_page:<uuid>, '
    'objecttree:custom:<page_uuid>:<instance_uuid>. The ID after the colon is the '
    'STABLE identifier of the resource the view applies to, never the user-visible '
    'name. Names are resolved at render time from source-of-truth tables. '
    'ANTI-PATTERN: do NOT add a denormalised target_label column.';

-- Three partial indexes, one per scope. Postgres can Bitmap-Or when the
-- picker needs all three simultaneously. Each is point-lookup-shaped on
-- its scope column.
CREATE INDEX IF NOT EXISTS saved_views_by_user
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_user,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'user';

CREATE INDEX IF NOT EXISTS saved_views_by_node
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_node,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'node';

CREATE INDEX IF NOT EXISTS saved_views_by_workspace
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_workspace,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'workspace';

CREATE INDEX IF NOT EXISTS saved_views_by_creator
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_user_created_by,
        saved_views_kind
    )
    WHERE saved_views_archived_at IS NULL;

-- updated_at touch trigger (project convention).
CREATE OR REPLACE FUNCTION saved_views_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.saved_views_updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS saved_views_touch_updated_at ON saved_views;
CREATE TRIGGER saved_views_touch_updated_at
    BEFORE UPDATE ON saved_views
    FOR EACH ROW EXECUTE FUNCTION saved_views_touch_updated_at();

COMMIT;
