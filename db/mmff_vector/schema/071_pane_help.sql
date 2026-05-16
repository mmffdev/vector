-- ============================================================
-- 071 — pane_help: gadmin-editable help copy per <PaneHeader>
--
-- Backs the popover opened by clicking the TbHelpHexagon icon
-- on every panel. paneId is the registry key (see
-- dev/registries/paneIds.json); body_html is the HTML rendered
-- inside the popover.
--
-- Read by: GET /api/pane-help (bulk, 60s server cache).
-- Written by: PUT /api/pane-help/:paneId (gadmin-only, sanitised).
--
-- Seeded with the five nav-prefs panes that adopted <PaneHeader>
-- in stories 00237 + 00238.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pane_help (
    paneid              TEXT        PRIMARY KEY,
    body_html           TEXT        NOT NULL DEFAULT '',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO pane_help (paneid, body_html) VALUES
    ('nav-prefs.available',  '<p>Drag a pane from this list onto Custom Navigation or Pinned to make it appear in your sidebar. Panes already in use show a faded state but stay draggable so you can put them in a second slot.</p>'),
    ('nav-prefs.custom-nav', '<p>Your personal sidebar layout. Drag rows to reorder, drop a pane from Available Panes to add it, drop on a header row to start a new group.</p>'),
    ('nav-prefs.pinned',     '<p>Panes pinned here render above Custom Navigation in the sidebar so they are always one click away. Drag to reorder; drop back into Available Panes to unpin.</p>'),
    ('nav-prefs.new-page',   '<p>Create a blank page (URL <code>/p/&lt;uuid&gt;</code>) that you can later fill with apps and charts. The page becomes available as a draggable pane in Available Panes immediately.</p>'),
    ('nav-prefs.new-group',  '<p>Create a header row for grouping panes inside Custom Navigation. Groups are collapsible, draggable, and render as a section heading in the sidebar.</p>')
ON CONFLICT (paneid) DO NOTHING;

COMMIT;
