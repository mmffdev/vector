# Vector Fields 3-Layer Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Vector's field substrate to the industry-standard 3-layer model — `vector_fields_library` (definition) + `vector_fields_context` (binding) + existing form layouts (presentation) — Vector-wide and full-tenant-scoped, without a big-bang cutover.

**Architecture:** Additive-then-cutover. New tables are created and backfilled alongside the live `artefacts_fields_library` / `artefacts_types_fields`, which stay authoritative until each consumer (`fields`, `formlayouts`, `artefactitems`, `notifications`) is repointed one at a time. Old tables are dropped only when no reader remains. Values are untouched (typed `artefacts` columns + the 5-bucket `artefacts_fields_values`, already the Jira-standard shape).

**Tech Stack:** Go (chi, pgx/v5) on vaPool (`vector_artefacts`); file-based SQL migrations via `cmd/migrate`; Go table-tests.

**Spec:** `docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md`

**Pre-flight (every session):** backend env is pinned `dev`; the SSH tunnel to localhost:5435 must be up (psql via `127.0.0.1`, NOT `localhost` — IPv6 `::1` is refused). DB password = `VA_DB_PASSWORD` from `backend/.env.dev`. Migrations run from `backend/`: `go run ./cmd/migrate -db vector_artefacts -env .env.dev`. NEVER commit unless the user asks.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `db/vector_artefacts/schema/168_vector_fields_library.sql` | Create Layer-1 definition table | 1 |
| `db/vector_artefacts/schema/169_vector_fields_context.sql` | Create Layer-2 context table | 1 |
| `db/vector_artefacts/schema/170_backfill_vector_fields_from_legacy.sql` | Backfill new tables from legacy | 2 |
| `db/vector_artefacts/schema/down/*` | Paired DOWN scripts | 1–2 |
| `backend/internal/vectorfields/` (NEW package) | Reader for the 3-layer model: `Library`, `Context`, registry assembly | 3 |
| `backend/internal/vectorfields/sql.go` | SQL constants for the new tables | 3 |
| `backend/internal/vectorfields/service.go` | `LibraryForType`, `ContextForType` (the unified registry read) | 3 |
| `backend/internal/vectorfields/service_test.go` | Table-tests for the reader | 3 |
| `backend/internal/formlayouts/service.go:380` | Repoint `CustomFields` to `vectorfields` | 4 |
| `docs/c_c_db_routing.md`, SY003 | Substrate docs | each phase |

**Phasing rationale:** Phases 1–2 add+backfill (zero behaviour change, fully reversible). Phase 3 builds the new reader in isolation (no consumer touches it yet). Phase 4 cuts `formlayouts` over (the smallest, best-tested consumer). Phases for `fields` / `artefactitems` / `notifications` and the legacy drop are scoped as follow-on plans once Phase 4 proves the shape in production.

---

## Phase 1 — Create the new tables (additive, reversible)

### Task 1: `vector_fields_library` migration

**Files:**
- Create: `db/vector_artefacts/schema/168_vector_fields_library.sql`
- Create: `db/vector_artefacts/schema/down/168_vector_fields_library_DOWN.sql`

- [ ] **Step 1: Confirm next NNN + tunnel**

Run: `ls -r db/vector_artefacts/schema/ | grep -E '^[0-9]+_' | head -1`
Expected: `167_artefacts_types_fields_is_compulsory.sql` → next is `168`.
Run: `PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5435 -U mmff_dev -d vector_artefacts -tAc "SELECT 1"`
Expected: `1`. If "connection refused", the tunnel is down — surface to user, do not proceed.

- [ ] **Step 2: Write the migration**

```sql
-- ============================================================
-- 168_vector_fields_library.sql
-- Layer 1 of the 3-layer field model (Jira "customfield"): the field
-- DEFINITION, defined ONCE, Vector-wide (artefacts + timeboxes + future).
-- WHY: docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS. Re-run is a no-op.
-- ROLLBACK: schema/down/168_vector_fields_library_DOWN.sql
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS vector_fields_library (
  vector_fields_library_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vector_fields_library_id_tenant    uuid,            -- NULL = Vector-global (core fields)
  vector_fields_library_id_workspace uuid,            -- NULL = tenant-wide
  vector_fields_library_name         text NOT NULL,
  vector_fields_library_label        text NOT NULL DEFAULT '',
  vector_fields_library_description   text NOT NULL DEFAULT '',
  vector_fields_library_type         text NOT NULL,   -- text|number|date|boolean|select|richtext
  vector_fields_library_kind         text NOT NULL,   -- 'core' | 'custom'
  vector_fields_library_created_by   text NOT NULL DEFAULT 'Core',
  vector_fields_library_options_json  jsonb,
  vector_fields_library_created_at   timestamptz NOT NULL DEFAULT now(),
  vector_fields_library_updated_at   timestamptz NOT NULL DEFAULT now(),
  vector_fields_library_archived_at  timestamptz,
  CONSTRAINT vector_fields_library_kind_chk
    CHECK (vector_fields_library_kind IN ('core','custom'))
);

-- A tenant cannot have two non-archived fields with the same name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vector_fields_library_tenant_name
  ON vector_fields_library (vector_fields_library_id_tenant, vector_fields_library_name)
  WHERE vector_fields_library_archived_at IS NULL;

COMMENT ON TABLE vector_fields_library IS
  'Layer 1 (definition) of the 3-layer field model. One row per field, '
  'Vector-wide. kind=core (Vector-shipped, value in typed artefacts column) '
  'or custom (tenant-made, value in vector_fields_values EAV). Binding to '
  'entity types lives in vector_fields_context. See spec 2026-05-31.';

COMMIT;
```

- [ ] **Step 3: Write the DOWN script**

```sql
-- 168_vector_fields_library_DOWN.sql — rollback. Manual psql only.
BEGIN;
DROP TABLE IF EXISTS vector_fields_library;
COMMIT;
```

- [ ] **Step 4: Dry-run**

Run: `cd backend && go run ./cmd/migrate -dry-run -db vector_artefacts -env .env.dev`
Expected: lists `168_vector_fields_library.sql` as the single pending migration.

- [ ] **Step 5: Apply**

Run: `cd backend && go run ./cmd/migrate -db vector_artefacts -env .env.dev`
Expected: `✓ applied 168_vector_fields_library.sql`.

- [ ] **Step 6: Verify**

Run: `PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 5435 -U mmff_dev -d vector_artefacts -c "\d vector_fields_library"`
Expected: 13 columns present, the kind CHECK + the partial unique index listed.

### Task 2: `vector_fields_context` migration

**Files:**
- Create: `db/vector_artefacts/schema/169_vector_fields_context.sql`
- Create: `db/vector_artefacts/schema/down/169_vector_fields_context_DOWN.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 169_vector_fields_context.sql
-- Layer 2 of the 3-layer field model (Jira "context"): binds a library
-- field to an entity TYPE with per-binding rules. Polymorphic (artefact
-- /timebox) + full tenant/workspace scope. NULL entity_type = ALL types
-- of that kind (the universal-field answer; no per-type duplication).
-- WHY: docs/superpowers/specs/2026-05-31-vector-fields-3layer-design.md
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS.
-- ROLLBACK: schema/down/169_vector_fields_context_DOWN.sql
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS vector_fields_context (
  vector_fields_context_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vector_fields_context_id_field       uuid NOT NULL
    REFERENCES vector_fields_library (vector_fields_library_id) ON DELETE CASCADE,
  vector_fields_context_entity_kind    text NOT NULL,   -- 'artefact' | 'timebox'
  vector_fields_context_id_entity_type uuid,            -- NULL = all types of kind
  vector_fields_context_id_tenant      uuid NOT NULL,
  vector_fields_context_id_workspace   uuid,            -- NULL = tenant-wide
  vector_fields_context_required       boolean NOT NULL DEFAULT false,
  vector_fields_context_is_compulsory  boolean NOT NULL DEFAULT false,
  vector_fields_context_position       integer NOT NULL DEFAULT 100,
  vector_fields_context_default_value  text,
  vector_fields_context_created_at     timestamptz NOT NULL DEFAULT now(),
  vector_fields_context_updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One binding per (field, entity-type, tenant, workspace) scope. NULLs in
-- entity_type/workspace are distinct rows by Postgres default — acceptable:
-- a NULL (all-types) binding and a specific-type binding legitimately coexist.
CREATE INDEX IF NOT EXISTS idx_vector_fields_context_lookup
  ON vector_fields_context
     (vector_fields_context_id_tenant,
      vector_fields_context_entity_kind,
      vector_fields_context_id_entity_type);

CREATE INDEX IF NOT EXISTS idx_vector_fields_context_field
  ON vector_fields_context (vector_fields_context_id_field);

COMMENT ON TABLE vector_fields_context IS
  'Layer 2 (context/binding) of the 3-layer field model. Binds a '
  'vector_fields_library field to an entity type with per-binding rules '
  '(required=data-entry, is_compulsory=must-be-placed, position). '
  'entity_type NULL = all types of entity_kind. Replaces '
  'artefacts_types_fields. See spec 2026-05-31.';

COMMIT;
```

- [ ] **Step 2: Write the DOWN script**

```sql
-- 169_vector_fields_context_DOWN.sql — rollback. Manual psql only.
BEGIN;
DROP TABLE IF EXISTS vector_fields_context;
COMMIT;
```

- [ ] **Step 3: Dry-run, apply, verify** (same commands as Task 1, substituting `169`)

Run dry-run, apply, then:
`PGPASSWORD=… psql … -c "\d vector_fields_context"`
Expected: 12 columns, the FK to `vector_fields_library`, both indexes.

- [ ] **Step 4: Commit point (only if user asks)** — Phase 1 is two additive tables, safe to commit together: `db/vector_artefacts/schema/168_*`, `169_*`, and their DOWN scripts.

---

## Phase 2 — Backfill from legacy (data-only, reversible)

### Task 3: Backfill custom field definitions + bindings

**Files:**
- Create: `db/vector_artefacts/schema/170_backfill_vector_fields_from_legacy.sql`
- Create: `db/vector_artefacts/schema/down/170_backfill_vector_fields_from_legacy_DOWN.sql`

- [ ] **Step 1: Snapshot legacy counts (so the backfill is verifiable)**

Run: `PGPASSWORD=… psql … -tAc "SELECT (SELECT count(*) FROM artefacts_fields_library WHERE artefacts_fields_library_archived_at IS NULL) AS lib, (SELECT count(*) FROM artefacts_types_fields) AS bindings"`
Record both numbers — the backfill must reproduce them exactly.

- [ ] **Step 2: Write the backfill migration**

```sql
-- ============================================================
-- 170_backfill_vector_fields_from_legacy.sql
-- Backfill the 3-layer tables from the legacy field tables. CUSTOM fields
-- only here (core fields are seeded from columns.go in Phase 3, where the
-- Go family rules are the source). Legacy tables remain authoritative until
-- consumers are repointed — this is additive shadow data.
-- WHY: spec 2026-05-31, gradual cutover (no big-bang).
-- IDEMPOTENCY: ON CONFLICT DO NOTHING via deterministic id mapping — we
--   reuse the legacy library id AS the new library id so re-runs are no-ops
--   and the context FK lines up.
-- ROLLBACK: schema/down/170_*_DOWN.sql (deletes only backfilled rows).
-- ============================================================
BEGIN;

-- 1. Definitions: legacy custom fields → vector_fields_library (kind=custom).
--    Reuse the legacy id as the PK so context FKs map without a lookup table.
INSERT INTO vector_fields_library (
  vector_fields_library_id, vector_fields_library_id_tenant,
  vector_fields_library_name, vector_fields_library_label,
  vector_fields_library_description, vector_fields_library_type,
  vector_fields_library_kind, vector_fields_library_created_by,
  vector_fields_library_options_json, vector_fields_library_archived_at)
SELECT
  fl.artefacts_fields_library_id,
  at.artefacts_types_id_subscription,   -- tenant scope (custom fields are tenant-owned)
  fl.artefacts_fields_library_field_name,
  fl.artefacts_fields_library_label,
  COALESCE(fl.artefacts_fields_library_description,''),
  fl.artefacts_fields_library_field_type,
  'custom',
  'Migrated',
  fl.artefacts_fields_library_config_json,
  fl.artefacts_fields_library_archived_at
FROM artefacts_fields_library fl
JOIN artefacts_types_fields tf
  ON tf.artefacts_types_fields_id_field_library = fl.artefacts_fields_library_id
JOIN artefacts_types at
  ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
ON CONFLICT (vector_fields_library_id) DO NOTHING;

-- 2. Bindings: legacy artefacts_types_fields → vector_fields_context
--    (entity_kind='artefact'). Carries required + is_compulsory (mig 167)
--    + position. tenant from the type's subscription.
INSERT INTO vector_fields_context (
  vector_fields_context_id_field, vector_fields_context_entity_kind,
  vector_fields_context_id_entity_type, vector_fields_context_id_tenant,
  vector_fields_context_required, vector_fields_context_is_compulsory,
  vector_fields_context_position, vector_fields_context_default_value)
SELECT
  tf.artefacts_types_fields_id_field_library,
  'artefact',
  tf.artefacts_types_fields_id_artefact_type,
  at.artefacts_types_id_subscription,
  tf.artefacts_types_fields_required,
  tf.artefacts_types_fields_is_compulsory,
  tf.artefacts_types_fields_position,
  tf.artefacts_types_fields_default_value
FROM artefacts_types_fields tf
JOIN artefacts_types at
  ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
WHERE NOT EXISTS (
  SELECT 1 FROM vector_fields_context c
  WHERE c.vector_fields_context_id_field = tf.artefacts_types_fields_id_field_library
    AND c.vector_fields_context_id_entity_type = tf.artefacts_types_fields_id_artefact_type
    AND c.vector_fields_context_entity_kind = 'artefact'
);

COMMIT;
```

- [ ] **Step 3: DOWN script**

```sql
-- 170_backfill_vector_fields_from_legacy_DOWN.sql — manual psql only.
-- Removes ONLY backfilled custom rows; leaves any Phase-3 core seed intact.
BEGIN;
DELETE FROM vector_fields_context WHERE vector_fields_context_entity_kind = 'artefact';
DELETE FROM vector_fields_library WHERE vector_fields_library_created_by = 'Migrated';
COMMIT;
```

- [ ] **Step 4: Apply + verify counts match the snapshot**

Run dry-run, apply, then:
`PGPASSWORD=… psql … -tAc "SELECT (SELECT count(*) FROM vector_fields_context WHERE vector_fields_context_entity_kind='artefact') AS ctx, (SELECT count(*) FROM vector_fields_library WHERE vector_fields_library_created_by='Migrated') AS lib"`
Expected: `ctx` == the legacy bindings count from Step 1; `lib` == distinct legacy custom fields that have ≥1 binding.

- [ ] **Step 5: Spot-check a known type** (e.g. Defect from earlier this session)

Run: `PGPASSWORD=… psql … -c "SELECT l.vector_fields_library_label, c.vector_fields_context_required, c.vector_fields_context_position FROM vector_fields_context c JOIN vector_fields_library l ON l.vector_fields_library_id = c.vector_fields_context_id_field JOIN artefacts_types t ON t.artefacts_types_id = c.vector_fields_context_id_entity_type WHERE t.artefacts_types_name='Defect' ORDER BY c.vector_fields_context_position"`
Expected: the Defect's custom fields, matching what `artefacts_types_fields` showed earlier (Severity required, etc.).

---

## Phase 3 — Build the new reader package (isolated, no consumer touched)

### Task 4: `vectorfields` package — registry read

**Files:**
- Create: `backend/internal/vectorfields/service.go`
- Create: `backend/internal/vectorfields/sql.go`
- Create: `backend/internal/vectorfields/types.go`
- Test: `backend/internal/vectorfields/service_test.go`

- [ ] **Step 1: Write the failing test (reader returns core+custom for a type)**

`service_test.go`:
```go
package vectorfields

import "testing"

// FieldEntry is the unified registry row the reader returns. This test pins
// the shape; the DB-backed read is exercised by an integration test gated on
// the tunnel (separate, tagged `//go:build integration`).
func TestFieldEntry_Shape(t *testing.T) {
	e := FieldEntry{
		FieldKey:      "custom:abc",
		Label:         "Severity",
		Kind:          "custom",
		ValueLocation: "eav",
		Required:      true,
		IsCompulsory:  false,
	}
	if e.ValueLocation != "eav" {
		t.Fatalf("want eav, got %q", e.ValueLocation)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && go test ./internal/vectorfields/ 2>&1 | head`
Expected: FAIL — `undefined: FieldEntry`.

- [ ] **Step 3: Write `types.go`**

```go
// Package vectorfields reads the 3-layer field model (spec 2026-05-31):
// vector_fields_library (definition) ⋈ vector_fields_context (binding).
// It is the successor reader to formlayouts.CustomFields + CoreFields. Runs
// on vaPool (vector_artefacts).
package vectorfields

// FieldEntry is one row of the unified field registry for an entity type.
type FieldEntry struct {
	FieldKey      string `json:"fieldKey"`      // "custom:<id>" or core name
	Label         string `json:"label"`
	DataType      string `json:"dataType"`
	Kind          string `json:"kind"`          // "core" | "custom"
	Required      bool   `json:"required"`      // data-entry (per context)
	IsCompulsory  bool   `json:"isCompulsory"`  // must be placed (per context)
	Position      int    `json:"position"`
	ValueLocation string `json:"valueLocation"` // "artefacts_column" | "eav"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/vectorfields/ 2>&1 | head`
Expected: PASS (`ok ...vectorfields`).

- [ ] **Step 5: Write `sql.go` — the registry query (custom branch)**

```go
package vectorfields

// sqlContextForType returns the CUSTOM field bindings for a (tenant,
// entity_kind, type) scope, including NULL-type universal bindings. Core
// fields are layered in Go (from columns.go), as in formlayouts today.
//
// $1 = tenant id; $2 = entity_kind; $3 = entity_type id.
const sqlContextForType = `
  SELECT l.vector_fields_library_id::text,
         l.vector_fields_library_name,
         l.vector_fields_library_label,
         l.vector_fields_library_type,
         c.vector_fields_context_required,
         c.vector_fields_context_is_compulsory,
         c.vector_fields_context_position
    FROM vector_fields_context c
    JOIN vector_fields_library l
      ON l.vector_fields_library_id = c.vector_fields_context_id_field
   WHERE c.vector_fields_context_id_tenant = $1
     AND c.vector_fields_context_entity_kind = $2
     AND (c.vector_fields_context_id_entity_type = $3
          OR c.vector_fields_context_id_entity_type IS NULL)
     AND l.vector_fields_library_archived_at IS NULL
   ORDER BY c.vector_fields_context_position ASC,
            l.vector_fields_library_name ASC`
```

- [ ] **Step 6: Write `service.go` — `ContextForType`**

```go
package vectorfields

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ vaPool *pgxpool.Pool }

func NewService(vaPool *pgxpool.Pool) *Service { return &Service{vaPool: vaPool} }

// ContextForType returns the CUSTOM field entries bound to (tenant, kind,
// typeID) — including universal (NULL-type) bindings. Core entries are added
// by the caller (formlayouts) from columns.go until core seeding lands.
func (s *Service) ContextForType(
	ctx context.Context, tenantID uuid.UUID, kind string, typeID uuid.UUID,
) ([]FieldEntry, error) {
	rows, err := s.vaPool.Query(ctx, sqlContextForType, tenantID, kind, typeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FieldEntry
	for rows.Next() {
		var id, name, label, dtype string
		var required, compulsory bool
		var position int
		if err := rows.Scan(&id, &name, &label, &dtype, &required, &compulsory, &position); err != nil {
			return nil, err
		}
		out = append(out, FieldEntry{
			FieldKey:      "custom:" + id,
			Label:         label,
			DataType:      dtype,
			Kind:          "custom",
			Required:      required,
			IsCompulsory:  compulsory,
			Position:      position,
			ValueLocation: "eav",
		})
	}
	return out, rows.Err()
}
```

- [ ] **Step 7: Build + test**

Run: `cd backend && go build ./... && go test ./internal/vectorfields/ 2>&1 | head`
Expected: build clean, test PASS.

- [ ] **Step 8: Integration check against live backfilled data** (tunnel up)

Write a throwaway `//go:build integration` test OR a psql query that mirrors `sqlContextForType` for the Defect type+its tenant, and confirm the row set equals Phase-2 Step-5 output. Document the result; delete the throwaway.

---

## Phase 4 — Cut `formlayouts` over to the new reader

### Task 5: Repoint `formlayouts.CustomFields` to `vectorfields`

**Files:**
- Modify: `backend/cmd/server/main.go:711` (inject `vectorfields.Service` into `formlayouts`)
- Modify: `backend/internal/formlayouts/service.go:380` (`CustomFields` delegates to `vectorfields.ContextForType`)
- Test: `backend/internal/formlayouts/service_test.go` (existing 14 tests must still pass)

- [ ] **Step 1: Add a `vectorfields.Service` field to `formlayouts.Service`**

Modify `formlayouts/service.go` Service struct + `NewService` to accept and hold a `*vectorfields.Service`. Show the exact struct + ctor change (mirror the existing `vaPool` field).

- [ ] **Step 2: Rewrite `CustomFields` to delegate**

Replace the body of `CustomFields` (currently querying `sqlListCustomFieldsForType`) with a call to `s.vf.ContextForType(ctx, subscriptionID, "artefact", typeID)`, mapping `[]vectorfields.FieldEntry` → the existing `([]CoreFieldDescriptor, map[string]bool, map[string]bool, error)` return. Keep the signature identical so handlers don't change.

- [ ] **Step 3: Wire the dependency in `main.go`**

At `main.go:711`, construct `vectorfields.NewService(vaPool)` and pass it into `formlayouts.NewService(vaPool, vf)`.

- [ ] **Step 4: Run the full formlayouts suite**

Run: `cd backend && go test ./internal/formlayouts/ -v 2>&1 | tail -20`
Expected: all 14 tests PASS (the registry shape is unchanged; only its source moved).

- [ ] **Step 5: Live parity check**

Hit `/_site/api/form-layouts/core-fields?type=<typeID>` (dev API key) before and after; the field list (count, labels, isCompulsory, valueLocation) must be identical. The custom fields now come from `vector_fields_context` instead of `artefacts_types_fields`.

- [ ] **Step 6: Regenerate SY003** (substrate changed: 2 new tables + backfill)

Run the `<report> -sy` flow per the HARD RULE; note tables 168/169, the backfill, and the formlayouts repoint.

---

## Follow-on (separate plans, after Phase 4 proves the shape)
- **Core-field seeding** — generate `vector_fields_context` core rows from `columns.go` families (NULL entity_type where universal); extend the drift-pin test. This is what finally moves family logic from Go to data.
- **Repoint `fields` package** (`bindings.go`, `resolver.go`, `LoadAdmittedFields`) to the new tables.
- **Repoint `artefactitems` + `notifications`** readers.
- **Drop legacy** `artefacts_types_fields` then `artefacts_fields_library`, one reader gone at a time (SY003-tracked).
- **Rename** `artefacts_fields_values` → `vector_fields_values` (cosmetic, last).

---

## Self-Review notes
- **Spec coverage:** Layer 1 (Task 1), Layer 2 (Task 2), backfill (Task 3), reader (Task 4), first cutover (Task 5). Core seeding + remaining consumers + legacy drop explicitly deferred to follow-on plans (gradual-cutover HARD RULE) — not dropped.
- **No value migration** — confirmed; values untouched.
- **Reversibility** — every schema task has a DOWN; backfill DOWN deletes only its own rows.
- **Tunnel/IPv4 gotcha** + **dev-env pin** + **no-commit-without-ask** stated in pre-flight.
- **Type consistency** — `FieldEntry` fields used identically in `sql.go` scan, `service.go`, and the `formlayouts` mapping.
