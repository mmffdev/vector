import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

import { GridTree } from "@/app/components/Grid/Grid__Tree";
import type { GridColumn, TreeNode, UseTreeResult } from "@/app/components/Grid/types";

// GridTree's sticky-offset layout effect uses ResizeObserver, which jsdom
// doesn't provide. Same inert polyfill the other Grid/ResourceTree tests use.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
});

// B11.6 — the Prio rank rendering MOVED out of scopeColumns into the
// Grid__Tree lead track during the Grid refactor (see the comment at
// app/(user)/scope/scopeColumns.tsx:121 — "Prio … is also a lead track now —
// see Grid__Tree rowPrio — so it sits right after the drag handle, not here").
// The old test asserted cols[0].id === "prio" in makeScopeColumns, which no
// longer exists there, so it failed. These tests pin Prio where it ACTUALLY
// renders now: GridTree's `rowPrio` prop → the `.grid__Tree_PrioLead` body cell.

interface Row {
  uuid: string;
  summary: string;
  prio: number | null;
}

function makeNode(row: Row): TreeNode<Row> {
  return {
    row,
    id: row.uuid,
    hasChildren: false,
    expanded: false,
    hasVisibleChildren: false,
    loading: false,
    children: [],
    toggle: () => {},
    depth: 0,
    isLast: true,
    continuations: [],
  };
}

// Minimal UseTreeResult stub — GridTree reads flatNodes/nodes to render rows;
// the pagination + mutation surface is stubbed to no-ops/zeros since this test
// only exercises the lead-track render, not tree behaviour.
function makeTree(nodes: TreeNode<Row>[]): UseTreeResult<Row> {
  return {
    nodes,
    flatNodes: nodes,
    loadingIds: new Set<string>(),
    reset: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    allExpanded: false,
    total: nodes.length,
    loadedCount: nodes.length,
    pageSize: 50,
    hasMore: false,
    currentPage: 0,
    rootsLoading: false,
    loadMore: () => {},
    jumpToPage: () => {},
    refresh: () => {},
    refreshPreservingExpansion: () => {},
    updateRow: () => {},
  };
}

const columns: GridColumn<Row>[] = [
  {
    id: "summary",
    label: "Summary",
    defaultWidth: null,
    treePrimary: true,
    renderCell: (r) => <span>{r.summary}</span>,
  },
];

function renderGrid(row: Row) {
  return render(
    <GridTree<Row>
      title="Scope"
      tree={makeTree([makeNode(row)])}
      columns={columns}
      rowPrio={(r) => r.prio}
    />,
  );
}

describe("scope Prio lead track (Grid__Tree rowPrio)", () => {
  it("renders the numeric prio in .grid__Tree_PrioLead when rowPrio returns a value", () => {
    const { container } = renderGrid({ uuid: "u-1", summary: "Test Epic", prio: 7 });
    // The BODY prio cell (not the --head one, which renders the literal "Prio").
    const bodyCell = container.querySelector(
      ".grid__Tree_PrioLead:not(.grid__Tree_PrioLead--head)",
    );
    expect(bodyCell).toBeTruthy();
    expect(bodyCell?.textContent).toBe("7");
  });

  it("renders an empty prio lead cell when rowPrio returns null", () => {
    const { container } = renderGrid({ uuid: "u-2", summary: "Unranked", prio: null });
    const bodyCell = container.querySelector(
      ".grid__Tree_PrioLead:not(.grid__Tree_PrioLead--head)",
    );
    expect(bodyCell).toBeTruthy();
    expect(bodyCell?.textContent).toBe("");
  });

  it("renders the Prio column header", () => {
    const { container } = renderGrid({ uuid: "u-3", summary: "Any", prio: 1 });
    const headCell = container.querySelector(".grid__Tree_PrioLead--head");
    expect(headCell).toBeTruthy();
    expect(headCell?.textContent).toBe("Prio");
  });
});
