-- ============================================================
-- MMFFDev - vector_artefacts: dedupe artefact_field_library by label
--
-- Run against vector_artefacts:
--   psql -U mmff_dev -d vector_artefacts -f 038_dedupe_artefact_field_library_by_label.sql
--
-- The seed migrations (027 defect, 030 portfolio-item, 034 user-story) each
-- inserted their own rows into the subscription-wide artefact_field_library
-- with type-prefixed slugs ('blocked' / 'pi_blocked' / 'us_blocked'), but
-- identical labels. The "Custom Fields" admin "Add from library" dropdown
-- groups by label, so users see "Blocked (boolean)" three times.
--
-- This migration:
--
--   1. Per (subscription_id, scope, label, field_type) group, picks ONE
--      canonical row — the one with the most adoptions; ties broken by oldest
--      created_at; final tie broken by lowest id (deterministic).
--
--   2. Repoints artefact_type_fields bindings from duplicate rows to the
--      canonical row — but only where doing so does NOT collide with the
--      (artefact_type_id, field_library_id) unique binding. Collisions get
--      their duplicate binding deleted instead (the canonical binding stays).
--
--   3. Soft-archives the duplicate field rows (archived_at = now()).
--
--   4. Adds a partial unique index on (subscription_id, label, scope) for
--      live tenant rows so future seeds and admin POSTs cannot reintroduce
--      a duplicate-by-label.
--
-- Out of scope (deliberate):
--   - Global rows (scope = 'global'): none exist today; uniqueness for those
--     would key on (label, scope) only and is a separate migration when the
--     first global row is added.
--   - Slug renames: the surviving row keeps whichever slug was canonical.
--     Renaming slugs would touch every reader; not worth it for cosmetic.
-- ============================================================

BEGIN;

-- ── 1. Identify canonical row per group ───────────────────────────────────────
-- A "group" is (subscription_id, scope, label, field_type).
-- Canonical = most-adopted, then oldest, then lowest id.

CREATE TEMP TABLE _afl_groups ON COMMIT DROP AS
WITH adoption AS (
    SELECT field_library_id, COUNT(*)::int AS cnt
      FROM artefact_type_fields
     GROUP BY field_library_id
),
ranked AS (
    SELECT
        fl.id,
        fl.subscription_id,
        fl.scope,
        fl.label,
        fl.field_type,
        COALESCE(a.cnt, 0) AS adoption_count,
        ROW_NUMBER() OVER (
            PARTITION BY fl.subscription_id, fl.scope, fl.label, fl.field_type
            ORDER BY COALESCE(a.cnt, 0) DESC, fl.created_at ASC, fl.id ASC
        ) AS rnk
      FROM artefact_field_library fl
 LEFT JOIN adoption a ON a.field_library_id = fl.id
     WHERE fl.archived_at IS NULL
       AND fl.scope = 'tenant'
)
SELECT
    r.id,
    r.subscription_id,
    r.scope,
    r.label,
    r.field_type,
    r.adoption_count,
    -- Canonical is the row with rnk = 1 in the same group. Using a self-join
    -- (rather than a separate window with a different ORDER BY) guarantees
    -- canonical_id always refers to a row that was itself ranked rnk = 1 with
    -- the same tie-breakers as the rnk column above. Otherwise different
    -- ORDER BY clauses can pick different "winners" on ties, leaving live
    -- duplicates after step 3.
    c.id AS canonical_id,
    r.rnk
  FROM ranked r
  JOIN ranked c
    ON c.subscription_id = r.subscription_id
   AND c.scope           = r.scope
   AND c.label           = r.label
   AND c.field_type      = r.field_type
   AND c.rnk             = 1;

-- ── 2. Repoint adoptable bindings; delete colliding ones ─────────────────────
-- For every duplicate (rnk > 1), each of its bindings either:
--   (a) repoints to the canonical row — if the canonical doesn't already
--       have a binding for the same artefact_type_id; or
--   (b) gets deleted — because the canonical already binds the same type
--       (the canonical binding wins).

WITH dups AS (
    SELECT id AS dup_id, canonical_id
      FROM _afl_groups
     WHERE rnk > 1
       AND id <> canonical_id
),
collisions AS (
    SELECT atf.id AS dup_binding_id
      FROM artefact_type_fields atf
      JOIN dups d ON d.dup_id = atf.field_library_id
     WHERE EXISTS (
         SELECT 1
           FROM artefact_type_fields canon
          WHERE canon.field_library_id = d.canonical_id
            AND canon.artefact_type_id = atf.artefact_type_id
     )
)
DELETE FROM artefact_type_fields
 WHERE id IN (SELECT dup_binding_id FROM collisions);

UPDATE artefact_type_fields atf
   SET field_library_id = d.canonical_id
  FROM (SELECT id AS dup_id, canonical_id
          FROM _afl_groups
         WHERE rnk > 1
           AND id <> canonical_id) d
 WHERE atf.field_library_id = d.dup_id;

-- ── 3. Soft-archive the duplicate field rows ─────────────────────────────────

UPDATE artefact_field_library
   SET archived_at = now()
 WHERE id IN (
     SELECT id
       FROM _afl_groups
      WHERE rnk > 1
        AND id <> canonical_id
 );

-- ── 4. Prevent regressions ───────────────────────────────────────────────────
-- Partial unique index covers tenant-scope live rows; global rows are out of
-- scope until one is seeded.
--
-- The uniqueness key is (subscription_id, label, field_type) — NOT just
-- (subscription_id, label). Rationale: a workspace can legitimately want both
-- "Notes" as a richtext (long-form notes) and "Notes" as a textbox
-- (short note-to-self), and these surface in the "Add from library" dropdown
-- as "Notes (richtext)" / "Notes (textbox)" — distinct entries. The bug we're
-- fixing is same-label *same-type* rows that show up as identical entries.

CREATE UNIQUE INDEX IF NOT EXISTS artefact_field_library_label_type_unique_live_tenant
    ON artefact_field_library (subscription_id, label, field_type)
    WHERE archived_at IS NULL
      AND scope = 'tenant';

COMMIT;
