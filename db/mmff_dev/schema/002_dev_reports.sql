-- ============================================================
-- Migration 002: dev_reports table
-- ============================================================
-- Purpose: hold dev-area reports (research, plans, security audits,
-- retrospectives, codebase analyses, api audits) that used to live as
-- JSON files in dev/<type>/. Each row is exactly one report.
--
-- Render contract: the `content` column holds pre-rendered HTML (the
-- same blob that was the `content` field in the old R###.json files).
-- The viewer drops it into the DOM via dangerouslySetInnerHTML and
-- decorates with TOC scroll-spy. Schema does not parse the HTML.
--
-- ID convention (per CLAUDE.md decision 2026-05-21):
--   RES### research, PLA### plans, SEC### security, RET### retros,
--   COD### codebase, API### api, MIS### misc
-- ============================================================

BEGIN;

CREATE TABLE dev_reports (
    id              TEXT        PRIMARY KEY,
    type            TEXT        NOT NULL CHECK (type IN (
                                    'research','plan','security','retro',
                                    'code','api','misc'
                                )),
    title           TEXT        NOT NULL,
    category        TEXT,
    topic           TEXT,
    summary         TEXT,
    content         TEXT        NOT NULL,
    content_text    TEXT        NOT NULL DEFAULT '',
    payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    report_date     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dev_reports_type_date_idx
    ON dev_reports (type, report_date DESC NULLS LAST, id DESC);

CREATE INDEX dev_reports_payload_gin
    ON dev_reports USING GIN (payload);

CREATE INDEX dev_reports_search_tsv
    ON dev_reports USING GIN (
        to_tsvector('english',
            coalesce(title,'')      || ' ' ||
            coalesce(summary,'')    || ' ' ||
            coalesce(content_text,'')
        )
    );

CREATE OR REPLACE FUNCTION dev_reports_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dev_reports_touch_updated_at
    BEFORE UPDATE ON dev_reports
    FOR EACH ROW
    EXECUTE FUNCTION dev_reports_touch_updated_at();

INSERT INTO schema_migrations (filename) VALUES ('002_dev_reports.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
