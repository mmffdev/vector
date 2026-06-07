// app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridSprintBoundary } from "../Grid__SprintBoundary";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";
import type { GridColumn, UseTreeResult, TreeNode } from "../types";

// useColumnManager's fit effect uses ResizeObserver, which jsdom doesn't
// provide. Same inert polyfill the other Grid/ResourceTree tests use.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
  // jsdom's PointerEvent (when present) drops clientX/clientY/pointerId from its
  // init dict, so fireEvent.pointer* deliver null coords — the divider drag maps
  // to nothing. Shim PointerEvent as a MouseEvent subclass: MouseEvent honors
  // clientX/clientY, and we carry pointerId through. Test-only jsdom guard, same
  // category as the setPointerCapture stub below.
  class PE extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  (globalThis as any).PointerEvent = PE;
  (window as any).PointerEvent = PE;
});

beforeEach(() => {
  if (!(HTMLElement.prototype as any).setPointerCapture) {
    (HTMLElement.prototype as any).setPointerCapture = () => {};
    (HTMLElement.prototype as any).releasePointerCapture = () => {};
  }
});

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

// jsdom's getBoundingClientRect returns zeros, so the geometry-based sweep can't
// compute row midpoints. After render, stamp each [data-sweep-row] with a
// deterministic rect (40px tall, stacked in DOM order) so the sweep snapshot and
// midpoint math behave like a real layout. `ys` maps data-sweep-uuid → top.
function stampGeometry(container: HTMLElement, ys: Record<string, number>) {
  const rows = container.querySelectorAll<HTMLElement>("[data-sweep-row]");
  rows.forEach((el) => {
    const uuid = el.getAttribute("data-sweep-uuid")!;
    const top = ys[uuid] ?? 0;
    el.getBoundingClientRect = () =>
      ({
        top,
        height: 40,
        bottom: top + 40,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => {},
      }) as DOMRect;
  });
}

describe("GridSprintBoundary", () => {
  it("renders sprint rows above the handle and backlog rows below", () => {
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2"])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={vi.fn()}
      />,
    );
    expect(screen.getByText("s1")).toBeInTheDocument();
    expect(screen.getByText("b3")).toBeInTheDocument();
    // The handle is a separator sitting between the sprint and backlog rows.
    const handle = screen.getByRole("separator");
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-sweep-row], [role='separator']",
      ),
    );
    const handleIdx = rows.indexOf(handle);
    const sprintIdx = rows.findIndex(
      (el) => el.getAttribute("data-sweep-section") === "sprint",
    );
    const backlogIdx = rows.findIndex(
      (el) => el.getAttribute("data-sweep-section") === "backlog",
    );
    expect(sprintIdx).toBeLessThan(handleIdx);
    expect(handleIdx).toBeLessThan(backlogIdx);
  });

  it("each row carries the three data-sweep attributes", () => {
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1"])}
        columns={columns}
        commit={vi.fn()}
      />,
    );
    const rows = container.querySelectorAll<HTMLElement>("[data-sweep-row]");
    expect(rows).toHaveLength(2);
    rows.forEach((el) => {
      expect(el.getAttribute("data-sweep-uuid")).toBeTruthy();
      expect(["sprint", "backlog"]).toContain(
        el.getAttribute("data-sweep-section"),
      );
    });
  });

  it("sweeping the handle down over backlog rows commits them to the sprint", () => {
    const commit = vi.fn();
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={commit}
      />,
    );
    // s1 at 0, b1 at 40, b2 at 80, b3 at 120 (each 40px tall).
    stampGeometry(container, {
      "s1-uuid": 0,
      "b1-uuid": 40,
      "b2-uuid": 80,
      "b3-uuid": 120,
    });
    const handle = screen.getByRole("separator");
    // Origin y=35 (below s1's midpoint 20, above b1). Sweep down to y=100 covers
    // b1 (mid 60) and b2 (mid 100); b3 (mid 140) is past y → not swept.
    fireEvent.pointerDown(handle, { clientY: 35, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 100, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({
      toSprint: ["b1-uuid", "b2-uuid"],
      toBacklog: [],
    });
  });

  it("sweeping the handle up over sprint rows commits them to the backlog", () => {
    const commit = vi.fn();
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2", "s3"])}
        backlogTree={treeStub(["b1", "b2"])}
        columns={columns}
        commit={commit}
      />,
    );
    // s1 at 0, s2 at 40, s3 at 80, b1 at 120, b2 at 160.
    stampGeometry(container, {
      "s1-uuid": 0,
      "s2-uuid": 40,
      "s3-uuid": 80,
      "b1-uuid": 120,
      "b2-uuid": 160,
    });
    const handle = screen.getByRole("separator");
    // Origin y=110 (below s3's midpoint 100, above b1). Sweep up to y=50 covers
    // s3 (mid 100) and s2 (mid 60); s1 (mid 20) is past y → not swept.
    fireEvent.pointerDown(handle, { clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 50, pointerId: 1 });
    // Swept UUIDs are collected in DOM order (s2 precedes s3), not sweep order.
    expect(commit).toHaveBeenCalledWith({
      toSprint: [],
      toBacklog: ["s2-uuid", "s3-uuid"],
    });
  });

  it("does not commit when the handle is pressed and released without sweeping a row", () => {
    const commit = vi.fn();
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1", "b2"])}
        columns={columns}
        commit={commit}
      />,
    );
    stampGeometry(container, { "s1-uuid": 0, "b1-uuid": 40, "b2-uuid": 80 });
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientY: 35, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 35, pointerId: 1 });
    expect(commit).not.toHaveBeenCalled();
  });

  it("renders the title band with FILTER prefix + sprint label + subtitle", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1"])}
        columns={columns}
        commit={vi.fn()}
        sprintLabel="Sprint 1 — Red"
        subtitle="Work items committed to this sprint."
      />,
    );
    expect(screen.getByText("FILTER")).toBeInTheDocument();
    expect(screen.getByText("Sprint 1 — Red")).toBeInTheDocument();
    expect(screen.getByText("Work items committed to this sprint.")).toBeInTheDocument();
  });

  it("renders the action bar leading + search when provided", () => {
    const onChange = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1"])}
        columns={columns}
        commit={vi.fn()}
        actionBar={{
          leading: <button>Prev</button>,
          search: { placeholder: "Search…", value: "", onChange },
          filterChips: <div data-testid="chips">chips</div>,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Prev" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
    expect(screen.getByTestId("chips")).toBeInTheDocument();
  });

  it("shows the empty-sprint explanatory row when the sprint section is empty", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub([])}
        backlogTree={treeStub(["b1", "b2"])}
        columns={columns}
        commit={vi.fn()}
        sprintLabel="Sprint 1 — Red"
      />,
    );
    expect(screen.getByText(/this sprint is empty/i)).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("still commits a sweep when the sprint started empty", () => {
    const commit = vi.fn();
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub([])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={commit}
      />,
    );
    // No sprint rows — the handle is the first element, backlog below it.
    stampGeometry(container, { "b1-uuid": 0, "b2-uuid": 40, "b3-uuid": 80 });
    const handle = screen.getByRole("separator");
    // Origin y=-5 (above b1). Sweep down to y=60 covers b1 (mid 20) + b2 (mid 60).
    fireEvent.pointerDown(handle, { clientY: -5, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 60, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({
      toSprint: ["b1-uuid", "b2-uuid"],
      toBacklog: [],
    });
  });

  it("filters rows by searchTerm (client-side, case-insensitive)", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["Alpha", "Beta"])}
        backlogTree={treeStub(["Gamma"])}
        columns={columns}
        commit={vi.fn()}
        searchTerm="alph"
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
  });

  it("ignores empty/whitespace searchTerm (shows all rows)", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["Alpha"])}
        backlogTree={treeStub(["Gamma"])}
        columns={columns}
        commit={vi.fn()}
        searchTerm="   "
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  // Regression: the sweep must collect MANY rows across MANY pointer moves — the
  // real gesture, not one move. The boundary keeps growing past one row as the
  // pointer descends; on release every backlog row whose midpoint was crossed is
  // committed. The live counter span updates imperatively each move.
  it("collects many rows over many incremental pointer moves (continuous sweep)", () => {
    const commit = vi.fn();
    const { container } = render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2"])}
        backlogTree={treeStub(["b1", "b2", "b3", "b4", "b5"])}
        columns={columns}
        commit={commit}
      />,
    );
    // s1@0 s2@40 | handle | b1@80 b2@120 b3@160 b4@200 b5@240 (mids +20).
    stampGeometry(container, {
      "s1-uuid": 0,
      "s2-uuid": 40,
      "b1-uuid": 80,
      "b2-uuid": 120,
      "b3-uuid": 160,
      "b4-uuid": 200,
      "b5-uuid": 240,
    });
    const handle = screen.getByRole("separator");
    // Origin y=75 (above b1's mid 100). Descend in 10px steps to y=270 — past
    // b5's midpoint 260 — sweeping all five backlog rows.
    fireEvent.pointerDown(handle, { clientY: 75, pointerId: 1 });
    for (let y = 85; y <= 270; y += 10) {
      fireEvent.pointerMove(handle, { clientY: y, pointerId: 1 });
    }
    // Counter span (written imperatively by useSweepSelect) shows all five.
    const counter = container.querySelector<HTMLElement>(
      ".grid__SprintBoundary_Divider_Count",
    )!;
    expect(counter.textContent).toBe("5 to add");
    fireEvent.pointerUp(handle, { clientY: 270, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({
      toSprint: ["b1-uuid", "b2-uuid", "b3-uuid", "b4-uuid", "b5-uuid"],
      toBacklog: [],
    });
  });

  // Regression: pointer capture must land on the separator div (the element the
  // pointer handlers are bound to), NOT the child grip/counter span the user
  // happened to press. The handlers use e.currentTarget, which is the separator
  // regardless of which descendant received the raw event.
  it("captures the pointer on the separator div, not the pressed child span", () => {
    let capturedOn: HTMLElement | null = null;
    const proto = HTMLElement.prototype as unknown as {
      setPointerCapture: (id: number) => void;
    };
    const origSet = proto.setPointerCapture;
    proto.setPointerCapture = function (this: HTMLElement) {
      capturedOn = this;
    };
    try {
      const { container } = render(
        <GridSprintBoundary
          sprintTree={treeStub(["s1", "s2"])}
          backlogTree={treeStub(["b1", "b2", "b3"])}
          columns={columns}
          commit={vi.fn()}
        />,
      );
      const grip = container.querySelector(
        ".grid__SprintBoundary_Divider_Grip",
      ) as HTMLElement;
      fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
      expect(capturedOn).toBe(screen.getByRole("separator"));
    } finally {
      proto.setPointerCapture = origSet;
    }
  });

  // Regression: during the commit→refetch window a row can transiently appear
  // in BOTH the sprint clamp and the __none__ backlog clamp (the sprint tree
  // already has the moved row while the backlog tree's stale page still does).
  // The combined render keyed rows by id, so the duplicate crashed React with
  // "two children with the same key". The skin must tolerate it: dedupe the
  // combined list (keep the first/sprint-side occurrence) so the row renders
  // once and no key collides.
  it("does not crash or duplicate when a row appears in both trees (refetch race)", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(
      <GridSprintBoundary
        // US-18169-like collision: same uuid present in sprint AND backlog.
        sprintTree={treeStub(["dup", "s2"])}
        backlogTree={treeStub(["dup", "b1"])}
        columns={columns}
        commit={vi.fn()}
      />,
    );
    // The duplicated row renders exactly once (deduped), no second "dup".
    const dupCells = screen.getAllByText("dup");
    expect(dupCells).toHaveLength(1);
    // No React "same key" warning was emitted.
    const sameKeyWarning = consoleError.mock.calls.some((args) =>
      String(args[0] ?? "").includes("same key"),
    );
    expect(sameKeyWarning).toBe(false);
    consoleError.mockRestore();
  });
});
