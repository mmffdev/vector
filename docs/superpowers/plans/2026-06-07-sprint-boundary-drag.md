# Sprint Boundary-Drag POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jira-style movable sprint-boundary build on `/value-sprint` — one continuous list where dragging a divider down sweeps backlog rows into the sprint, committing membership (`sprint_id`) on release — mounted as a POC above the existing two panels.

**Architecture:** A NEW sibling skin (`Grid__SprintBoundary`) inside `app/components/Grid/` that reuses the headless `useTree` engine + the pure-presentation `Grid__Tree_Row`/`Grid__Tree_Head` + `useColumnManager` + the exported `mapWire`/`ScopeNode` row model — WITHOUT modifying `Grid__Tree.tsx` or any shared Grid file. Two `useTree` instances (sprint clamp `sprintId=<id>`, backlog clamp `sprintId="__none__"`) feed one rendered list with a draggable divider between them. Boundary position is UI-only state during a drag; on release a delta of crossed rows is committed via the existing `workItems.patch(uuid, {sprint_id})` path, then both lists refetch.

**Tech Stack:** React + TypeScript, `useTree` (Grid primitive), `workItems.query`/`workItems.patch` (apiSite POST gateway), pointer events for the drag, Vitest + @testing-library/react for tests, CSS in `app/globals.css` (`grid__SprintBoundary_*`).

---

## Constraints (non-negotiable — verify on every task)

- **DO NOT edit** `Grid__Tree.tsx`, `Grid__Tree_Row.tsx`, `Grid__Tree_Head.tsx`, `Grid__Tree_Lines.tsx`, `useTree.ts`, `useColumnManager.ts`, `types.ts`, or `scopeTreeData.ts`. These are shared by `/scope`, `/work-items`, `/value-sprint-review`. The PR diff must show **zero** changes to them. Import them; never mutate them.
- **Commit model:** membership only (`sprint_id`). No rank/position writes. No backend changes.
- **Commit timing:** on release only. Dragging is pure UI (no network).
- **Page edit is additive:** the POC mounts ABOVE the existing `<Panel>`s; the two legacy panels stay exactly as they are, fully editable.
- Branch is already `feat/sprint-boundary-drag-poc`. Stay on it.

## File Structure

- Create: `app/components/Grid/sprintBoundaryTreeData.ts` — `fetchSprintRoots(page, sprintId)` wrapping `workItems.query` with `filters.sprintId`; reuses exported `mapWire` + `ScopeNode`.
- Create: `app/components/Grid/useSprintBoundary.ts` — headless boundary state: `boundaryIndex`, `dragging`, pointer math, `computeDelta()`.
- Create: `app/components/Grid/Grid__SprintBoundary_Divider.tsx` — the draggable divider (grip + live counter + frontier line).
- Create: `app/components/Grid/Grid__SprintBoundary.tsx` — the skin: column head + continuous body (sprint rows, divider, backlog rows) + tint above the line.
- Create: `app/components/Grid/__tests__/useSprintBoundary.test.ts` — boundary math + delta unit tests.
- Create: `app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx` — render + drag-commit integration test.
- Modify: `app/(user)/value-sprint/page.tsx` — mount `<Grid__SprintBoundary>` above the existing panels (additive block only).
- Modify: `app/globals.css` — append `grid__SprintBoundary_*` styles.
- Modify: `docs/c_tech_debt.md` — add TD-SPRINT-BULK-OP + TD-SPRINT-POC-RETIRE.

---

## Task 1: Data layer — sprint-clamped roots

**Files:**
- Create: `app/components/Grid/sprintBoundaryTreeData.ts`
- Test: `app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the apiSite workItems.query so we assert the body we send.
const queryMock = vi.fn();
vi.mock("@/app/lib/apiSite", () => ({
  workItems: { query: (...a: unknown[]) => queryMock(...a) },
}));

import { fetchSprintRoots } from "../sprintBoundaryTreeData";

const wire = {
  id: "uuid-1",
  key_num: 17,
  type_prefix: "US",
  artefact_type_id: "type-1",
  title: "Story A",
  flow_state_id: "fs-1",
  flow_state_name: "To Do",
  flow_state_code: "todo",
  story_points: 3,
  sprint: null,
  parent: null,
  owner: null,
  due_date: null,
  children_count: 0,
  colour: "#abcdef",
  prio: 1,
};

describe("fetchSprintRoots", () => {
  beforeEach(() => queryMock.mockReset());

  it("sends filters.sprintId for a real sprint id and maps rows", async () => {
    queryMock.mockResolvedValue({ items: [wire], total: 1 });
    const out = await fetchSprintRoots({ limit: 100, offset: 0 }, "sprint-9");
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "sprint-9" },
    });
    expect(out.total).toBe(1);
    expect(out.rows[0].id).toBe("US-17");
    expect(out.rows[0].uuid).toBe("uuid-1");
    expect(out.rows[0].colour).toBe("#abcdef");
  });

  it("sends sprintId='__none__' for the backlog clamp", async () => {
    queryMock.mockResolvedValue({ items: [], total: 0 });
    await fetchSprintRoots({ limit: 100, offset: 0 }, "__none__");
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "__none__" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts`
Expected: FAIL — `fetchSprintRoots` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/components/Grid/sprintBoundaryTreeData.ts
"use client";

// sprintBoundaryTreeData — data layer for the Grid__SprintBoundary POC.
//
// Why a NEW file instead of reusing scopeTreeData.fetchScopeRoots: the shared
// queryFilters() there maps only type/status/priority/owner (its
// ScopeTreeFilters = WorkItemsFilters), and that file is imported by /scope,
// /work-items and /value-sprint-review — editing it to add a sprintId clamp is
// forbidden. This thin layer reuses the EXPORTED mapWire + ScopeNode shape and
// only adds the filters.sprintId clamp the POC needs, through the same audited
// POST gateway (workItems.query).

import { workItems } from "@/app/lib/apiSite";
import type { WorkItemQueryBody } from "@/app/lib/apiSite";
import { mapWire, type ScopeNode, type WireWorkItem } from "@/app/(user)/scope/scopeTreeData";

// sprintId: a sprint UUID, or "__none__" for the backlog (no sprint assigned).
export async function fetchSprintRoots(
  page: { limit: number; offset: number },
  sprintId: string,
): Promise<{ rows: ScopeNode[]; total: number }> {
  const body: WorkItemQueryBody = {
    page: { limit: page.limit, offset: page.offset },
    filters: { sprintId },
  };
  const res = await workItems.query(body);
  const rows = (res.items as WireWorkItem[]).map(mapWire);
  return { rows, total: res.total ?? 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Verify no shared file changed**

Run: `git status --porcelain app/(user)/scope/scopeTreeData.ts`
Expected: empty output (file untouched).

- [ ] **Step 6: Commit**

```bash
git add app/components/Grid/sprintBoundaryTreeData.ts app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts
git commit -m "feat(grid): sprint-clamped roots data layer for boundary POC"
```

---

## Task 2: Headless boundary state + delta math

**Files:**
- Create: `app/components/Grid/useSprintBoundary.ts`
- Test: `app/components/Grid/__tests__/useSprintBoundary.test.ts`

The hook owns the boundary as a count of how many of the COMBINED rows are "in
the sprint." Combined order = [sprint rows…, backlog rows…]. `boundaryIndex` =
number of rows above the divider. Initial = number of sprint rows. Dragging
changes it; `computeDelta()` diffs against the initial split.

- [ ] **Step 1: Write the failing test**

```ts
// app/components/Grid/__tests__/useSprintBoundary.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSprintBoundary } from "../useSprintBoundary";

// Minimal row identities: 3 in sprint, 3 in backlog.
const sprintIds = ["s1", "s2", "s3"];
const backlogIds = ["b1", "b2", "b3"];

describe("useSprintBoundary", () => {
  it("initial boundaryIndex equals sprint row count", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    expect(result.current.boundaryIndex).toBe(3);
    expect(result.current.inSprintCount).toBe(3);
  });

  it("dragging down by 2 moves first 2 backlog rows into the sprint delta", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(5)); // 3 sprint + 2 backlog
    const delta = result.current.computeDelta();
    expect(delta.toSprint).toEqual(["b1", "b2"]);
    expect(delta.toBacklog).toEqual([]);
    expect(result.current.inSprintCount).toBe(5);
  });

  it("dragging up by 1 moves last sprint row into the backlog delta", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(2)); // only first 2 sprint rows stay
    const delta = result.current.computeDelta();
    expect(delta.toSprint).toEqual([]);
    expect(delta.toBacklog).toEqual(["s3"]);
  });

  it("no-op drag yields empty delta", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(3));
    const delta = result.current.computeDelta();
    expect(delta.toSprint).toEqual([]);
    expect(delta.toBacklog).toEqual([]);
  });

  it("clamps boundaryIndex to [0, total]", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(99));
    expect(result.current.boundaryIndex).toBe(6);
    act(() => result.current.setBoundaryIndex(-5));
    expect(result.current.boundaryIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Grid/__tests__/useSprintBoundary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/components/Grid/useSprintBoundary.ts
"use client";

// useSprintBoundary — headless boundary state for the Grid__SprintBoundary POC.
//
// The combined list is [sprint rows…, backlog rows…]. boundaryIndex = how many
// of the combined rows sit ABOVE the divider (i.e. "in the sprint"). Initial =
// sprintIds.length. Dragging mutates boundaryIndex (UI-only); computeDelta()
// diffs the current split against the initial split to get the rows that
// crossed — the membership PATCH set committed on release.
//
// The hook is DOM-free: it takes the two id arrays and the geometry decision
// (which index a pointer-y maps to) is the caller's. This keeps the math unit-
// testable without a rendered tree.

import { useCallback, useMemo, useState } from "react";

export interface SprintBoundaryDelta {
  toSprint: string[]; // backlog rows that ended up above the line
  toBacklog: string[]; // sprint rows that ended up below the line
}

export interface UseSprintBoundaryResult {
  /** Rows above the divider (count). */
  boundaryIndex: number;
  /** Same as boundaryIndex — the "N in sprint" the divider counter shows. */
  inSprintCount: number;
  /** Total combined rows. */
  total: number;
  /** Sprint rows initially (the un-dragged split point). */
  initialSplit: number;
  /** Set the divider position, clamped to [0, total]. */
  setBoundaryIndex: (n: number) => void;
  /** Rows that crossed vs the initial split. */
  computeDelta: () => SprintBoundaryDelta;
  /** Reset the divider back to the initial split (e.g. after commit/refetch). */
  reset: () => void;
}

export function useSprintBoundary(
  sprintIds: string[],
  backlogIds: string[],
): UseSprintBoundaryResult {
  const initialSplit = sprintIds.length;
  const total = sprintIds.length + backlogIds.length;
  const [boundaryIndex, setBoundaryIndexRaw] = useState(initialSplit);

  const combined = useMemo(
    () => [...sprintIds, ...backlogIds],
    [sprintIds, backlogIds],
  );

  const setBoundaryIndex = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(total, n));
      setBoundaryIndexRaw(clamped);
    },
    [total],
  );

  const computeDelta = useCallback((): SprintBoundaryDelta => {
    const toSprint: string[] = [];
    const toBacklog: string[] = [];
    if (boundaryIndex > initialSplit) {
      // line moved DOWN — backlog rows [initialSplit, boundaryIndex) joined sprint
      for (let i = initialSplit; i < boundaryIndex; i++) toSprint.push(combined[i]);
    } else if (boundaryIndex < initialSplit) {
      // line moved UP — sprint rows [boundaryIndex, initialSplit) left sprint
      for (let i = boundaryIndex; i < initialSplit; i++) toBacklog.push(combined[i]);
    }
    return { toSprint, toBacklog };
  }, [boundaryIndex, initialSplit, combined]);

  const reset = useCallback(
    () => setBoundaryIndexRaw(initialSplit),
    [initialSplit],
  );

  return {
    boundaryIndex,
    inSprintCount: boundaryIndex,
    total,
    initialSplit,
    setBoundaryIndex,
    computeDelta,
    reset,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/Grid/__tests__/useSprintBoundary.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add app/components/Grid/useSprintBoundary.ts app/components/Grid/__tests__/useSprintBoundary.test.ts
git commit -m "feat(grid): headless sprint-boundary state + delta math"
```

---

## Task 3: The divider component

**Files:**
- Create: `app/components/Grid/Grid__SprintBoundary_Divider.tsx`
- Modify: `app/globals.css` (append divider styles)

The divider is presentation + a pointer-drag emitter. It does NOT know about
rows; the parent skin maps pointer-y → boundary index and passes back the live
count to render.

- [ ] **Step 1: Write the component**

```tsx
// app/components/Grid/Grid__SprintBoundary_Divider.tsx
"use client";

// Grid__SprintBoundary_Divider — the draggable sprint-commitment line.
//
// Subtle at rest (a thin rule + grip on hover), blooms while dragging (the
// glowing frontier + live counter). Pointer-only; it reports pointer-move
// deltas in px to the parent, which converts them to a boundary row index. The
// parent owns the count it shows back here (inSprintCount / total).

import { useCallback, useRef } from "react";

export interface GridSprintBoundaryDividerProps {
  inSprintCount: number;
  total: number;
  dragging: boolean;
  /** Pointer went down on the grip — parent begins a drag session. */
  onDragStart: (clientY: number) => void;
  /** Pointer moved during a drag — absolute clientY. */
  onDragMove: (clientY: number) => void;
  /** Pointer released — parent commits the delta. */
  onDragEnd: () => void;
}

export function GridSprintBoundaryDivider({
  inSprintCount,
  total,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
}: GridSprintBoundaryDividerProps) {
  const activeRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      activeRef.current = true;
      onDragStart(e.clientY);
    },
    [onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activeRef.current) return;
      onDragMove(e.clientY);
    },
    [onDragMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      onDragEnd();
    },
    [onDragEnd],
  );

  return (
    <div
      className={`grid__SprintBoundary_Divider${dragging ? " grid__SprintBoundary_Divider-dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Sprint commitment line — ${inSprintCount} of ${total} in sprint. Drag to adjust.`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <span className="grid__SprintBoundary_Divider_Grip" aria-hidden>
        ⇕
      </span>
      <span className="grid__SprintBoundary_Divider_Count">
        {inSprintCount} of {total} in sprint
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Append CSS to `app/globals.css`**

Append at the end of the file:

```css
/* ── Grid__SprintBoundary — POC sprint-commitment divider ─────────────────── */
.grid__SprintBoundary_Divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 28px;
  cursor: row-resize;
  user-select: none;
  border-top: 1px dashed var(--border-subtle, #d0d3d8);
  color: var(--text-subtle, #6b7280);
  font-size: 12px;
  transition: background 120ms ease, box-shadow 160ms ease, color 120ms ease;
}
.grid__SprintBoundary_Divider:hover {
  background: var(--surface-raised, #f3f5f8);
  color: var(--text-default, #1f2937);
}
.grid__SprintBoundary_Divider-dragging {
  background: linear-gradient(var(--accent-500, #0bb45a), var(--accent-600, #099349));
  color: #fff;
  box-shadow: 0 4px 14px rgba(11, 180, 90, 0.45);
  border-top-color: transparent;
}
.grid__SprintBoundary_Divider_Grip { font-size: 14px; line-height: 1; }
.grid__SprintBoundary_Divider_Count { font-variant-numeric: tabular-nums; }

/* Tint applied by the skin to rows currently above the line. */
.grid__SprintBoundary_Row-inSprint {
  background: var(--accent-50, #e6f5ee);
  box-shadow: inset 3px 0 0 var(--accent-500, #0bb45a);
}
```

- [ ] **Step 3: Verify build compiles (typecheck)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "Grid__SprintBoundary_Divider" || echo "no type errors in divider"`
Expected: `no type errors in divider`

- [ ] **Step 4: Commit**

```bash
git add app/components/Grid/Grid__SprintBoundary_Divider.tsx app/globals.css
git commit -m "feat(grid): sprint-boundary divider component + styles"
```

---

## Task 4: The skin — continuous list + divider + drag→index mapping

**Files:**
- Create: `app/components/Grid/Grid__SprintBoundary.tsx`
- Test: `app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx`

This composes everything: it takes the two `useTree` results + columns + a
`commit(delta)` callback, renders head + sprint rows + divider + backlog rows,
maps pointer-y during a drag to a `boundaryIndex` (via each row's measured
height), tints rows above the line, and calls `commit` on release.

- [ ] **Step 1: Write the failing integration test**

```tsx
// app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridSprintBoundary } from "../Grid__SprintBoundary";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";
import type { GridColumn, UseTreeResult, TreeNode } from "../types";

// Build a flat TreeNode<ScopeNode> for a given id (no children, depth 0).
function node(id: string): TreeNode<ScopeNode> {
  const row: ScopeNode = {
    id, uuid: `${id}-uuid`, type: "US", artefactTypeId: "t", summary: id,
    flowStateId: "fs", flowStateName: "To Do", flowStateCode: "todo",
    points: null, owner: "—", parent: null, parentId: null, parentUuid: null,
    sprint: null, due: null, childrenCount: 0, colour: null, prio: null,
  };
  return {
    row, id, hasChildren: false, expanded: false, hasVisibleChildren: false,
    loading: false, children: [], toggle: () => {}, depth: 0, isLast: true,
    continuations: [],
  };
}

// A minimal UseTreeResult stub exposing only what the skin reads.
function treeStub(ids: string[]): UseTreeResult<ScopeNode> {
  const flat = ids.map(node);
  return {
    nodes: flat, flatNodes: flat, loadingIds: new Set(), reset: () => {},
    expandAll: () => {}, collapseAll: () => {}, allExpanded: false,
    total: ids.length, loadedCount: ids.length, pageSize: 100, hasMore: false,
    currentPage: 0, rootsLoading: false, loadMore: () => {}, jumpToPage: () => {},
    refresh: vi.fn(), refreshPreservingExpansion: vi.fn(), updateRow: () => {},
  };
}

const columns: GridColumn<ScopeNode>[] = [
  { id: "summary", label: "Summary", defaultWidth: null, treePrimary: true,
    renderCell: (r) => r.summary },
];

describe("GridSprintBoundary", () => {
  it("renders sprint rows above the divider and backlog rows below", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2"])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={vi.fn()}
      />,
    );
    expect(screen.getByText("s1")).toBeInTheDocument();
    expect(screen.getByText("b3")).toBeInTheDocument();
    // Divider shows the initial split: 2 of 5 in sprint.
    expect(screen.getByText("2 of 5 in sprint")).toBeInTheDocument();
  });

  it("commits the crossed-row delta on drag release", () => {
    const commit = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2"])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={commit}
        // Inject a deterministic px→index mapper for the test (bypasses DOM
        // measurement): every 40px of downward drag crosses one row.
        rowHeightForTest={40}
      />,
    );
    const divider = screen.getByRole("separator");
    // Drag down 80px → cross 2 backlog rows (b1, b2) into the sprint.
    fireEvent.pointerDown(divider, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(divider, { clientY: 180, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({
      toSprint: ["b1-uuid", "b2-uuid"],
      toBacklog: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the skin implementation**

```tsx
// app/components/Grid/Grid__SprintBoundary.tsx
"use client";

// Grid__SprintBoundary — POC skin: one continuous list (sprint rows, a
// draggable divider, backlog rows) with a movable sprint-commitment line.
// Reuses the headless useTree (passed in twice — sprint clamp + backlog clamp),
// the pure Grid__Tree_Row, the Grid__Tree_Head, and useColumnManager. It does
// NOT modify Grid__Tree — it composes its parts.
//
// Membership is committed on RELEASE: the divider's row index is diffed against
// the initial split and the crossed rows are handed to commit() as a delta of
// artefact UUIDs (toSprint / toBacklog). Dragging is pure UI — no network.

import { useCallback, useMemo, useRef, useState } from "react";
import { useColumnManager } from "./useColumnManager";
import { GridTreeHead } from "./Grid__Tree_Head";
import { GridTreeRow } from "./Grid__Tree_Row";
import { GridSprintBoundaryDivider } from "./Grid__SprintBoundary_Divider";
import {
  useSprintBoundary,
  type SprintBoundaryDelta,
} from "./useSprintBoundary";
import type { GridColumn, SortState, UseTreeResult } from "./types";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";

export interface GridSprintBoundaryProps {
  sprintTree: UseTreeResult<ScopeNode>;
  backlogTree: UseTreeResult<ScopeNode>;
  columns: GridColumn<ScopeNode>[];
  /** Called on release with the rows that crossed the line (artefact UUIDs). */
  commit: (delta: SprintBoundaryDelta) => void;
  defaultSort?: SortState | null;
  /** Test-only: fixed row height so the px→index map is deterministic. */
  rowHeightForTest?: number;
}

export function GridSprintBoundary({
  sprintTree,
  backlogTree,
  columns,
  commit,
  defaultSort = null,
  rowHeightForTest,
}: GridSprintBoundaryProps) {
  const sprintNodes = sprintTree.flatNodes;
  const backlogNodes = backlogTree.flatNodes;

  const sprintIds = useMemo(
    () => sprintNodes.map((n) => n.row.uuid),
    [sprintNodes],
  );
  const backlogIds = useMemo(
    () => backlogNodes.map((n) => n.row.uuid),
    [backlogNodes],
  );

  const boundary = useSprintBoundary(sprintIds, backlogIds);
  const { gridTemplateColumns, primaryColumnIndex, sortState, onHeaderClick } =
    useColumnManager<ScopeNode>({ columns, defaultSort });

  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartIndex = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Map a downward pixel delta to a row-count delta. In tests we inject a fixed
  // row height; in the browser we measure the first rendered data row.
  const rowHeight = useCallback((): number => {
    if (rowHeightForTest) return rowHeightForTest;
    const firstRow = bodyRef.current?.querySelector<HTMLElement>(
      "[data-sprintboundary-row]",
    );
    return firstRow?.getBoundingClientRect().height || 40;
  }, [rowHeightForTest]);

  const onDragStart = useCallback(
    (clientY: number) => {
      setDragging(true);
      dragStartY.current = clientY;
      dragStartIndex.current = boundary.boundaryIndex;
    },
    [boundary.boundaryIndex],
  );

  const onDragMove = useCallback(
    (clientY: number) => {
      const dy = clientY - dragStartY.current;
      const rowsMoved = Math.round(dy / rowHeight());
      boundary.setBoundaryIndex(dragStartIndex.current + rowsMoved);
    },
    [boundary, rowHeight],
  );

  const onDragEnd = useCallback(() => {
    setDragging(false);
    const delta = boundary.computeDelta();
    if (delta.toSprint.length || delta.toBacklog.length) commit(delta);
  }, [boundary, commit]);

  // The combined render order: sprint nodes then backlog nodes. A row is "in
  // sprint" (tinted) when its combined index < boundaryIndex.
  const combined = useMemo(
    () => [...sprintNodes, ...backlogNodes],
    [sprintNodes, backlogNodes],
  );

  return (
    <div className="grid grid__SprintBoundary">
      <GridTreeHead
        columns={columns}
        gridTemplateColumns={gridTemplateColumns}
        sortState={sortState}
        onHeaderClick={onHeaderClick}
      />
      <div className="grid__SprintBoundary_Body" ref={bodyRef}>
        {combined.map((n, i) => {
          const inSprint = i < boundary.boundaryIndex;
          const rowEl = (
            <div
              key={n.id}
              data-sprintboundary-row
              className={
                inSprint ? "grid__SprintBoundary_Row-inSprint" : undefined
              }
            >
              <GridTreeRow
                node={n}
                columns={columns}
                gridTemplateColumns={gridTemplateColumns}
                primaryColumnIndex={primaryColumnIndex}
              />
            </div>
          );
          // Inject the divider right after the last in-sprint row.
          if (i + 1 === boundary.boundaryIndex) {
            return (
              <div key={`${n.id}-wrap`}>
                {rowEl}
                <GridSprintBoundaryDivider
                  inSprintCount={boundary.inSprintCount}
                  total={boundary.total}
                  dragging={dragging}
                  onDragStart={onDragStart}
                  onDragMove={onDragMove}
                  onDragEnd={onDragEnd}
                />
              </div>
            );
          }
          return rowEl;
        })}
        {/* Edge case: divider at the very top (0 rows in sprint). */}
        {boundary.boundaryIndex === 0 && (
          <GridSprintBoundaryDivider
            inSprintCount={0}
            total={boundary.total}
            dragging={dragging}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
          />
        )}
      </div>
    </div>
  );
}
```

> **NOTE on `useColumnManager` call shape:** This task assumes `useColumnManager<TRow>({ columns, defaultSort })` returns `{ gridTemplateColumns, primaryColumnIndex, sortState, onHeaderClick }`. Before writing Step 3, the executor MUST open `app/components/Grid/useColumnManager.ts` (line 85) and `app/components/Grid/Grid__Tree_Head.tsx` (props at line 15) and match the EXACT param + return names + the `GridTreeHead` prop names. If they differ, adapt the call/props in this file ONLY (never edit those shared files). The structural intent is unchanged: get the shared column template + a head.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx`
Expected: PASS (2 cases). If the column-manager/head prop names differed, the render test surfaces it — fix the call in this file and re-run.

- [ ] **Step 5: Verify shared files untouched**

Run: `git status --porcelain app/components/Grid/Grid__Tree.tsx app/components/Grid/Grid__Tree_Row.tsx app/components/Grid/Grid__Tree_Head.tsx app/components/Grid/useColumnManager.ts app/components/Grid/useTree.ts app/components/Grid/types.ts`
Expected: empty output.

- [ ] **Step 6: Commit**

```bash
git add app/components/Grid/Grid__SprintBoundary.tsx app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx
git commit -m "feat(grid): Grid__SprintBoundary skin — continuous list + movable divider"
```

---

## Task 5: Mount the POC on /value-sprint (above the panels)

**Files:**
- Modify: `app/(user)/value-sprint/page.tsx`

Add an additive block ABOVE the existing first `<Panel>`. It builds two
`useTree` instances via `fetchSprintRoots`, columns via `makeScopeColumns`, and a
`commit` callback that reuses the page's existing `assignToSprint`/`refetch`.

- [ ] **Step 1: Add the two useTree instances + commit callback**

In `app/(user)/value-sprint/page.tsx`, add these imports at the top (with the other imports):

```tsx
import { GridSprintBoundary } from "@/app/components/Grid/Grid__SprintBoundary";
import { useTree } from "@/app/components/Grid/useTree";
import { fetchSprintRoots } from "@/app/components/Grid/sprintBoundaryTreeData";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";
import { makeScopeColumns } from "@/app/(user)/scope/scopeColumns";
import { useFlowStatesByType } from "@/app/components/useFlowStatesByType";
import type { SprintBoundaryDelta } from "@/app/components/Grid/useSprintBoundary";
```

Inside the `ValueSprint` component body, AFTER `panelSprintId` is computed (it is
defined around line 198) and AFTER `refetch` is defined (around line 363), add:

```tsx
  // ── POC: sprint boundary-drag (mounted above the legacy panels) ───────────
  // Two useTree instances over the SAME audited POST gateway the Grid pages
  // use, clamped by filters.sprintId. Sprint section = the panel sprint;
  // backlog section = unassigned (__none__). expandable:false — sprint planning
  // is a flat story/defect/risk list (no child expansion in the POC).
  const pocSprintId = panelSprintId ?? "";
  const pocSprintTree = useTree<ScopeNode>({
    fetchRoots: useCallback(
      (page: { limit: number; offset: number }) =>
        fetchSprintRoots(page, pocSprintId),
      [pocSprintId],
    ),
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: () => 0,
    fetchChildren: async () => [],
    autoLoad: !!pocSprintId,
    expandable: false,
  });
  const pocBacklogTree = useTree<ScopeNode>({
    fetchRoots: useCallback(
      (page: { limit: number; offset: number }) =>
        fetchSprintRoots(page, "__none__"),
      [],
    ),
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: () => 0,
    fetchChildren: async () => [],
    autoLoad: true,
    expandable: false,
  });

  // Flow states for the column factory (status pills render read-only here).
  const { flowStatesByType: pocFlowStates } = useFlowStatesByType();
  const pocColumns = useMemo(
    () =>
      makeScopeColumns(
        () => {},        // onOpenForm — no inline form in the POC
        pocFlowStates,
        () => {},        // onPatchColour — no colour edit in the POC
      ),
    [pocFlowStates],
  );

  // Commit-on-drop: PATCH each crossed row's sprint_id (uuid-keyed), in
  // parallel, then refetch both POC trees + the page's existing surfaces.
  // Reuses the membership convention: "" removes from sprint.
  const pocCommit = useCallback(
    async (delta: SprintBoundaryDelta) => {
      const calls: Promise<unknown>[] = [
        ...delta.toSprint.map((uuid) =>
          workItems.patch(uuid, { sprint_id: pocSprintId }),
        ),
        ...delta.toBacklog.map((uuid) =>
          workItems.patch(uuid, { sprint_id: "" }),
        ),
      ];
      const results = await Promise.allSettled(calls);
      const failed = results.filter((r) => r.status === "rejected").length;
      pocSprintTree.refresh();
      pocBacklogTree.refresh();
      await refetch();
      if (failed === 0) notify.success("Sprint membership updated.");
      else notify.error(`${failed} of ${calls.length} updates failed.`);
    },
    [pocSprintId, pocSprintTree, pocBacklogTree, refetch],
  );
```

> **NOTE:** `useCallback`, `useMemo`, `workItems`, `notify` are ALREADY imported on this page (verified: lines 3, 20, 22). `useFlowStatesByType` import shape must be confirmed against `app/components/useFlowStatesByType.tsx` — match its actual export + return key names; adapt the destructure if it differs.

- [ ] **Step 2: Render the POC above the first Panel**

Find the JSX `return (` → `<PageContent className="value-sprint">` → after the
`<PageDescription>…</PageDescription>` block (around line 736) and BEFORE the
first `<Panel name="panel_value_sprint_target" …>`, insert:

```tsx
        {/* ── POC: Jira-style sprint boundary-drag (above the legacy panels) ──
            New build per docs/superpowers/specs/2026-06-07-sprint-boundary-drag-design.md.
            Membership-only, commit-on-drop. The two legacy panels below remain
            fully editable; realtime refetch reconciles drift. */}
        {catalogueReady && panelSprintId && (
          <Panel
            name="panel_value_sprint_boundary_poc"
            className="page-panel-heading value-sprint__boundary-poc"
            title="Sprint planning (boundary-drag POC)"
            description="Drag the divider down to commit backlog rows into the sprint; drag up to release them. Membership saves on release."
          >
            <GridSprintBoundary
              sprintTree={pocSprintTree}
              backlogTree={pocBacklogTree}
              columns={pocColumns}
              commit={pocCommit}
            />
          </Panel>
        )}
```

- [ ] **Step 3: Typecheck the page**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "value-sprint/page" || echo "page typechecks clean"`
Expected: `page typechecks clean`. Fix any prop/return-name mismatches (column manager, flow-states hook) in the page ONLY.

- [ ] **Step 4: Verify the legacy panels are untouched**

Run: `git diff app/(user)/value-sprint/page.tsx | grep -E "^-" | grep -v "^---"`
Expected: NO removed lines that belong to the existing panels — the diff should be **additive only** (the `import` lines and the new block). If any existing panel line was removed, revert and re-insert additively.

- [ ] **Step 5: Commit**

```bash
git add app/(user)/value-sprint/page.tsx
git commit -m "feat(value-sprint): mount sprint boundary-drag POC above legacy panels"
```

---

## Task 6: Tech-debt register + manual verification

**Files:**
- Modify: `docs/c_tech_debt.md`

- [ ] **Step 1: Append the two TD entries**

Add under the appropriate section of `docs/c_tech_debt.md` (match the file's
existing entry format — open it first and mirror the surrounding rows):

```markdown
### TD-SPRINT-BULK-OP — boundary-drag commits via per-row PATCH (S3)
The /value-sprint boundary-drag POC commits membership with N parallel
`workItems.patch(uuid,{sprint_id})` calls because `BulkOps`
(backend/internal/artefactitems/service.go) supports set_priority/set_owner/
archive/set_flow_state/set_status but NOT set_sprint.
**Trigger:** a sweep routinely crosses >10 rows, or per-row PATCH load shows up.
**Pay-down:** add a `set_sprint` op to BulkOps + a `workItems.bulk` caller;
swap the Promise.allSettled loop for one round-trip.

### TD-SPRINT-POC-RETIRE — two sprint-membership editors on /value-sprint (S2)
The boundary-drag POC and the legacy two-panel build both edit `sprint_id` on
/value-sprint while the POC is evaluated. Decision (2026-06-07): never ship both.
**Trigger:** POC accepted.
**Pay-down:** retire the two `<Panel>`s, promote `Grid__SprintBoundary` to the
page body; delete the now-dead radial/bulk sprint-assign machinery.
```

- [ ] **Step 2: Commit**

```bash
git add docs/c_tech_debt.md
git commit -m "docs(td): register sprint boundary-drag POC follow-ups"
```

- [ ] **Step 3: Full test sweep**

Run: `npx vitest run app/components/Grid/`
Expected: ALL pass — the new 3 suites plus the existing `Grid__Tree_Lines` + `useTree` suites (proving shared files still behave).

- [ ] **Step 4: Manual verification in the running app**

Ensure the dev server is up (`<npm>` / `:5101`) and backend is on dev (`:5100`).
1. Open `http://localhost:5101/value-sprint`.
2. Confirm the POC panel renders ABOVE the existing two panels.
3. Confirm the sprint section shows the panel sprint's items, the backlog section shows unassigned items, divider reads "N of M in sprint".
4. Drag the divider DOWN past 2–3 backlog rows → release. Expect: a success toast, those rows now appear in the sprint section after refetch, counter updates, and the legacy backlog panel below loses those rows on its next refetch.
5. Drag UP past a sprint row → release → it returns to the backlog.
6. Confirm the legacy panels still work (add/remove via their buttons) — both editors coexist.

- [ ] **Step 5: Confirm zero shared-file drift (final gate)**

Run: `git diff main --stat -- app/components/Grid/Grid__Tree.tsx app/components/Grid/Grid__Tree_Row.tsx app/components/Grid/Grid__Tree_Head.tsx app/components/Grid/Grid__Tree_Lines.tsx app/components/Grid/useTree.ts app/components/Grid/useColumnManager.ts app/components/Grid/types.ts app/(user)/scope/scopeTreeData.ts`
Expected: empty output — not one shared file changed.

---

## Self-Review notes

- **Spec coverage:** data layer (T1) ✓, boundary math/commit-on-drop (T2) ✓, divider visual incl. tint+counter+frontier default (T3) ✓, continuous-list skin reusing useTree+Row without touching Grid__Tree (T4) ✓, POC-above-panels mount with membership-only uuid-keyed PATCH + realtime refetch (T5) ✓, tech-debt TD-SPRINT-BULK-OP + TD-SPRINT-POC-RETIRE (T6) ✓.
- **Verification seams flagged, not assumed:** T4/T5 explicitly tell the executor to confirm `useColumnManager`/`GridTreeHead`/`useFlowStatesByType` exact prop+return names against the real files and adapt the *caller* only — never the shared file. This is the one place names could drift; it's gated by a typecheck + the integration test.
- **Type consistency:** `SprintBoundaryDelta` ({toSprint, toBacklog} of uuids) is defined in T2 and consumed identically in T4 (commit payload) and T5 (PATCH loop). `ScopeNode.uuid` is the PATCH key throughout. `fetchSprintRoots(page, sprintId)` signature identical in T1/T5.
- **No placeholders:** every code step shows full content; the two "confirm the shared prop names" notes are deliberate verification steps with exact file:line pointers, not TODOs.
