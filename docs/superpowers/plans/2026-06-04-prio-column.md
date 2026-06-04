# Prio Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sequential "Prio" column (1..n) to the /scope execution grid, derived from the existing `artefacts_position` substrate via a SQL window function — matching Rally's `DragAndDropRank` pattern (per-view dense projection, single global ordering substrate).

**Architecture:** One SQL `ROW_NUMBER()` projection over the filtered result set in the artefactitems read query, surfaced as a nullable `Prio *int` on the `WorkItem` DTO. Null for tasks, nested rows, and anything that fails the cohort filter. Frontend renders it as the first column of the grid with the existing tree caret/indent attaching to it (Rally-style). No new migrations, no new mutations — `/rank/move` already maintains the substrate.

**Tech Stack:** PostgreSQL window functions; Go (chi router + pgx); TypeScript + React 18; Vitest + RTL for component tests; Go `testing` with `vaPool(t)` + `pickTestSubscription(t, va)` integration pattern.

**Spec reference:** [docs/superpowers/specs/2026-06-04-prio-column-design.md](../specs/2026-06-04-prio-column-design.md)

---

## File Structure

**Modify:**
- [backend/internal/artefactitems/types.go](../../../backend/internal/artefactitems/types.go) — add `Prio *int` field to `WorkItem` struct.
- [backend/internal/artefactitems/sql.go](../../../backend/internal/artefactitems/sql.go) — append `artefacts_prio` projection to the shared `sqlWorkItemColumns` constant.
- [backend/internal/artefactitems/service.go](../../../backend/internal/artefactitems/service.go) — append `&wi.Prio` to the `Scan(...)` call in `scanWorkItemRow`.
- [app/(user)/scope/scopeTreeData.ts](../../../app/(user)/scope/scopeTreeData.ts) — add `prio: number | null` to both `WireWorkItem` and `ScopeNode`; map in `mapWire()`.
- [app/(user)/scope/scopeColumns.tsx](../../../app/(user)/scope/scopeColumns.tsx) — insert "prio" column at array index 0; add to `SORT_KEY_BY_COLUMN`.
- [app/globals.css](../../../app/globals.css) — add `.grid__Tree_Prio` class with tabular-nums + right-align.

**Create:**
- [backend/internal/artefactitems/service_prio_test.go](../../../backend/internal/artefactitems/service_prio_test.go) — integration test asserting Prio invariants on a real read.
- [app/(user)/scope/__tests__/scopeColumns.prio.test.tsx](../../../app/(user)/scope/__tests__/scopeColumns.prio.test.tsx) — component test rendering the prio cell.

Two cycles: backend (Tasks 1–5) then frontend (Tasks 6–9). Manual verification at the end (Task 10).

---

## Task 1: Backend — write failing integration test for Prio

**Files:**
- Create: `backend/internal/artefactitems/service_prio_test.go`

- [ ] **Step 1: Write the failing test**

Create [backend/internal/artefactitems/service_prio_test.go](../../../backend/internal/artefactitems/service_prio_test.go) with:

```go
package artefactitems_test

import (
	"context"
	"testing"

	"github.com/mmffdev/vector/backend/internal/artefactitems"
)

// TestListWorkItems_PrioInvariants asserts the derivation rules for the new
// Prio column:
//   - Every top-level non-task row has non-nil Prio.
//   - Every nested row (parent_id != nil) has nil Prio.
//   - Every task row has nil Prio.
//   - Non-nil Prio values are unique and form a contiguous 1..N sequence in
//     ORDER BY artefacts_position ASC.
func TestListWorkItems_PrioInvariants(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, nil, "work")

	items, _, err := svc.ListWorkItems(context.Background(), sub, artefactitems.Filters{Limit: 1000})
	if err != nil {
		t.Fatalf("ListWorkItems: %v", err)
	}
	if len(items) == 0 {
		t.Skip("no items in test subscription — cannot assert Prio invariants")
	}

	seen := make(map[int]string) // prio → item id, for uniqueness check
	maxPrio := 0
	qualifyingCount := 0

	for _, item := range items {
		isTopLevel := item.ParentID == nil
		isTask := item.ItemType == "task"
		qualifies := isTopLevel && !isTask

		if qualifies {
			qualifyingCount++
			if item.Prio == nil {
				t.Errorf("item %s (top-level, type=%s) has nil Prio, want non-nil", item.ID, item.ItemType)
				continue
			}
			if prev, dup := seen[*item.Prio]; dup {
				t.Errorf("Prio %d duplicated: %s and %s", *item.Prio, prev, item.ID)
			}
			seen[*item.Prio] = item.ID
			if *item.Prio > maxPrio {
				maxPrio = *item.Prio
			}
		} else {
			if item.Prio != nil {
				t.Errorf("item %s (top_level=%v, type=%s) has Prio=%d, want nil", item.ID, isTopLevel, item.ItemType, *item.Prio)
			}
		}
	}

	// Contiguous 1..N
	if qualifyingCount > 0 {
		if maxPrio != qualifyingCount {
			t.Errorf("max Prio = %d but qualifying count = %d (expect contiguous 1..N)", maxPrio, qualifyingCount)
		}
		for i := 1; i <= qualifyingCount; i++ {
			if _, ok := seen[i]; !ok {
				t.Errorf("Prio %d missing from sequence 1..%d", i, qualifyingCount)
			}
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails (compile error on .Prio)**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && go test ./internal/artefactitems/ -run TestListWorkItems_PrioInvariants -v 2>&1 | head -30
```
Expected: compile error `item.Prio undefined (type artefactitems.WorkItem has no field or method Prio)`.

- [ ] **Step 3: Commit the failing test**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add backend/internal/artefactitems/service_prio_test.go
git commit -m "test(artefactitems): failing integration test for Prio invariants"
```

---

## Task 2: Backend — add `Prio *int` field to WorkItem DTO

**Files:**
- Modify: `backend/internal/artefactitems/types.go` (struct `WorkItem`, around the bottom of the struct before the closing brace — the file already groups demoted/system fields together)

- [ ] **Step 1: Read the current bottom of the WorkItem struct**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -n "FlowStateChangeOwnerUserID\|^}" backend/internal/artefactitems/types.go | head -10
```
Use this output to locate the LAST field of the struct (`FlowStateChangeOwnerUserID`) and the closing `}` immediately after it.

- [ ] **Step 2: Insert the `Prio` field**

Open [backend/internal/artefactitems/types.go](../../../backend/internal/artefactitems/types.go), find the line for `FlowStateChangeOwnerUserID` (the last field per `scanWorkItemRow`'s ordering comment), and add immediately after it (before the closing `}` of the struct):

```go
	// Prio — dense 1..N rank derived from artefacts_position over the
	// filtered result set. Non-nil only for top-level non-task rows; nil
	// for tasks and nested artefacts. See sqlWorkItemColumns for the
	// window projection.
	Prio *int `json:"prio,omitempty"`
```

- [ ] **Step 3: Verify the struct still compiles (without scan changes — should still error on test, just no longer on the field reference)**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && go build ./internal/artefactitems/ 2>&1 | head -20
```
Expected: clean build. The test won't pass yet (column missing from SQL + scan), but the field exists.

- [ ] **Step 4: Commit**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add backend/internal/artefactitems/types.go
git commit -m "feat(artefactitems): add Prio field to WorkItem DTO"
```

---

## Task 3: Backend — add SQL window projection for Prio

**Files:**
- Modify: `backend/internal/artefactitems/sql.go` — `sqlWorkItemColumns` constant tail (around line 163)

The shared `sqlWorkItemColumns` constant ends with:
```sql
a.artefacts_id_user_flow_state_change_owner::text AS flow_state_change_owner_user_id
```
(no trailing comma — it's the final column). We append `artefacts_prio` after it.

- [ ] **Step 1: Add the window projection to sqlWorkItemColumns**

Open [backend/internal/artefactitems/sql.go](../../../backend/internal/artefactitems/sql.go). Locate the end of `sqlWorkItemColumns` (search for `flow_state_change_owner_user_id` — it appears in the closing line of that constant). Replace:

```go
	a.artefacts_id_user_flow_state_change_owner::text AS flow_state_change_owner_user_id`
```

with:

```go
	a.artefacts_id_user_flow_state_change_owner::text AS flow_state_change_owner_user_id,
	-- Prio — dense 1..N rank over the filtered result set, derived from
	-- artefacts_position. PARTITION BY boolean creates two partitions:
	-- qualifying (top-level non-task) rows form one continuous sequence;
	-- non-qualifying rows go into the other partition and their numbers
	-- are suppressed to NULL by the outer CASE. The window evaluates
	-- AFTER the WHERE clause, so the densification is scoped to whatever
	-- the caller filters down to (workspace, topology clamp, type chip,
	-- etc.). Order MUST stay in lockstep with scanWorkItemRow.
	CASE
		WHEN a.artefacts_id_parent IS NULL
		 AND at.artefacts_types_slot IS DISTINCT FROM 'wrk_task'
		THEN ROW_NUMBER() OVER (
			PARTITION BY (a.artefacts_id_parent IS NULL AND at.artefacts_types_slot IS DISTINCT FROM 'wrk_task')
			ORDER BY a.artefacts_position ASC, a.artefacts_number ASC
		)
		ELSE NULL
	END AS artefacts_prio`
```

Note `IS DISTINCT FROM` (not `!=`) — `artefacts_types_slot` is nullable for custom types (per the artefact-types report), and `NULL != 'wrk_task'` is NULL (falsy in the CASE), which would wrongly bucket custom types as non-qualifying. `IS DISTINCT FROM` returns TRUE when one side is NULL, which is what we want.

- [ ] **Step 2: Compile (will still fail tests — scan not updated)**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && go build ./internal/artefactitems/ 2>&1 | head -20
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add backend/internal/artefactitems/sql.go
git commit -m "feat(artefactitems): SQL window projection for Prio (artefacts_position rank)"
```

---

## Task 4: Backend — wire `&wi.Prio` into scanWorkItemRow

**Files:**
- Modify: `backend/internal/artefactitems/service.go` — `scanWorkItemRow` function (around line 2658–2821); specifically the trailing `&wi.FlowStateChangeOwnerUserID,` line at the end of the `row.Scan(...)` call.

- [ ] **Step 1: Locate the last scan target**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -n "FlowStateChangeOwnerUserID" backend/internal/artefactitems/service.go
```
Use the line with `&wi.FlowStateChangeOwnerUserID,` (inside the `row.Scan(...)` arg list) as the anchor.

- [ ] **Step 2: Append `&wi.Prio` after the last existing scan target**

Edit [backend/internal/artefactitems/service.go](../../../backend/internal/artefactitems/service.go). Find:

```go
		&wi.FlowStateChangeOwnerUserID,
	)
```

Replace with:

```go
		&wi.FlowStateChangeOwnerUserID,
		&wi.Prio,
	)
```

- [ ] **Step 3: Run the integration test to verify it now passes**

Ensure the backend env is dev (it should be — per CLAUDE.md the env is pinned to dev and the tunnel runs on `:5435`). Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && go test ./internal/artefactitems/ -run TestListWorkItems_PrioInvariants -v 2>&1 | tail -30
```
Expected: `--- PASS: TestListWorkItems_PrioInvariants` (or skip if test subscription has no items — but most dev tenants do).

If the test skips, also run the existing tenant-rows test as a sanity check that we didn't break the scan:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && go test ./internal/artefactitems/ -run TestListWorkItems -v 2>&1 | tail -30
```
Expected: all `TestListWorkItems_*` PASS — confirms the scan order is still correct after appending Prio.

- [ ] **Step 4: Commit**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add backend/internal/artefactitems/service.go
git commit -m "feat(artefactitems): scan Prio from window projection into WorkItem DTO"
```

---

## Task 5: Backend — sanity check the full artefactitems test suite

The window function is now live in the shared `sqlWorkItemColumns` — every read path (List, Get, ListChildren) carries the same projection. Verify nothing regressed.

- [ ] **Step 1: Run all artefactitems tests**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && go test ./internal/artefactitems/ -v 2>&1 | tail -80
```
Expected: all green. Scan-order mismatches surface immediately as `Scan error: expected N destination arguments in Scan, not M` — verify no such error appears.

- [ ] **Step 2: If any test fails on scan-arg count, re-check Task 3 (column position) and Task 4 (scan position) match.**

The new column must be LAST in both sqlWorkItemColumns AND in the scan arg list. If a test was scanning manually elsewhere, find it via:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -rn "row\.Scan\|rows\.Scan" backend/internal/artefactitems/ | head
```
and fix the same way.

- [ ] **Step 3: No commit needed (this is verification only).**

---

## Task 6: Frontend — extend ScopeNode + WireWorkItem with prio

**Files:**
- Modify: `app/(user)/scope/scopeTreeData.ts` — `WireWorkItem` interface (lines 51–69), `ScopeNode` interface (lines 30–48), `mapWire` function (around line 82).

- [ ] **Step 1: Add `prio` to WireWorkItem**

Open [app/(user)/scope/scopeTreeData.ts](../../../app/(user)/scope/scopeTreeData.ts). In the `WireWorkItem` interface (the one whose comment says "subset of backend WorkItem"), add as a new field — placement near the end is fine:

```ts
interface WireWorkItem {
  id: string;
  key_num: number;
  type_prefix: string;
  artefact_type_id: string;
  title: string;
  flow_state_id: string;
  flow_state_name: string;
  flow_state_code: string;
  story_points: number | null;
  sprint: { id: string; alias: string } | null;
  parent: { id: string; type_prefix: string; key_num: number; title: string } | null;
  owner: { id: string; display_name: string; avatar_url: string | null } | null;
  due_date: string | null;
  children_count: number;
  colour: string | null;
  prio: number | null;
}
```

- [ ] **Step 2: Add `prio` to ScopeNode**

In the `ScopeNode` interface, add `prio` as a new field — placement near the end:

```ts
export interface ScopeNode {
  id: string;
  uuid: string;
  type: string;
  artefactTypeId: string;
  summary: string;
  flowStateId: string;
  flowStateName: string;
  flowStateCode: string;
  points: number | null;
  owner: string;
  parent: string | null;
  parentId: string | null;
  parentUuid: string | null;
  sprint: string | null;
  due: string | null;
  childrenCount: number;
  colour: string | null;
  prio: number | null;
}
```

- [ ] **Step 3: Map prio in mapWire**

Find the `mapWire` function (line 82). It ends with `colour: w.colour ?? null,`. Add immediately after:

```ts
    colour: w.colour ?? null,
    prio: w.prio ?? null,
  };
}
```

- [ ] **Step 4: Type-check**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "scopeTreeData|scopeColumns" | head -20
```
Expected: no errors involving `scopeTreeData.ts` (any errors in `scopeColumns.tsx` are fine — that's the next task).

- [ ] **Step 5: Commit**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add "app/(user)/scope/scopeTreeData.ts"
git commit -m "feat(scope): thread prio through WireWorkItem and ScopeNode"
```

---

## Task 7: Frontend — write failing test for Prio column rendering

**Files:**
- Create: `app/(user)/scope/__tests__/scopeColumns.prio.test.tsx`

- [ ] **Step 1: Check whether the __tests__ dir exists; create if not**

```bash
mkdir -p "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/app/(user)/scope/__tests__"
```

- [ ] **Step 2: Write the failing test**

Create [app/(user)/scope/__tests__/scopeColumns.prio.test.tsx](../../../app/(user)/scope/__tests__/scopeColumns.prio.test.tsx):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { makeScopeColumns } from "../scopeColumns";
import type { ScopeNode } from "../scopeTreeData";

const noopOpenForm = vi.fn();
const emptyFlowStates = new Map();

function makeNode(overrides: Partial<ScopeNode> = {}): ScopeNode {
  return {
    id: "EP-1",
    uuid: "00000000-0000-0000-0000-000000000001",
    type: "EP",
    artefactTypeId: "type-epic",
    summary: "Test Epic",
    flowStateId: "fs-1",
    flowStateName: "Backlog",
    flowStateCode: "backlog",
    points: null,
    owner: "",
    parent: null,
    parentId: null,
    parentUuid: null,
    sprint: null,
    due: null,
    childrenCount: 0,
    colour: null,
    prio: null,
    ...overrides,
  };
}

describe("scopeColumns — Prio column", () => {
  it("is the first column in the array", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates);
    expect(cols[0]?.id).toBe("prio");
    expect(cols[0]?.label).toBe("Prio");
  });

  it("renders the numeric value when prio is set", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates);
    const prioCol = cols[0]!;
    const node = makeNode({ prio: 7 });
    render(<div>{prioCol.renderCell!(node, undefined)}</div>);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders an empty cell when prio is null", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates);
    const prioCol = cols[0]!;
    const node = makeNode({ prio: null });
    const { container } = render(<div>{prioCol.renderCell!(node, undefined)}</div>);
    // The cell should render the wrapper span but with no text content.
    const cell = container.querySelector(".grid__Tree_Prio");
    expect(cell).toBeTruthy();
    expect(cell?.textContent).toBe("");
  });

  it("has fixed width and is sortable but not resizable", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates);
    const prioCol = cols[0]!;
    expect(prioCol.defaultWidth).toBe(56);
    expect(prioCol.sortable).toBe(true);
    expect(prioCol.resizable).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run "app/(user)/scope/__tests__/scopeColumns.prio.test.tsx" 2>&1 | tail -25
```
Expected: FAIL with `cols[0]?.id` being `"id"` not `"prio"` (current first column is ID, not Prio).

- [ ] **Step 4: Commit the failing test**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add "app/(user)/scope/__tests__/scopeColumns.prio.test.tsx"
git commit -m "test(scope): failing test for Prio column at index 0"
```

---

## Task 8: Frontend — insert Prio column at index 0 in scopeColumns

**Files:**
- Modify: `app/(user)/scope/scopeColumns.tsx` — `makeScopeColumns` function (lines 121–209), and `SORT_KEY_BY_COLUMN` (around line 73).

- [ ] **Step 1: Insert the Prio column descriptor at index 0**

Open [app/(user)/scope/scopeColumns.tsx](../../../app/(user)/scope/scopeColumns.tsx). Find the `return [` line inside `makeScopeColumns`. The current first entry is the `{ id: "id", label: "ID", ... }` block. Insert a new entry BEFORE it:

```tsx
  return [
    {
      id: "prio",
      label: "Prio",
      defaultWidth: 56,
      sortable: true,
      resizable: false,
      renderCell: (r) => (
        <span className="grid__Tree_Prio">{r.prio ?? ""}</span>
      ),
    },
    {
      id: "id",
      label: "ID",
      defaultWidth: 160,
      sortable: true,
      resizable: true,
      renderCell: (r) => <IdCell row={r} onOpenForm={onOpenForm} />,
    },
    // ... rest unchanged ...
```

- [ ] **Step 2: Wire sort key for prio**

In the same file, locate `SORT_KEY_BY_COLUMN` (search for `export const SORT_KEY_BY_COLUMN`). The current entries map column ids to backend sort keys. Add `prio` at the top:

```ts
export const SORT_KEY_BY_COLUMN: Record<string, string | null> = {
  prio: "position",
  id: "id",
  summary: "title",
  status: "status",
  points: "points",
  // ... rest unchanged ...
};
```

Note: the backend will need to accept `position` as a sortable key. This may already be supported (the `/rank/move` endpoint uses `artefacts_position`); if `position` isn't in the backend's sort whitelist, the column will degrade to default sort (which is already `position ASC` — same as Prio ascending). Acceptable as a starting state; confirm in Task 10.

- [ ] **Step 3: Run the component test to verify it passes**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run "app/(user)/scope/__tests__/scopeColumns.prio.test.tsx" 2>&1 | tail -20
```
Expected: 4 tests PASS.

- [ ] **Step 4: Type-check the full app**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -30
```
Expected: no new type errors. Any pre-existing errors that don't mention `scope`, `Prio`, or `prio` are not introduced by this change.

- [ ] **Step 5: Commit**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add "app/(user)/scope/scopeColumns.tsx"
git commit -m "feat(scope): insert Prio column at index 0"
```

---

## Task 9: Frontend — add CSS for `.grid__Tree_Prio`

**Files:**
- Modify: `app/globals.css` — add a new class colocated with the other `grid__Tree_*` classes.

- [ ] **Step 1: Locate the existing grid__Tree_* class block**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -n "^.grid__Tree_" app/globals.css | head -10
```
Use the output to find a sensible location (alongside other `.grid__Tree_Cell` / `.grid__Tree_Caret` classes).

- [ ] **Step 2: Add the Prio class**

Append (or insert into the grid-tree block) in [app/globals.css](../../../app/globals.css):

```css
.grid__Tree_Prio {
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  display: inline-block;
  width: 100%;
  padding-right: 6px;
}
```

`width: 100%` so the right-align inside the cell behaves correctly. `var(--text-secondary, …)` falls back to a neutral grey if the theme token isn't defined (per the active CSS pack).

- [ ] **Step 3: Commit**

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
git add app/globals.css
git commit -m "feat(scope): style Prio cell — tabular nums, right-aligned"
```

---

## Task 10: End-to-end verification

The Prio column is now live end-to-end. Verify it manually in the running app and against the Rally reference screenshots.

- [ ] **Step 1: Start the dev server** (skip if already running)

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npm run dev 2>&1 | head -5 &
```
Wait ~5s for compile.

- [ ] **Step 2: Open /scope in the browser**

Navigate to `http://localhost:3000/scope`. Confirm visually:
- A new "Prio" column appears as the leftmost user column (after stripe/select/drag/cog lead controls).
- Top-level non-task rows show 1, 2, 3, ... in display order with no gaps.
- The tree caret (+/−) sits inside the Prio cell on rows that have children. (Matches Rally — see the parent-rollup screenshot in the spec.)
- Tasks (expanded under a Story) show an empty Prio cell.

- [ ] **Step 3: Switch topology focus and re-verify densification**

Use the topology focus control to switch from a parent node to a single child node. Confirm:
- The Prio numbers densify to 1..n of the visible subset.
- The relative order of items that appear in both views is preserved.
- (This is the Rally three-screenshot pattern — see [spec](../specs/2026-06-04-prio-column-design.md) §Model.)

- [ ] **Step 4: Drag-reorder + verify**

Drag a top-level row to a new position. Confirm:
- The Prio numbers update to reflect the new order on refresh (next read).
- Items that moved past are renumbered.

- [ ] **Step 5: Add + delete + re-verify** (optional smoke test)

- Create a new top-level artefact (Epic, Story, or Defect). Confirm it appears at the end of the cohort with Prio = max+1.
- Delete a mid-cohort artefact. Confirm subsequent items renumber down by 1 on refresh.

- [ ] **Step 6: Cross-check against Rally screenshots**

The spec includes verified screenshots showing 1..15 (Insurance parent rollup), 1..9 (B2B Insurance child), and 1..2 (Dev Team A grandchild) with relative order preserved. The Vector behaviour should match.

- [ ] **Step 7: Final commit (only if anything visual needed adjustment in CSS — otherwise nothing to commit)**

---

## Self-Review Notes

Plan covers all spec requirements:
- ✓ Backend SQL projection (Task 3)
- ✓ DTO field (Task 2)
- ✓ Scan wiring (Task 4)
- ✓ Integration test asserting cohort invariants (Task 1)
- ✓ Frontend wire shape + ScopeNode + mapping (Task 6)
- ✓ Component column with correct width, sortable, resizable (Tasks 7 + 8)
- ✓ Empty cell for null (Task 7 test 3)
- ✓ CSS with tabular nums + right-align (Task 9)
- ✓ Manual cross-view densification check (Task 10 step 3)

Spec Open Questions that are deliberately not addressed in this plan (per spec, deferred):
- **§1 Duplicate placement** (rule 5 — `source+1` insertion): deferred to a follow-up story; current duplicate behaviour likely appends at end of cohort, which produces a working Prio just not at `source+1`.
- **§2 Performance index**: the existing `artefacts_position` is already used in ORDER BY by the children query, so an appropriate index almost certainly exists. If Task 5's test suite shows slow runs, file a follow-up to add `(artefacts_id_subscription, artefacts_id_workspace, artefacts_id_parent, artefacts_position)`.
- **§3 Sort indicator semantics**: covered implicitly — clicking Prio descending will invert the sort but keep the Prio numbers as-is (the number is what it is, regardless of display direction); revisit only if it feels wrong in Task 10.

## After Implementation

Once all tasks pass and Task 10 verifies visually:

1. Add a one-liner to [Vector_Scope.md](../../../Vector_Scope.md) under the appropriate feature heading (e.g. "Prio column on execution grid — derived dense rank over `artefacts_position`; matches Rally `DragAndDropRank` model").
2. If duplicate-placement (Spec §1) is wanted, file a follow-up story via `<stories>`.
3. Update [docs/c_c_dependencies.md](../../../docs/c_c_dependencies.md) or a new `docs/c_c_prio.md` if the team-facing doc map needs it (judgement call).
