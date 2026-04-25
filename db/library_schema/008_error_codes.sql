-- ============================================================
-- MMFFDev - mmff_library: error_codes table + seed (Phase 4 prep)
-- Run against the mmff_library database:
--   docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 008_error_codes.sql
--
-- Read-only global table mapping stable error code strings to a severity,
-- a category, and paired user-facing / dev-facing messages. MMFF-authored
-- only — there is no per-subscription override path. If a code becomes
-- obsolete, MMFF ships a follow-up migration that DELETEs or supersedes
-- it (no archived_at / updated_at — see header comment below).
--
-- Severity vocabulary (CHECK constraint):
--   info     — informational; no remediation required.
--   warning  — operation succeeded with caveats; user should review.
--   error    — operation failed; user can retry or correct input.
--   critical — operation failed and the system is in a degraded state;
--              gadmin attention required.
-- The four-level scale is the conventional Syslog/Sentry-style ladder
-- collapsed to the levels Vector actually distinguishes in handlers
-- (debug/notice are dev-log noise and not surfaced to users; alert/
-- emergency are pager-duty concepts the app does not raise itself).
--
-- Category vocabulary (CHECK constraint):
--   adoption    — portfolio-model adoption pipeline (Phase 4).
--   library     — generic mmff_library reads / fetcher / publish path.
--   auth        — login, session, MFA, LDAP.
--   validation  — input validation surfaced from handlers.
-- The set is intentionally coarse; refine only when a real handler
-- needs a code that doesn't fit. Add a CHECK update in a follow-up
-- migration rather than letting the column drift.
--
-- Grants are inlined in this file (single table, small surface). Pattern
-- mirrors 005_grants.sql / 007_grants_release_channel.sql:
--   admin   — ALL
--   ro      — SELECT
--   publish — SELECT (read-only reference data; MMFF authors via admin)
--   ack     — SELECT
-- The CI canary at backend/internal/librarydb/grants_test.go must be
-- updated in lockstep — see referenceTableList() helper.
-- ============================================================

BEGIN;

-- ─── error_codes ────────────────────────────────────────────────────
CREATE TABLE error_codes (
    code         TEXT        PRIMARY KEY,
    severity     TEXT        NOT NULL CHECK (severity IN ('info','warning','error','critical')),
    category     TEXT        NOT NULL CHECK (category IN ('adoption','library','auth','validation')),
    user_message TEXT        NOT NULL,
    dev_message  TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_error_codes_category ON error_codes (category);

COMMENT ON TABLE error_codes IS
    'MMFF-authored read-only catalogue of error codes. Callers reference '
    'rows by code (TEXT PK). No archived_at / updated_at: obsolete codes '
    'are removed or superseded via follow-up migration.';
COMMENT ON COLUMN error_codes.code IS
    'Human-meaningful stable identifier (e.g. ADOPT_STEP_FAIL_LAYERS). '
    'Treated as an API contract — never repurpose or rename.';
COMMENT ON COLUMN error_codes.severity IS
    'info | warning | error | critical. See migration header for definitions.';
COMMENT ON COLUMN error_codes.category IS
    'adoption | library | auth | validation. CHECK-constrained vocabulary.';
COMMENT ON COLUMN error_codes.user_message IS
    'Short, user-facing, no jargon. Surfaced verbatim in the UI.';
COMMENT ON COLUMN error_codes.dev_message IS
    'Long, dev-facing. May include hints about what went wrong and what '
    'to check; logged but not shown to end users.';

-- ─── Seed: adoption error codes (Phase 4 starter set) ──────────────
-- Phase-4 plan (dev/planning/feature_library_db_and_portfolio_presets_v3.md)
-- does not list explicit code strings; this seed is a starter set covering
-- the failure modes called out in the adoption section (§5, §10, §13):
-- bundle-not-found, layer-create-failed, terminology-conflict,
-- rollback-required, generic-internal. Plus a precondition error for the
-- "no bundle adopted" guard called out in the card.
INSERT INTO error_codes (code, severity, category, user_message, dev_message) VALUES
    ('ADOPT_PRECONDITION_NO_BUNDLE',
     'error', 'adoption',
     'No portfolio model is adopted for this subscription yet. Adopt a model before continuing.',
     'Adoption precondition failed: subscription_portfolio_model_state has no row for the active subscription. Caller invoked an adoption-dependent path before initial adoption. Check the route guard and the empty-state UI.'),
    ('ADOPT_BUNDLE_NOT_FOUND',
     'error', 'adoption',
     'The selected portfolio model is no longer available. Pick a different model and try again.',
     'mmff_library lookup by (model_family_id, version) returned no row, OR the row exists but archived_at IS NOT NULL. Confirm the bundle was published and not retracted. See plan §5 (adoption identity) and §10 (cross-DB cookbook).'),
    ('ADOPT_STEP_FAIL_LAYERS',
     'error', 'adoption',
     'We could not finish setting up the model. Please try again, or contact support if this keeps happening.',
     'Adoption step failed while creating subscription-side mirror rows for portfolio_model_layers. Tx was rolled back; partial state should not exist. Check backend logs for the underlying SQL error and re-run; if persistent, inspect the bundle for layer-shape drift.'),
    ('ADOPT_TERMINOLOGY_CONFLICT',
     'warning', 'adoption',
     'Some terms in the new model conflict with terms you have already customised. Review and resolve before continuing.',
     'Three-way merge detected a terminology conflict: subscription override differs from both the prior library default and the new library default. Surface the diff in the adoption review UI; do not auto-resolve. See plan §10 (three-way merge basis columns).'),
    ('ADOPT_ROLLBACK_REQUIRED',
     'critical', 'adoption',
     'The model update could not complete and has been rolled back. Your previous setup is unchanged.',
     'Adoption transaction reached the post-commit re-validation step (plan §10) and detected a stale snapshot — library row archived between snapshot and tenant commit. Compensating action ran; subscription remains on prior version. gadmin notification should fire via the release channel.'),
    ('ADOPT_INTERNAL',
     'critical', 'adoption',
     'Something went wrong on our end. Please try again in a few minutes.',
     'Generic internal error in the adoption pipeline — use only when a more specific code does not apply. Check the request id in the structured log to trace; promote to a specific code if this is observed in the wild.');

-- ─── Grants ─────────────────────────────────────────────────────────
-- mmff_library_admin: ALL (writes seed data via this migration + future supersedes).
GRANT ALL PRIVILEGES ON error_codes TO mmff_library_admin;

-- mmff_library_ro: SELECT (request-path reads).
GRANT SELECT ON error_codes TO mmff_library_ro;

-- mmff_library_publish: SELECT only. error_codes is reference data, NOT
-- something the publish path writes. Grant SELECT so publish-path code
-- can resolve a code → message without needing a second pool.
GRANT SELECT ON error_codes TO mmff_library_publish;

-- mmff_library_ack: SELECT. The ack workflow surfaces error codes when a
-- release acknowledgement fails validation.
GRANT SELECT ON error_codes TO mmff_library_ack;

COMMIT;
