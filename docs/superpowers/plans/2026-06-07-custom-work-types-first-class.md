# Custom Work Types First-Class — Implementation Plan (add-artefact-type pt2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A custom work type (e.g. Spike) functions and appears everywhere a canonical type does — it gets a default flow seeded on create (cloned from its behaves-like type), and the slot allow-list stops hiding it from type-list UIs.

**Architecture:** `CreateWorkType` clones the behaves-like type's default flow (states + transitions) inside its transaction via a new `flows`-package seeder, falling back to the standard spine. Frontend type-list surfaces drop the `wrk_*` slot gate; sprint-review derives story-tier from `execution_parent_slots`.

**Tech Stack:** Go (pgx) backend / `vector_artefacts`; Next.js/React/TS frontend; Go `testing` + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-custom-work-types-first-class-design.md`

---

## Pre-flight facts (verified 2026-06-07)

- **flows.Service** (`backend/internal/flows/service.go:29`): `struct { vaPool, mainPool *pgxpool.Pool }`, `func New(vaPool, mainPool *pgxpool.Pool) *Service`. Methods use `s.vaPool` directly — **NOT tx-aware**. The clone must run raw SQL on the passed `tx`.
- **artefacttypes.Service** (`service.go:20`): `struct { pool *pgxpool.Pool }`, `NewService(pool)`. `CreateWorkType` uses `s.pool.QueryRow` directly (no tx today).
- **Live NOT-NULL (no default) columns:**
  - `flows`: `flows_id_artefact_type`, `flows_name`, `flows_is_default`.
  - `flows_states`: `flows_states_id_flow`, `flows_states_name`, `flows_states_kind`, `flows_states_is_initial`, `flows_states_is_pullable`. (`sort_order` def 100, `is_initial`/`is_pullable` def false, colour nullable.)
  - `flows_transitions`: `flows_transitions_id_flow`, `flows_transitions_id_state_from`, `flows_transitions_id_state_to`.
- **`flows_states_kind` live CHECK** = `backlog|todo|in_progress|done|accepted|cancelled` (6 values — wider than the old `004_flows.sql`).
- **Standard spine** (`devtools/spine.go:51`, `SpineState{Name,Kind,SortOrder,IsInitial,IsPullable}` — NO colour field): Backlog(backlog,10,initial) → To Do(todo,20,pullable) → Doing(in_progress,30) → Completed(done,40) → Accepted(accepted,50).
- **Composition root** (`main.go`): `flows.New(vaPool, servicePool)` (~964), `artefacttypes.NewService(vaPool)` (~998).
- **Go commands run from `backend/`** (module root): `cd backend && go build ./...`.

---

## Phase 1 — Backend: flow seeder (TDD)

### Task 1.1: Add the standard spine to a production location

**Files:**
- Create: `backend/internal/flows/spine.go`

- [ ] **Step 1: Add the spine (lifted from devtools, production-owned)**

Create `backend/internal/flows/spine.go`:

```go
package flows

// SpineState is one state in a default workflow spine.
type SpineState struct {
	Name       string
	Kind       string // backlog | todo | in_progress | done | accepted | cancelled
	Colour     string // "" → NULL
	SortOrder  int
	IsInitial  bool
	IsPullable bool
}

// standardSpine is the fallback default workflow seeded for a work type when
// its clone-source has no live flow. Mirrors the canonical Story workflow.
var standardSpine = []SpineState{
	{Name: "Backlog", Kind: "backlog", SortOrder: 10, IsInitial: true},
	{Name: "To Do", Kind: "todo", SortOrder: 20, IsPullable: true},
	{Name: "Doing", Kind: "in_progress", SortOrder: 30},
	{Name: "Completed", Kind: "done", SortOrder: 40},
	{Name: "Accepted", Kind: "accepted", SortOrder: 50},
}
```

- [ ] **Step 2: Build**

Run: `cd backend && go build ./internal/flows/`
Expected: clean (unused var `standardSpine` is fine — used in 1.2; if the linter rejects unused, proceed to 1.2 before building).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/flows/spine.go
git commit -m "feat(flows): production standard-spine definition for default-flow seeding"
```

### Task 1.2: SeedDefaultFlowForType — the clone primitive (TDD)

**Files:**
- Create: `backend/internal/flows/seed.go`
- Create: `backend/internal/flows/seed_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/flows/seed_test.go`. Reuse the package's existing DB-test harness if one exists (inspect `service_test.go` / any `*_test.go` in the package for a pool helper + skip pattern); otherwise add a `testPool(t)` that reads `VA_DB_*` and `t.Skipf`s when unavailable, mirroring `artefacttypes/seed_test.go`.

```go
package flows

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// Source type has a 5-state flow; cloning onto a new type reproduces states + transitions.
func TestSeedDefaultFlowForType_ClonesSource(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	subID, wsID := seedSubWs(t, pool)

	srcType := seedWorkType(t, pool, subID, wsID, "Story", "US")
	dstType := seedWorkType(t, pool, subID, wsID, "Spike", "SP")
	// Give the source a 2-state flow + 1 transition.
	srcFlow := seedFlow(t, pool, srcType)
	s1 := seedState(t, pool, srcFlow, "Backlog", "backlog", true, false, 10)
	s2 := seedState(t, pool, srcFlow, "Doing", "in_progress", false, true, 20)
	seedTransition(t, pool, srcFlow, s1, s2)

	tx, _ := pool.Begin(ctx)
	defer tx.Rollback(ctx)
	svc := New(pool, pool)
	if err := svc.SeedDefaultFlowForType(ctx, tx, srcType, dstType, "Spike"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// dst now has one default flow with 2 states + 1 transition.
	assertFlowStateCount(t, pool, dstType, 2)
	assertTransitionCount(t, pool, dstType, 1)
	assertHasState(t, pool, dstType, "Backlog", "backlog", true)
}

// Source type has NO flow → fallback seeds the 5-state standard spine.
func TestSeedDefaultFlowForType_FallbackSpine(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	subID, wsID := seedSubWs(t, pool)
	srcType := seedWorkType(t, pool, subID, wsID, "NoFlow", "NF") // no flow seeded
	dstType := seedWorkType(t, pool, subID, wsID, "Spike2", "S2")

	tx, _ := pool.Begin(ctx)
	defer tx.Rollback(ctx)
	svc := New(pool, pool)
	if err := svc.SeedDefaultFlowForType(ctx, tx, srcType, dstType, "Spike2"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	tx.Commit(ctx)

	assertFlowStateCount(t, pool, dstType, 5)         // standard spine
	assertHasState(t, pool, dstType, "Accepted", "accepted", false)
	_ = uuid.Nil
}
```

Add the seed/assert helpers in this file (direct SQL, one INSERT/SELECT each): `testPool`, `seedSubWs`, `seedWorkType`, `seedFlow`, `seedState`, `seedTransition`, `assertFlowStateCount`, `assertTransitionCount`, `assertHasState`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/flows/ -run TestSeedDefaultFlowForType -v`
Expected: FAIL — `SeedDefaultFlowForType` undefined.

- [ ] **Step 3: Implement the seeder**

Create `backend/internal/flows/seed.go`:

```go
package flows

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SeedDefaultFlowForType creates a default flow for newTypeID inside the
// caller's transaction, cloning the source type's live default flow (states +
// transitions). If the source has no live default flow, it seeds the standard
// spine so the type is never flowless. Also writes the flows_defaults snapshot
// rows so "reset to default" works later.
func (s *Service) SeedDefaultFlowForType(ctx context.Context, tx pgx.Tx, sourceTypeID, newTypeID uuid.UUID, newTypeName string) error {
	// 1. Insert the new default flow.
	var newFlowID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO flows (flows_id_artefact_type, flows_name, flows_is_default)
		VALUES ($1, $2, TRUE)
		RETURNING flows_id`,
		newTypeID, newTypeName+" default flow",
	).Scan(&newFlowID); err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType insert flow: %w", err)
	}

	// 2. Find the source's live default flow.
	var srcFlowID uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT flows_id FROM flows
		WHERE flows_id_artefact_type = $1 AND flows_is_default = TRUE AND flows_archived_at IS NULL
		LIMIT 1`, sourceTypeID,
	).Scan(&srcFlowID)

	if errors.Is(err, pgx.ErrNoRows) {
		// 3a. Fallback: seed the standard spine.
		return s.seedSpineStates(ctx, tx, newFlowID, newTypeID, standardSpine)
	}
	if err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType find source: %w", err)
	}

	// 3b. Clone source states, capturing old→new id map.
	rows, err := tx.Query(ctx, `
		SELECT flows_states_id, flows_states_name, flows_states_kind, flows_states_colour,
		       flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable
		FROM flows_states
		WHERE flows_states_id_flow = $1 AND flows_states_archived_at IS NULL
		ORDER BY flows_states_sort_order`, srcFlowID)
	if err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType read states: %w", err)
	}
	type stateRow struct {
		oldID                          uuid.UUID
		name, kind                     string
		colour                         *string
		sortOrder                      int
		isInitial, isPullable          bool
	}
	var srcStates []stateRow
	for rows.Next() {
		var r stateRow
		if err := rows.Scan(&r.oldID, &r.name, &r.kind, &r.colour, &r.sortOrder, &r.isInitial, &r.isPullable); err != nil {
			rows.Close()
			return fmt.Errorf("flows.SeedDefaultFlowForType scan state: %w", err)
		}
		srcStates = append(srcStates, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	idMap := make(map[uuid.UUID]uuid.UUID, len(srcStates))
	for _, st := range srcStates {
		var newID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind,
				flows_states_colour, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING flows_states_id`,
			newFlowID, st.name, st.kind, st.colour, st.sortOrder, st.isInitial, st.isPullable,
		).Scan(&newID); err != nil {
			return fmt.Errorf("flows.SeedDefaultFlowForType insert state: %w", err)
		}
		idMap[st.oldID] = newID
	}

	// 3c. Clone transitions, remapping from/to ids.
	trows, err := tx.Query(ctx, `
		SELECT flows_transitions_id_state_from, flows_transitions_id_state_to
		FROM flows_transitions WHERE flows_transitions_id_flow = $1`, srcFlowID)
	if err != nil {
		return fmt.Errorf("flows.SeedDefaultFlowForType read transitions: %w", err)
	}
	type tr struct{ from, to uuid.UUID }
	var trs []tr
	for trows.Next() {
		var x tr
		if err := trows.Scan(&x.from, &x.to); err != nil {
			trows.Close()
			return err
		}
		trs = append(trs, x)
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return err
	}
	for _, x := range trs {
		nf, okf := idMap[x.from]
		nt, okt := idMap[x.to]
		if !okf || !okt {
			continue // skip transitions referencing archived/absent states
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
			VALUES ($1,$2,$3)
			ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) DO NOTHING`,
			newFlowID, nf, nt,
		); err != nil {
			return fmt.Errorf("flows.SeedDefaultFlowForType insert transition: %w", err)
		}
	}

	return s.writeFlowDefaults(ctx, tx, newTypeID, newFlowID, newTypeName)
}

// seedSpineStates inserts the standard spine states + adjacent-bidirectional
// transitions for a flow, then writes the defaults snapshot.
func (s *Service) seedSpineStates(ctx context.Context, tx pgx.Tx, flowID, typeID uuid.UUID, spine []SpineState) error {
	ids := make([]uuid.UUID, len(spine))
	for i, st := range spine {
		var colour *string
		if st.Colour != "" {
			colour = &st.Colour
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind,
				flows_states_colour, flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
			VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING flows_states_id`,
			flowID, st.Name, st.Kind, colour, st.SortOrder, st.IsInitial, st.IsPullable,
		).Scan(&ids[i]); err != nil {
			return fmt.Errorf("flows.seedSpineStates insert state: %w", err)
		}
	}
	// adjacent bidirectional transitions
	for i := 0; i+1 < len(ids); i++ {
		for _, pair := range [][2]uuid.UUID{{ids[i], ids[i+1]}, {ids[i+1], ids[i]}} {
			if _, err := tx.Exec(ctx, `
				INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
				VALUES ($1,$2,$3)
				ON CONFLICT (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to) DO NOTHING`,
				flowID, pair[0], pair[1],
			); err != nil {
				return fmt.Errorf("flows.seedSpineStates insert transition: %w", err)
			}
		}
	}
	return s.writeFlowDefaultsFromFlow(ctx, tx, typeID, flowID)
}
```

For the `writeFlowDefaults` / `writeFlowDefaultsFromFlow` helpers: both snapshot the just-created flow's states into `flows_defaults` + `flows_states_defaults` (+ transitions defaults). Implement `writeFlowDefaultsFromFlow(ctx, tx, typeID, flowID)` to: `INSERT INTO flows_defaults (flows_defaults_id_artefact_type, flows_defaults_name) VALUES ($1, 'default') ON CONFLICT (flows_defaults_id_artefact_type) DO NOTHING RETURNING flows_defaults_id` (re-select if conflict), then copy the flow's states into `flows_states_defaults` (cols: `_id_flow_default, _name, _kind, _colour, _sort_order, _is_initial, _is_pullable`) and transitions into `flows_transitions_defaults` (`_id_flow_default, _id_state_from, _id_state_to` — remapped to the defaults' state ids). Make `writeFlowDefaults` a thin wrapper calling `writeFlowDefaultsFromFlow`. **If the defaults snapshot proves complex, keep it minimal: a flows_defaults row + flows_states_defaults rows are enough for the reset path; transitions_defaults can be a follow-up TD if it balloons — but emit log + TD, do not skip silently.**

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && go test ./internal/flows/ -run TestSeedDefaultFlowForType -v`
Expected: PASS (both clone + fallback).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/flows/seed.go backend/internal/flows/seed_test.go
git commit -m "feat(flows): SeedDefaultFlowForType — clone source flow or fallback spine (in tx)"
```

### Task 1.3: Wire flow seeding into CreateWorkType (TDD)

**Files:**
- Modify: `backend/internal/artefacttypes/service.go` (tx-wrap + FlowSeeder call)
- Modify: `backend/internal/artefacttypes/service_create_test.go` (assert flow seeded)
- Modify: `backend/cmd/server/main.go` (wire flows.Service as seeder)

- [ ] **Step 1: Define the FlowSeeder interface + add to Service**

In `backend/internal/artefacttypes/service.go`, add near the Service struct:

```go
// FlowSeeder seeds a default flow for a newly-created artefact type, inside a
// transaction. Implemented by flows.Service.
type FlowSeeder interface {
	SeedDefaultFlowForType(ctx context.Context, tx pgx.Tx, sourceTypeID, newTypeID uuid.UUID, newTypeName string) error
}
```

Change `Service` to hold it and `NewService` to accept it:

```go
type Service struct {
	pool       *pgxpool.Pool
	flowSeeder FlowSeeder
}

func NewService(pool *pgxpool.Pool, flowSeeder FlowSeeder) *Service {
	return &Service{pool: pool, flowSeeder: flowSeeder}
}
```

(Import `github.com/jackc/pgx/v5` for `pgx.Tx`.)

- [ ] **Step 2: Tx-wrap CreateWorkType + call the seeder**

Replace the `s.pool.QueryRow(...)` INSERT in `CreateWorkType` with a transaction: begin tx, run the same INSERT via `tx.QueryRow`, then after scanning `t`, call:

```go
	if s.flowSeeder != nil {
		if err := s.flowSeeder.SeedDefaultFlowForType(ctx, tx, in.BehavesLikeTypeID, t.ID, t.Name); err != nil {
			return nil, fmt.Errorf("artefacttypes.CreateWorkType seed flow: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("artefacttypes.CreateWorkType commit: %w", err)
	}
```

with `tx, err := s.pool.Begin(ctx)` + `defer tx.Rollback(ctx)` before the INSERT. Keep the unique-violation→422 mapping (now on the tx insert). The slot-resolution SELECT earlier in the method can stay on `s.pool` (read, pre-tx).

- [ ] **Step 3: Update the existing create test to assert a flow is seeded**

In `service_create_test.go`, the test constructs `NewService(pool)` — update to `NewService(pool, flows.New(pool, pool))` (import the flows package). Extend `TestCreateWorkType_HappyPath` to assert the new type has a default flow with ≥1 state after create (query `flows`/`flows_states` by the returned type id). If the behaves-like Story seeded in the test has no flow, the fallback spine gives 5 states — assert ≥3 to be robust.

- [ ] **Step 4: Run the tests**

Run: `cd backend && go test ./internal/artefacttypes/ -run TestCreateWorkType -v`
Expected: PASS — type created AND flow seeded.

- [ ] **Step 5: Wire the composition root**

In `backend/cmd/server/main.go`, the flows service is currently only inside `flowsH`. Construct a shared `flowsSvc := flows.New(vaPool, servicePool)` and use it for both the handler (`flows.NewHandler(flowsSvc)`) and as the seeder: change `artefacttypes.NewService(vaPool)` → `artefacttypes.NewService(vaPool, flowsSvc)`. Guard for `vaPool == nil` (tests/headless): pass `nil` seeder if flows can't be built — `CreateWorkType` already null-checks `flowSeeder`.

- [ ] **Step 6: Build**

Run: `cd backend && go build ./...`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/artefacttypes/service.go backend/internal/artefacttypes/service_create_test.go backend/cmd/server/main.go
git commit -m "feat(backend): CreateWorkType seeds a default flow via FlowSeeder (one tx)"
```

---

## Phase 2 — Backfill existing flowless work types

### Task 2.1: Seed flows for existing flowless tenant work types

**Files:**
- Create: `dev/scripts/backfill_worktype_flows.sql` (idempotent, dev-data fix)

- [ ] **Step 1: Identify flowless work types**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
-c "SELECT t.artefacts_types_id, t.artefacts_types_name, t.artefacts_types_source FROM artefacts_types t LEFT JOIN flows f ON f.flows_id_artefact_type=t.artefacts_types_id AND f.flows_is_default AND f.flows_archived_at IS NULL WHERE t.artefacts_types_scope='work' AND t.artefacts_types_archived_at IS NULL AND f.flows_id IS NULL;"
```
Expected: Spike (and any other flowless work type).

- [ ] **Step 2: Write the backfill SQL (standard spine for existing flowless types)**

Create `dev/scripts/backfill_worktype_flows.sql` — for each flowless live work type, insert a default flow + the 5 standard-spine states + adjacent transitions. Idempotent: guard each insert so a re-run is a no-op (skip types that already have a default flow). Use a DO block or per-type CTE. (The standard spine is correct here because, per the spec note, existing types' original behaves-like base was not persisted.)

```sql
-- Backfill: seed a standard-spine default flow for every live WORK type that
-- has no default flow. Idempotent. Dev-data fix-up (TD-WORKTYPE-FLOW-SEED).
DO $$
DECLARE rec RECORD; fid uuid; ids uuid[]; sid uuid;
BEGIN
  FOR rec IN
    SELECT t.artefacts_types_id AS tid, t.artefacts_types_name AS tname
    FROM artefacts_types t
    LEFT JOIN flows f ON f.flows_id_artefact_type=t.artefacts_types_id
      AND f.flows_is_default AND f.flows_archived_at IS NULL
    WHERE t.artefacts_types_scope='work' AND t.artefacts_types_archived_at IS NULL
      AND f.flows_id IS NULL
  LOOP
    INSERT INTO flows (flows_id_artefact_type, flows_name, flows_is_default)
    VALUES (rec.tid, rec.tname || ' default flow', TRUE) RETURNING flows_id INTO fid;
    ids := ARRAY[]::uuid[];
    FOREACH sid IN ARRAY ARRAY[1,2,3,4,5]::int[] LOOP NULL; END LOOP; -- placeholder
    -- insert 5 spine states
    WITH spine(name,kind,so,ini,pull) AS (VALUES
      ('Backlog','backlog',10,TRUE,FALSE),('To Do','todo',20,FALSE,TRUE),
      ('Doing','in_progress',30,FALSE,FALSE),('Completed','done',40,FALSE,FALSE),
      ('Accepted','accepted',50,FALSE,FALSE))
    INSERT INTO flows_states (flows_states_id_flow,flows_states_name,flows_states_kind,
      flows_states_sort_order,flows_states_is_initial,flows_states_is_pullable)
    SELECT fid,name,kind,so,ini,pull FROM spine;
    -- adjacent bidirectional transitions
    INSERT INTO flows_transitions (flows_transitions_id_flow,flows_transitions_id_state_from,flows_transitions_id_state_to)
    SELECT fid, a.flows_states_id, b.flows_states_id
    FROM flows_states a JOIN flows_states b ON b.flows_states_id_flow=a.flows_states_id_flow
      AND abs(a.flows_states_sort_order-b.flows_states_sort_order)=10
    WHERE a.flows_states_id_flow=fid
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
```
(Remove the placeholder FOREACH loop — it's illustrative; the state insert is the real work. The transition join pairs states 10 apart, both directions.)

- [ ] **Step 3: Apply the backfill**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
-f dev/scripts/backfill_worktype_flows.sql
```

- [ ] **Step 4: Verify Spike now has a flow**

Run the flowless-types query from Step 1 again.
Expected: empty (no flowless work types). And Spike shows 1 flow / 5 states.

- [ ] **Step 5: Commit**

```bash
git add dev/scripts/backfill_worktype_flows.sql
git commit -m "fix(data): backfill standard-spine flows for existing flowless work types"
```

---

## Phase 3 — Frontend: tier helper

### Task 3.1: workTypeTier / isStoryTier helper (TDD)

**Files:**
- Create: `app/lib/workTypeTier.ts`
- Test: `app/lib/__tests__/workTypeTier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isStoryTier } from "../workTypeTier";
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

const mk = (o: Partial<ArtefactType>): ArtefactType => ({
  id: o.id!, scope: "work", source: "system", name: o.name ?? "X",
  prefix: o.prefix ?? "XX", description: null, colour: null, slot: o.slot ?? null,
  parent_type_id: null, allows_children: true, layer_depth: null, sort_order: 0,
  archived_at: null, created_at: "", updated_at: "",
  execution_parent_slots: o.execution_parent_slots ?? null,
});

describe("isStoryTier", () => {
  it("Story-tier when parents include a strategy floor / Epic slot", () => {
    expect(isStoryTier(mk({ slot: "wrk_story", execution_parent_slots: ["FE", "wrk_epic"] }))).toBe(true);
    expect(isStoryTier(mk({ slot: "wrk_defect", execution_parent_slots: ["wrk_epic", "wrk_story"] }))).toBe(true);
  });
  it("a custom Spike behaving like Story is story-tier", () => {
    expect(isStoryTier(mk({ slot: null, execution_parent_slots: ["FE", "wrk_epic"] }))).toBe(true);
  });
  it("Task is NOT story-tier (parents are Story/Defect, no Feature/Epic floor)", () => {
    expect(isStoryTier(mk({ slot: "wrk_task", execution_parent_slots: ["wrk_defect", "wrk_story"] }))).toBe(false);
  });
  it("Epic is NOT story-tier (parents Feature only — it IS the top, treat as above-tier)", () => {
    // Epic parents under Feature only; it sits ABOVE the story tier.
    expect(isStoryTier(mk({ slot: "wrk_epic", execution_parent_slots: ["FE"] }))).toBe(false);
  });
});
```

> Tier rule (derived from the live slot data): a work type is **story-tier** if its
> `execution_parent_slots` include `wrk_epic` (it nests under Epic) — Story `[FE,wrk_epic]`,
> Defect `[wrk_epic,wrk_story]` qualify; Task `[wrk_defect,wrk_story]` (no Epic) and Epic `[FE]`
> (no Epic, it IS the ceiling) do not. Risk currently has empty slots (TD-RISK-WORK-PARENT-SLOTS) —
> handle explicitly: Risk's canonical slot `wrk_risk` is story-tier by definition, so the helper
> treats an empty-slots type with `slot==='wrk_risk'` as story-tier; an empty-slots CUSTOM type
> (no signal) defaults to NOT story-tier (conservative — keeps unknowns out of the sprint backlog).

- [ ] **Step 2: Run to verify fail**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/lib/__tests__/workTypeTier.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `app/lib/workTypeTier.ts`:

```ts
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

// A work type is "story-tier" if it nests under Epic (parents include wrk_epic).
// Story [FE,wrk_epic] + Defect [wrk_epic,wrk_story] qualify; Task [wrk_defect,
// wrk_story] and Epic [FE] do not. Derived from execution_parent_slots so custom
// types inherit their behaves-like tier. Pays down TD-SPRINTREVIEW-STORY-TIER-STATIC.
export function isStoryTier(type: ArtefactType): boolean {
  const slots = type.execution_parent_slots ?? [];
  if (slots.some((s) => s.toLowerCase() === "wrk_epic")) return true;
  // Risk has empty slots today but is canonically story-tier.
  if ((type.slot ?? "").toLowerCase() === "wrk_risk") return true;
  return false;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/lib/__tests__/workTypeTier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/workTypeTier.ts app/lib/__tests__/workTypeTier.test.ts
git commit -m "feat(fe): isStoryTier helper derives tier from execution_parent_slots"
```

---

## Phase 4 — Frontend: display-filter sweep (NOT sprint-planning)

> **HARD CONSTRAINT — do NOT modify `app/(user)/value-sprint/page.tsx` (sprint-planning).** It is
> deferred per user directive 2026-06-07. If a step would touch it, STOP and ask. It is NOT in this
> phase.

### Task 4.1: Show all live work types in the create/filter surfaces

**Files:**
- Modify: `app/(user)/work-items/GridWorkItems.tsx`
- Modify: `app/(user)/scope/GridExecution.tsx`

- [ ] **Step 1: GridWorkItems — drop the slot gate on createTypes**

In `app/(user)/work-items/GridWorkItems.tsx`, the `createTypes` filter is
`workTypeOptions.filter((t) => t.slot ? WORK_ITEM_CREATEABLE_SLOTS.has(t.slot) : false)`. Change to
include every live work type (canonical + custom):

```ts
const createTypes = useMemo(
  () => workTypeOptions.filter((t) => t.slot == null || WORK_ITEM_CREATEABLE_SLOTS.has(t.slot)),
  [workTypeOptions],
);
```
Apply the same relaxation to the chip/facet filter options if they use the same gate. (Leave `WORK_ITEM_CREATEABLE_SLOTS` defined — it still orders/labels canonical types; it just no longer excludes custom ones.)

- [ ] **Step 2: GridExecution — same relaxation**

In `app/(user)/scope/GridExecution.tsx`, apply the identical `t.slot == null || SET.has(t.slot)` change at its `WORK_ITEM_CREATEABLE_SLOTS` filter site (~line 204).

- [ ] **Step 3: Typecheck**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(user)/work-items/GridWorkItems.tsx" "app/(user)/scope/GridExecution.tsx"
git commit -m "feat(fe): show custom (slot=null) work types in create + filter lists"
```

### Task 4.2: Sprint-review tier-aware clamp

**Files:**
- Modify: `app/(user)/value-sprint-review/GridSprintReview.tsx`

- [ ] **Step 1: Replace STORY_TIER_SLOTS filter with isStoryTier**

In `app/(user)/value-sprint-review/GridSprintReview.tsx`, find the `STORY_TIER_SLOTS` filter (~line 72/179: `t.slot ? STORY_TIER_SLOTS.includes(t.slot) : false`). Replace with the derived helper:

```ts
import { isStoryTier } from "@/app/lib/workTypeTier";
// ...
const storyTierTypes = workTypeOptions.filter(isStoryTier);
```
Remove the now-unused `STORY_TIER_SLOTS` constant. Canonical Story/Defect/Risk still qualify; a behaves-like-Story custom type rides along; Epic/Task stay out.

- [ ] **Step 2: Typecheck + sprint-review tests**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit && npx vitest run app/(user)/value-sprint-review 2>/dev/null || npx vitest run app/lib/__tests__/workTypeTier.test.ts`
Expected: clean / green.

- [ ] **Step 3: Commit**

```bash
git add "app/(user)/value-sprint-review/GridSprintReview.tsx"
git commit -m "feat(fe): sprint-review story-tier derived from execution_parent_slots (custom types ride along)"
```

### Task 4.3: Wizard JSON union

**Files:**
- Modify: the component that consumes `createableTypeSlots` from `p_wizard_workitems.json` / `p_wizard_risks.json`

- [ ] **Step 1: Find the consumer**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -rn "createableTypeSlots" app/`
Identify the component(s) that read the wizard JSON's `createableTypeSlots` and use it to filter the create menu.

- [ ] **Step 2: Union JSON slots with live custom types**

Where the consumer filters types by `createableTypeSlots.includes(t.slot)`, change so it ALSO includes live `scope==='work'` types whose `slot == null` (custom tenant types). The JSON list stays as the canonical seed; "not in JSON" no longer means "exclude" for custom types:

```ts
const allowed = (t) => t.slot == null || createableTypeSlots.includes(t.slot);
```

- [ ] **Step 3: Typecheck**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add <the consumer file(s)>
git commit -m "feat(fe): wizard create menu unions JSON slots with live custom work types"
```

---

## Phase 5 — Tech-debt + verification

### Task 5.1: Tech-debt entries

**Files:**
- Modify: `docs/c_tech_debt.md`

- [ ] **Step 1: Update/add entries** (match existing 8-cell row format)

- **TD-SPRINTREVIEW-STORY-TIER-STATIC** — mark paid: tier now derived from `execution_parent_slots` via `isStoryTier`.
- **TD-WORKTYPE-FLOW-SEED** (new, resolved) — `CreateWorkType` now seeds a default flow (clone-or-spine); reusable `flows.SeedDefaultFlowForType`. Backfill applied for pre-existing flowless types.
- **TD-WORKTYPE-BEHAVESLIKE-NOT-PERSISTED** (new, S3) — Part 1 didn't store `behaves_like_type_id`; backfill of existing flowless types falls back to standard spine. Trigger: if post-hoc re-clone-from-base is needed, persist the base id on the type.
- **TD-SPRINTPLANNING-CUSTOM-TYPES** (new, S3) — `value-sprint/page.tsx` deferred; custom types don't appear in sprint-planning. Trigger: user readiness.

- [ ] **Step 2: Commit**

```bash
git add docs/c_tech_debt.md
git commit -m "docs(tech-debt): custom-work-types follow-ups (4 entries)"
```

### Task 5.2: SY003 regeneration

- [ ] **Step 1: Regenerate SY003** — the backfill changed substrate data (new flows rows). Per the HARD RULE, prepend a SY003 change-log entry noting flow-seeding on CreateWorkType + the flowless backfill. (Orchestrator handles the `<report> -sy` invocation.)

### Task 5.3: Full regression

- [ ] **Step 1: Backend**

Run: `cd backend && go build ./... && go test ./internal/flows/... ./internal/artefacttypes/... -count=1`
Expected: PASS.

- [ ] **Step 2: Frontend**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit && npx vitest run app/lib/__tests__/workTypeTier.test.ts app/components/ArtefactTypeCreateFlyout app/components/ArtefactInlineForm`
Expected: clean / PASS.

- [ ] **Step 3: Live smoke (orchestrator, with user)** — create a custom work type, confirm it (a) appears in work-items create pills, (b) shows in Transition Rules with a workflow, (c) appears in sprint-review if story-tier. Deferred to the joint smoke test.

---

## Self-review notes (resolved)

- **flows.Service not tx-aware** → the seeder runs raw SQL on the passed `tx`, not via Service methods (Task 1.2). ✓
- **Spine has no colour field** → cloned states copy source colour; spine states seed null colour (Task 1.1/1.2). ✓
- **flows_states kind enum is 6-value** → spine kinds (`backlog/todo/in_progress/done/accepted`) all valid; clone copies verbatim. ✓
- **Transition col names** `flows_transitions_id_state_from/_to` used (not `_from_state`). ✓
- **Sprint-planning ring-fenced** → Phase 4 hard-constraint banner; not touched. ✓
- **Risk empty-slots edge** → `isStoryTier` treats `wrk_risk` as story-tier explicitly; unknown custom empty-slots types default out (conservative). ✓
- **Type consistency** — `SeedDefaultFlowForType(ctx, tx, sourceTypeID, newTypeID, newTypeName)` identical in interface (artefacttypes) + impl (flows) + test. ✓
