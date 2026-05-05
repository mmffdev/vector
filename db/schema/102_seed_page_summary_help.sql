-- ============================================================
-- 102 — Seed library_help_defaults for panel.page_summary (PLA-0012 / 00400)
--
-- The <PageSummaryHeader> primitive composes <Panel name="page_summary">,
-- which auto-registers an addressable of kind=panel name=page_summary.
-- Without a matching library_help_defaults row, the addressables service
-- falls back to the kind='panel' wildcard ('*') seed — generic copy that
-- does not explain summary cells, warning tones, or the search slot.
--
-- This migration adds a panel-specific row keyed exactly to
-- (kind='panel', name_pattern='page_summary', locale='en'). Lookup is
-- longest-pattern-wins, so the new row will outrank the '*' wildcard for
-- any addressable with name='page_summary'.
--
-- Re-runnable: ON CONFLICT (kind, name_pattern, locale) DO NOTHING.
-- ============================================================

BEGIN;

INSERT INTO library_help_defaults (kind, name_pattern, locale, title, body_html) VALUES
    ('panel', 'page_summary', 'en',
     'Page summary',
     '<p>This strip summarises the page below at a glance. Each cell shows a labelled count or value drawn from the data on the page.</p>'
     '<p><strong>Warning-tone cells</strong> (e.g. <em>Defects</em>, <em>Blocked</em>) paint amber only when their value is greater than zero; resting state stays neutral so the strip does not shout when there is nothing to act on.</p>'
     '<p>If a search box is shown on the right, it filters the rows below by title or key. Cells update to reflect the filtered subset.</p>')
ON CONFLICT (kind, name_pattern, locale) DO NOTHING;

COMMIT;
