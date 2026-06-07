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

  it("commits toBacklog when dragging the divider up", () => {
    const commit = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2", "s3"])}
        backlogTree={treeStub(["b1", "b2"])}
        columns={columns}
        commit={commit}
        rowHeightForTest={40}
      />,
    );
    const divider = screen.getByRole("separator");
    // Initial split = 3 (s1,s2,s3 in sprint). Drag UP 80px → 2 rows → boundary 1.
    // Rows s2,s3 leave the sprint into the backlog.
    fireEvent.pointerDown(divider, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(divider, { clientY: 120, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({
      toSprint: [],
      toBacklog: ["s2-uuid", "s3-uuid"],
    });
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
    expect(screen.getByText("0 of 2 in sprint")).toBeInTheDocument();
  });

  it("still commits a drag when the sprint started empty", () => {
    const commit = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub([])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={commit}
        rowHeightForTest={40}
      />,
    );
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientY: 180, pointerId: 1 });
    fireEvent.pointerUp(divider, { clientY: 180, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({ toSprint: ["b1-uuid", "b2-uuid"], toBacklog: [] });
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

  // Regression: the drag must collect MANY rows across MANY pointer moves —
  // the real "sweep" gesture, not one move. The bug was setPointerCapture on
  // e.target (a child <span>): pressing the grip captured the span, the browser
  // dropped that capture the moment the divider re-rendered/moved on the first
  // row-cross, and the sweep died at one row. Fix: capture e.currentTarget
  // (the stable separator div). This test drives a realistic many-small-moves
  // drag, re-querying the live divider each move (as pointer capture would
  // route events), and asserts the boundary keeps growing past one row.
  it("collects many rows over many incremental pointer moves (continuous sweep)", () => {
    const commit = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1", "s2"])}
        backlogTree={treeStub(["b1", "b2", "b3", "b4", "b5"])}
        columns={columns}
        commit={commit}
        rowHeightForTest={40}
      />,
    );
    const live = () => screen.getByRole("separator");
    fireEvent.pointerDown(live(), { clientY: 100, pointerId: 1 });
    for (let y = 110; y <= 300; y += 10) {
      fireEvent.pointerMove(live(), { clientY: y, pointerId: 1 });
    }
    // +200px / 40px = 5 rows swept in from the backlog → 2 + 5 = 7 of 7.
    expect(screen.getByText("7 of 7 in sprint")).toBeInTheDocument();
    fireEvent.pointerUp(live(), { clientY: 300, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({
      toSprint: ["b1-uuid", "b2-uuid", "b3-uuid", "b4-uuid", "b5-uuid"],
      toBacklog: [],
    });
  });

  // Regression: pointer capture must land on the stable separator div (which
  // carries the constant "__divider__" key + the pointer handlers), NOT on the
  // child grip/counter span the user happened to press. Capturing a child span
  // loses the capture when that span reconciles as the divider moves.
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
          rowHeightForTest={40}
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
});
