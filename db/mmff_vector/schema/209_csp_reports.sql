-- 209_csp_reports.sql
-- Stores browser-reported CSP violations from /_site/csp-report
-- (TD-SEC-CSP-NONCES-SRI Phase 2). Unauthenticated endpoint so this
-- table accepts rows from pre-login pages too (subscription_id is
-- nullable). Used during the Phase 4 Report-Only soak and as an
-- ongoing detection surface after Phase 5 flips to enforce.

BEGIN;

CREATE TABLE csp_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at           timestamptz NOT NULL DEFAULT now(),
  document_uri          text,
  referrer              text,
  violated_directive    text,
  effective_directive   text,
  original_policy       text,
  disposition           text,            -- 'enforce' | 'report' on modern Reporting API
  blocked_uri           text,
  source_file           text,
  line_number           int,
  column_number         int,
  status_code           int,
  user_agent            text,
  remote_ip             inet,
  raw                   jsonb NOT NULL,  -- full original payload for forensics
  subscription_id       uuid             -- nullable: pre-login pages report without a session
);

-- Hot index: "what's been violating in the last hour?" — used during
-- the Phase 4 soak and ongoing operations.
CREATE INDEX idx_csp_reports_received_at_desc
  ON csp_reports (received_at DESC);

-- Group-by-directive query for the soak summary at the end of Phase 4.
CREATE INDEX idx_csp_reports_violated_directive
  ON csp_reports (violated_directive, received_at DESC);

COMMENT ON TABLE csp_reports IS
  'Browser CSP violation reports received at /_site/csp-report. '
  'Subscription nullable because pre-login pages (login, reset, help) '
  'also report. See TD-SEC-CSP-NONCES-SRI in docs/c_tech_debt.md.';

INSERT INTO schema_migrations (filename) VALUES ('209_csp_reports.sql');

COMMIT;
