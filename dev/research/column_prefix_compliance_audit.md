# Column-prefix compliance audit — Rule 1 (schema columns) + Rule 2 (custom-field rows)

**Date:** 2026-05-29
**Scope:** `vector_artefacts` only (mmff_library is EXEMPT per existing HARD RULE).
**Method:** Read-only SELECT against the live dev DB via tunnel `127.0.0.1:5435` (`\conninfo` confirms database `vector_artefacts`, user `mmff_dev`, host `::1`). No writes, no git, no code edits.
**Auditor:** Claude Opus 4.7

---

## H. Numbers summary

```
Total tables in vector_artefacts:                          88
Total columns in vector_artefacts:                         930
Rule 1 compliant columns:                                  930   (100.00%)
  - compliant_pk  (column = <table>_id):                    74
  - compliant     (column starts with <table>_):           856
Rule 1 VIOLATIONS:                                          0   (0.00%)
  - Legacy/pre-rule:                                         0
  - mmff_v merge survivors:                                  0
  - Substrate-shared (exempt):                               0
  - Recent rule break (REGRESSION):                          0
Tables fully compliant:                                    88
Tables with 1+ violation:                                   0

Total artefacts_fields_library rows:                       84
  - Active   (archived_at IS NULL):                        20
  - Archived (archived_at IS NOT NULL):                    64
Rule 2 compliant rows (c_artefacts_* prefix):               0   (0.00%)
Rule 2 VIOLATIONS:                                         84
  - Active rule-2 violations:                              20
  - Archived rule-2 violations:                            64

Distinct subscriptions holding catalogue rows:             19
  - 00000000-0000-0000-0000-000000000001 (system/seed):   66 rows
  - 18 tenant subscriptions:                              1 row each

Other custom-field catalogue tables found:                 0
  - workspaces_fields:        JOIN table (workspace ↔ field_library by id) — NO names of its own
  - artefacts_types_fields:   JOIN table (type ↔ field_library by id) — NO names of its own
  - artefacts_fields_values:  value rows (text/number/date/...) — NO names of its own
  → artefacts_fields_library is the SOLE custom-field name catalogue.

Total artefacts_fields_values rows referenced by violating fields: 0
  → renames are trivially safe (no data ever gets stranded)
```

---

## A. Synopsis

**Rule 1 is 100% green.** Every single one of the 930 columns across all 88 tables in `vector_artefacts` already complies with the `<table_name>_<column>` convention. The lint enforcement (`dev/scripts/lint_column_prefix_convention.py`) has done its job — there is no remediation work to do at the schema layer. The exempt ledger (`dev/registries/column_prefix_exempt.json`) is the pay-down register for Go code that still uses bare column names in SQL strings, not the schema itself.

**Rule 2 is 100% red.** Every single row in `artefacts_fields_library` (84 rows: 20 active, 64 archived) violates the new `c_artefacts_<column>` prefix rule. Of the 20 active rows, none has any data in `artefacts_fields_values` (the value table is **empty for every violating field** — 0 stranded values). Of the 64 archived rows, none has values either. **The rename is data-safe across the board.**

**Headline:** This is a **catalogue-only data fix**, not a schema migration. It needs ONE migration (UPDATE on the `artefacts_fields_library_field_name` column), plus a tiny code-touch to update two literal-string references in `backend/internal/artefactitems/sql.go` (`'risk_impact'` and `'risk_probability'`) that both filter the risk-summary aggregator. Plus a new lint rule to keep new rows compliant. Estimated effort: **a single afternoon, S2** — wire-breaking risk is contained to a 2-line SQL-string change, and the value table is empty so there is no destruction surface.

**Recommendation:** Single migration, Rule 2 only. Rule 1 is closed.

---

## B. Rule 1 violations — core columns NOT prefixed with full table name

### ZERO violations.

Query run (saved at `/tmp/rule1_query_v2.sql`):

```sql
SELECT
  c.table_name, c.column_name, c.data_type,
  CASE
    WHEN c.column_name = c.table_name || '_id'                                THEN 'compliant_pk'
    WHEN position(c.table_name || '_' in c.column_name) = 1                   THEN 'compliant'
    ELSE 'VIOLATION'
  END AS status
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name NOT LIKE 'pg_%'
  AND c.table_name != 'schema_migrations'
ORDER BY status DESC, c.table_name, c.column_name;
```

Result distribution:

| status         | count |
|----------------|-------|
| `compliant`    | 856   |
| `compliant_pk` | 74    |
| `VIOLATION`    | **0** |

Stricter cross-check (positional substring, no LIKE wildcard at all) confirmed: **zero violations**.

```sql
SELECT * FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name NOT LIKE 'pg_%'
  AND c.table_name != 'schema_migrations'
  AND NOT (
    c.column_name = c.table_name || '_id'
    OR substring(c.column_name from 1 for length(c.table_name) + 1) = c.table_name || '_'
  );
-- → 0 rows
```

### Origin assessment (n/a)

There are no violations to categorise. The schema is fully compliant. This is the expected end-state after PLA-0048 / RF1.4.4 closed out the column-prefix sweep (see `db/vector_artefacts/schema/064_*`, `065_*`, `095_*`, `096_*`, `099_*`, `101_*`, `103_*`, `105_*` — all named `*_column_prefix_RF1_*.sql`).

### Tables of note (sampled to confirm the auditor isn't lying to itself)

The audit cross-checked the following tables by `\d` to confirm column names match the rule (they all do):

- `artefacts` (71 columns: `artefacts_id`, `artefacts_id_subscription`, `artefacts_id_workspace`, ..., `artefacts_risk_impact`, `artefacts_risk_calculated` — all prefixed)
- `artefacts_fields_library` (12 columns: `artefacts_fields_library_id`, `..._field_name`, `..._label`, ..., `..._scope` — all prefixed)
- `master_record_workspaces` (17 columns — all prefixed `master_record_workspaces_*`)
- `topology_nodes`, `users`, `users_nav_groups`, `workspaces_fields`, `artefacts_types_fields`, `artefacts_fields_values` — all prefixed
- `admin_api_keys`, `dpop_jti_cache`, `notifications_*`, `pages_*`, `users_*`, `webhooks_*`, `saved_views`, `vector_icons` — all prefixed

### Confirmation per existing HARD RULE

`mmff_library` was NOT audited (out of scope per CLAUDE.md HARD RULE — shared library spine, columns predate the rule, renaming breaks the library-release contract across deployments).

---

## C. Rule 2 violations — custom-field rows NOT prefixed `c_artefacts_`

### ALL 84 rows violate.

Query run (saved at `/tmp/rule2.sql`):

```sql
SELECT
  artefacts_fields_library_id,
  artefacts_fields_library_field_name,
  artefacts_fields_library_label,
  artefacts_fields_library_field_type,
  artefacts_fields_library_scope,
  (artefacts_fields_library_archived_at IS NOT NULL) AS is_archived,
  CASE
    WHEN artefacts_fields_library_field_name LIKE 'c\_artefacts\_%' ESCAPE '\' THEN 'compliant'
    ELSE 'VIOLATION'
  END AS status
FROM artefacts_fields_library
ORDER BY status DESC, artefacts_fields_library_field_name;
```

### C.1 — Active violations (20 rows — must rename)

| current field_name                | label                          | data_type    | proposed compliant name                          | value_count |
|-----------------------------------|--------------------------------|--------------|--------------------------------------------------|-------------|
| `acceptance_criteria`             | Acceptance Criteria            | `richtext`   | `c_artefacts_acceptance_criteria`                | 0           |
| `browser`                         | Browser                        | `textbox`    | `c_artefacts_browser`                            | 0           |
| `lidentifier_type`                | Label Type                     | `textbox`    | `c_artefacts_lidentifier_type`                   | 0           |
| `pi_date_work_accepted`           | Work Accepted Date             | `date`       | `c_artefacts_pi_date_work_accepted`              | 0           |
| `pi_flow_state_change_owner`      | Flow State Change Owner        | `user`       | `c_artefacts_pi_flow_state_change_owner`         | 0           |
| `pi_lidentifier_labels`           | Labels                         | `multiselect`| `c_artefacts_pi_lidentifier_labels`              | 0           |
| `pi_lidentifier_tags`             | Tags                           | `multiselect`| `c_artefacts_pi_lidentifier_tags`                | 0           |
| `pi_strategic_investment_weight`  | Strategic Investment Weight    | `textbox`    | `c_artefacts_pi_strategic_investment_weight`     | 0           |
| `pi_value_stream_identifier`      | Value Stream Identifier        | `textbox`    | `c_artefacts_pi_value_stream_identifier`         | 0           |
| `regression`                      | Regression                     | `boolean`    | `c_artefacts_regression`                         | 0           |
| `risk_impact`                     | Risk Impact                    | `select`     | `c_artefacts_risk_impact`                        | 0           |
| `risk_probability`                | Risk Probability               | `select`     | `c_artefacts_risk_probability`                   | 0           |
| `risk_score`                      | Risk Score                     | `decimal`    | `c_artefacts_risk_score`                         | 0           |
| `steps_to_reproduce`              | Steps to Reproduce             | `richtext`   | `c_artefacts_steps_to_reproduce`                 | 0           |
| `us_count_child_defects`          | Child Defect Count             | `integer`    | `c_artefacts_us_count_child_defects`             | 0           |
| `us_count_child_tasks`            | Child Task Count               | `integer`    | `c_artefacts_us_count_child_tasks`               | 0           |
| `us_release_id`                   | Release                        | `textbox`    | `c_artefacts_us_release_id`                      | 0           |
| `us_schedule_state`               | Schedule State                 | `select`     | `c_artefacts_us_schedule_state`                  | 0           |
| `us_sprint_id`                    | Sprint                         | `textbox`    | `c_artefacts_us_sprint_id`                       | 0           |
| `us_test_case_status`             | Test Case Status               | `textbox`    | `c_artefacts_us_test_case_status`                | 0           |

**All 20 active rows have ZERO entries in `artefacts_fields_values` (`SELECT count(*) FROM artefacts_fields_values → 0`). Renaming is data-trivial — no values get stranded.**

### C.2 — Archived violations (64 rows — recommendation: rename anyway, see §F.1)

Notable patterns in the archived 64:

- Repeated rename trails — `risk_impact` (active) + `pi_risk_impact` (archived) + `us_risk_impact` (archived); same shape for `risk_probability`, `risk_score`, `acceptance_criteria`, `blocked`, `notes`. These are an audit trail of seed iterations — fields demoted/promoted as artefact-types evolved. (Rally migration trails.)
- 19 `test_field_*` rows (UUID-suffixed dev test artefacts; see `dev/research/second_demotion_catalogue_audit.md` lineage).
- 1 `test_typechange_*` row (another dev test).

Full list: see `/tmp/rule2_full.txt` (saved during audit) — 64 archived rows, all with 0 values, all violating.

### C.3 — Unique-constraint impact analysis

The catalogue carries two unique indexes:

```
UNIQUE (id_subscription, field_name)  WHERE archived_at IS NULL          -- name uniqueness
UNIQUE (id_subscription, label, field_type) WHERE archived_at IS NULL    -- label-shape uniqueness
                                              AND scope='tenant'
```

Prefixing every active row with the same constant `c_artefacts_` cannot create new collisions on either index (uniqueness is by subscription + name; prepending the same prefix preserves the partial order). The label-shape index is unaffected (label is not renamed).

### C.4 — Other catalogue tables: none.

```sql
-- All tables matching '%fields%'
artefacts_types_fields    → JOIN table (artefact_type ↔ field_library by id). No names.
workspaces_fields         → JOIN table (workspace ↔ field_library by id). No names.
artefacts_fields_values   → value table (string/number/date/boolean by field_library_id). No names.
artefacts_fields_library  → SOLE catalogue. Audited above.
```

**No other catalogue surface holds custom-field-style name rows.** Rule 2 applies to `artefacts_fields_library` only today.

---

## D. Backend code references — where the violating names are baked into Go

### D.1 — Catalogue rename has minimal Go fallout because the FK is on `id` (UUID).

`artefacts_fields_values.artefacts_fields_values_id_field_library` → references `artefacts_fields_library.artefacts_fields_library_id` (UUID). `artefacts_types_fields.artefacts_types_fields_id_field_library` → same. `workspaces_fields.workspaces_fields_id_field_library` → same. Renames of the `field_name` column **do not break any FK**.

### D.2 — Literal-string references in Go that DO break.

```
backend/internal/artefactitems/sql.go:482:    WHERE fli.artefacts_fields_library_field_name = 'risk_impact'
backend/internal/artefactitems/sql.go:485:    WHERE flp.artefacts_fields_library_field_name = 'risk_probability'
```

These two SQL string literals filter the risk-severity × likelihood aggregator (`sqlSummariseRisks` at `artefactitems/sql.go:476`). **Both must update** to `'c_artefacts_risk_impact'` and `'c_artefacts_risk_probability'` in lockstep with the migration.

This is the **only** location in `backend/internal/` where any custom-field name literal appears in SQL. All other Go references to `artefacts_fields_library_field_name` are **projection/sort columns** (SELECT lists, ORDER BY) which are unaffected by a value rename:

```
backend/internal/artefactitems/sql.go:884:   fl.artefacts_fields_library_field_name,
backend/internal/artefactitems/sql.go:898:   ORDER BY tf.artefacts_types_fields_position ASC, fl.artefacts_fields_library_field_name ASC
backend/internal/artefactitems/sql.go:908:   fl.artefacts_fields_library_field_name, fl.artefacts_fields_library_label, ...
backend/internal/artefactitems/sql.go:916:   ORDER BY fl.artefacts_fields_library_field_name ASC
backend/internal/artefactitems/sql.go:935:   SELECT artefacts_fields_library_field_name, artefacts_fields_library_field_type FROM artefacts_fields_library WHERE ...
backend/internal/artefactitems/sql.go:967:   SELECT fl.artefacts_fields_library_field_name, fl.artefacts_fields_library_field_type, ...
backend/internal/fields/sql.go:41:           fl.artefacts_fields_library_field_name,
backend/internal/fields/sql.go:61:           ORDER BY fl.artefacts_fields_library_label ASC, fl.artefacts_fields_library_field_name ASC
backend/internal/fields/sql.go:100:          INSERT INTO artefacts_fields_library (..., artefacts_fields_library_field_name, ...)
backend/internal/fields/sql.go:111:          RETURNING ..., artefacts_fields_library_field_name, ...
backend/internal/fields/sql.go:147:          UPDATE ... SET artefacts_fields_library_field_name = $X ...
backend/internal/fields/sql.go:196:          (PATCH whitelist; takes field_name as a parameter, not a literal)
backend/internal/fields/bindings_integration_test.go:62:    test fixture INSERT
backend/internal/notifications/rules/sql.go:160-172:        SELECT/ORDER BY of fl.artefacts_fields_library_field_name (no literal filter)
```

**Summary for Rule 2 backend impact: 2 literal-string changes in 1 file (`artefactitems/sql.go`), 1 SQL migration.** Nothing else needs editing.

### D.3 — Rule 1 backend code: not applicable (Rule 1 is green).

---

## E. Frontend code references

### E.1 — Catalogue rename FE fallout: also minimal.

The frontend never filters by `name` value. The wire shape (`/workspaces/{id}/fields`) returns `{ id, name, label, data_type, scope, ... }` with `name` as a free-form string. The FE renders whatever the server returns; it never tests `name === 'risk_impact'`.

Cross-checked greps:

```
grep -rn "artefacts_fields_library_field_name" app/ ... → 0 hits
grep -rn -E "['\"](risk_impact|acceptance_criteria|us_acceptance_criteria|pi_blocked|defect_severity|...)['\"]" app/ → 0 hits in custom-field context
```

The two hits that DO mention `risk_impact` in the FE are:

```
app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx:194:  risk_impact: { ... }
app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx:199:  risk_impact_score: { ... }
```

— but these are entries in `CORE_COLUMN_OVERRIDES`, a map keyed by the **CORE Go-struct json-tag name** for the column on the `artefacts` table (`artefacts.artefacts_risk_impact`, `artefacts.artefacts_risk_impact_score`), NOT by the catalogue row name. **These are CORE columns, not custom fields. No change needed.** (The collision of names is coincidental — Rally's risk_impact/risk_probability scheme exists at both layers because the old custom-field rows are being demoted to core columns; see `dev/research/second_demotion_catalogue_audit.md`.)

### E.2 — FE work after the migration: zero.

The wire payload changes (`name` field returns new string), but the FE renders whatever it receives. No FE edits required for Rule 2.

### E.3 — Rule 1 FE: not applicable.

---

## F. Open questions for Rick (to answer on waking)

### F.1 — Archived rows: rename or leave?

**The 64 archived rows are 76% of the total catalogue, all with 0 values.**

Two options:

- **(A) Rename all 84** — uniform compliance, archived rows match the rule too. Trivial extra SQL (one bare UPDATE on the table, no `WHERE archived_at IS NULL` filter).
- **(B) Rename only the 20 active** — archived rows are historical artefacts; "the rule only applies to active". Adds the lint guard burden of "active-only" carve-out forever.

**Recommendation: (A) rename all 84.** Zero-cost in this DB (no values, no constraint conflict), aligns archived rows for SY003 readability, and the lint rule (§F.5) can be a simple regex on the column unconditionally — no "is_archived" carve-out semantics to maintain. Also: future re-activation of an archived row would be a Rule-2 violation if we left them alone.

### F.2 — `mmff_library` exemption: confirmed correct?

`mmff_library` is the read-only library spine; its columns predate Rule 1; the existing CLAUDE.md HARD RULE explicitly exempts it. **Rule 2 is not relevant** because mmff_library has no custom-field catalogue (no `*_fields_library` table over there). Audit answers: **EXEMPT from both rules. No action.**

### F.3 — Substrate-shared columns (Postgres `oid` / `xmin`): rule applies?

Not applicable — none of these system columns appear in `information_schema.columns` for user tables in `public`. No carve-out needed.

### F.4 — Scope of `c_` prefix to other custom-field surfaces?

There are NO other custom-field name catalogues in `vector_artefacts` today. The only adjacent table that could grow into one in future is a hypothetical `workspaces_fields_library` (workspace-scoped overrides — does not exist today, may never). **Recommendation: scope Rule 2 to `artefacts_fields_library` only, until/unless a second catalogue is introduced.** If/when it is, the rule generalises to `c_<table_name>_<column>` for THAT table's catalogue, mirroring how Rule 1 attaches to each table.

### F.5 — Lint enforcement: yes, what shape?

**Recommendation: add `lint:custom-field-prefix`** as a Python script in `dev/scripts/` mirroring the shape of `lint_column_prefix_convention.py`. Two checks:

1. **Schema-time (post-migration sanity)** — `SELECT artefacts_fields_library_field_name FROM artefacts_fields_library WHERE artefacts_fields_library_field_name !~ '^c_artefacts_[a-z][a-z0-9_]*$'` → 0 rows expected. CI step at the end of the migrate-runner.
2. **Code-time (caller-side)** — grep `backend/internal/fields/handler.go` (createFieldIn → POST body) for any path that allows raw input to bypass the `c_artefacts_` prefix. Validate input server-side; reject 400 if the submitted name doesn't match `^c_artefacts_[a-z][a-z0-9_]*$`. (Or: silently prepend `c_artefacts_` if absent — UX kinder, but hides the rule. Recommendation: 400 with an explanatory error, surface the rule.)

### F.6 — Migration strategy: single transaction.

**Recommendation: ONE atomic migration**, single SQL file. Update all 84 rows in one statement, run inside a transaction (the migrate runner already wraps each `.sql` file in BEGIN/COMMIT). The catalogue is tiny (84 rows); the indexes are small; the lock window is microseconds. Reversible cleanly (DOWN strips the prefix).

Single migration count: **1** (next free: `160_artefacts_fields_library_custom_field_prefix.sql`).

### F.7 — Stage rollout: irrelevant.

Rule 1 is already done. Only Rule 2 has work. There is no ordering question — it's one migration.

---

## G. Proposed migration plan

### Migration 160 — `c_artefacts_*` prefix on custom-field catalogue

```
File:       db/vector_artefacts/schema/160_artefacts_fields_library_custom_field_prefix.sql
Tables:     artefacts_fields_library (1 table)
Rows:       84 (UPDATE prepends 'c_artefacts_' to artefacts_fields_library_field_name)
SQL:        ~10 lines (UPDATE + guarded post-condition CHECK via DO block)
Backend:    1 file changed (backend/internal/artefactitems/sql.go — 2 literal-string updates)
Frontend:   0 files changed
Risk:       S2 (wire-breaking for any external system that filters by raw
                custom-field name — but per audit, only Vector's own
                `sqlSummariseRisks` does this internally, and it's updated
                in lockstep)
Reversible: YES — DOWN migration at db/vector_artefacts/schema/down/160_*.sql
                  strips the 'c_artefacts_' prefix.

UP shape:

  BEGIN;

  UPDATE artefacts_fields_library
     SET artefacts_fields_library_field_name = 'c_artefacts_' || artefacts_fields_library_field_name
   WHERE artefacts_fields_library_field_name !~ '^c_artefacts_';

  -- Verify post-condition: 0 non-compliant rows remain.
  DO $$
  DECLARE bad INT;
  BEGIN
    SELECT count(*) INTO bad
      FROM artefacts_fields_library
     WHERE artefacts_fields_library_field_name !~ '^c_artefacts_[a-z][a-z0-9_]*$';
    IF bad > 0 THEN
      RAISE EXCEPTION 'mig 160: % non-compliant rows remain', bad;
    END IF;
  END $$;

  COMMIT;

DOWN shape (down/160_*.sql):

  BEGIN;
  UPDATE artefacts_fields_library
     SET artefacts_fields_library_field_name = substring(artefacts_fields_library_field_name from 13)
   WHERE artefacts_fields_library_field_name LIKE 'c_artefacts_%';
  COMMIT;
```

### Lockstep code touch (NOT a migration — committed alongside mig 160)

```
File:       backend/internal/artefactitems/sql.go
Changes:    2 string-literal updates
Diff:
  - WHERE fli.artefacts_fields_library_field_name = 'risk_impact'
  + WHERE fli.artefacts_fields_library_field_name = 'c_artefacts_risk_impact'

  - WHERE flp.artefacts_fields_library_field_name = 'risk_probability'
  + WHERE flp.artefacts_fields_library_field_name = 'c_artefacts_risk_probability'
```

### New lint rule (separate commit, lands AFTER mig 160)

```
File:       dev/scripts/lint_custom_field_prefix.py
Wired into: dev/scripts/lint_all.sh (or equivalent CI step)
Mode:       fail-on-violation from day 1 (the migration drains the surface
            to 0, so there is no baseline to grandfather)
Backend tie-in: backend/internal/fields/handler.go createFieldIn validator
            — reject 400 if name doesn't match ^c_artefacts_[a-z][a-z0-9_]*$
```

### Tech-debt entry

```
File: docs/c_tech_debt.md
Entry: TD-CUSTOM-FIELD-PREFIX (closed by mig 160 + lint)
```

### Total impact

| Surface       | Count |
|---------------|-------|
| Migrations    | 1     |
| Go file edits | 1     |
| Go literal-string edits | 2 |
| TS/TSX file edits | 0 |
| New lint script   | 1 |
| Handler validator additions | 1 (in fields/handler.go) |
| Tech-debt entries | 1 (closed-on-land) |
| Down migration    | 1 |

**Total estimated dev time: an afternoon.** No multi-week effort. No regression cascade. No data destruction surface (zero values stranded).

---

## Appendix — raw audit artefacts (saved on disk)

| Path                      | Description                                         |
|---------------------------|-----------------------------------------------------|
| `/tmp/rule1_query.sql`    | First Rule-1 query (LIKE-pattern, ambiguous result) |
| `/tmp/rule1_query_v2.sql` | Stricter Rule-1 query (position-substring)          |
| `/tmp/strict_violations.sql` | Triple-check Rule-1 query (substring extraction) |
| `/tmp/rule1_full.txt`     | All 930 columns with status flag                    |
| `/tmp/rule2.sql`          | Rule-2 query (artefacts_fields_library)             |
| `/tmp/rule2_full.txt`     | All 84 catalogue rows with status flag              |
| `/tmp/value_counts.sql`   | Per-field value-row count probe                     |
| `/tmp/value_counts.txt`   | Per-field value counts (all zero)                   |
| `/tmp/tables.txt`         | All 88 tables in vector_artefacts                   |
| `/tmp/spotcheck.sql`      | Manual sanity check on key tables                   |

---

## End of audit
