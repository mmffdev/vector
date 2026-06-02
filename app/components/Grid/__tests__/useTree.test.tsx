// useTree tests — the headless tree core extracted from useDataGridTree, now
// also owning the paged ROOT window.
//
// Covers the behaviour that MUST survive: lazy-fetch on first expand, cache-
// reuse + no-refetch on re-expand, collapse-keeps-cache, the nested node model
// (NO geometry — depth/isLast/continuations are gone), the in-flight double-
// fetch guard, expand-all cascade, expandable:false flat mode — PLUS root
// pagination: page-0 self-load, loadMore append (expansion preserved),
// jumpToPage replace (expansion reset), hasMore/total/currentPage derivation,
// and refresh.
//
// useTree takes INJECTED fetchRoots + fetchChildren, so no apiSite mock is
// needed — we drive both with controllable vi.fn()s.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTree } from "../useTree";
import type { RootPage, UseTreeOptions } from "../types";

interface Row {
  id: string;
  kids: number;
}

const r = (id: string, kids = 0): Row => ({ id, kids });

// A fetch backed by a fixture map: parentId → its children. Counts calls per
// parent so we can assert "fetched once, cached after".
function makeFetch(map: Record<string, Row[]>) {
  const calls: Record<string, number> = {};
  const fn = vi.fn(async (row: Row) => {
    calls[row.id] = (calls[row.id] ?? 0) + 1;
    return map[row.id] ?? [];
  });
  return { fn, calls };
}

// A root loader over a fixed full root list — slices by {limit, offset} and
// reports the full length as total. Counts calls so we can assert paging.
function makeRoots(all: Row[]) {
  const calls: { limit: number; offset: number }[] = [];
  const fn = vi.fn(
    async (page: { limit: number; offset: number }): Promise<RootPage<Row>> => {
      calls.push(page);
      return {
        rows: all.slice(page.offset, page.offset + page.limit),
        total: all.length,
      };
    },
  );
  return { fn, calls };
}

function opts(
  fetchRoots: UseTreeOptions<Row>["fetchRoots"],
  fetchChildren: (row: Row) => Promise<Row[]>,
  extra: Partial<UseTreeOptions<Row>> = {},
): UseTreeOptions<Row> {
  return {
    fetchRoots,
    rowIdOf: (row) => row.id,
    getChildrenCount: (row) => row.kids,
    fetchChildren,
    expandable: true,
    ...extra,
  };
}

// Render + wait for the mount root-load to settle (page 0). Returns the hook.
async function renderTree(o: UseTreeOptions<Row>) {
  const view = renderHook(() => useTree(o));
  await waitFor(() => expect(view.result.current.rootsLoading).toBe(false));
  return view;
}

describe("useTree", () => {
  it("self-loads root page 0 on mount and exposes the window state", async () => {
    const { fn: roots, calls } = makeRoots([r("A", 2), r("B")]);
    const { fn: kids } = makeFetch({});
    const { result } = await renderTree(opts(roots, kids));

    expect(calls[0]).toEqual({ limit: 100, offset: 0 });
    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.loadedCount).toBe(2);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.currentPage).toBe(0);
  });

  it("renders roots with tree geometry (depth/isLast/continuations)", async () => {
    const { fn: roots } = makeRoots([r("A", 2), r("B")]);
    const { fn: kids } = makeFetch({});
    const { result } = await renderTree(opts(roots, kids));

    const [a, b] = result.current.nodes;
    expect(a.id).toBe("A");
    expect(a.hasChildren).toBe(true); // kids=2
    expect(a.expanded).toBe(false);
    expect(a.children).toEqual([]);
    expect(b.hasChildren).toBe(false); // kids=0 → leaf
    // Roots: depth 0, no ancestor continuations; B is the last root.
    expect(a.depth).toBe(0);
    expect(a.isLast).toBe(false);
    expect(a.continuations).toEqual([]);
    expect(b.depth).toBe(0);
    expect(b.isLast).toBe(true);
  });

  it("threads depth/isLast/continuations through lazy-loaded children", async () => {
    // A (not last, has 2 kids) + Z (last root). Expand A → A1 (not last) +
    // A2 (last). A2 must carry continuations=[true] (A continues below) + isLast.
    const { fn: roots } = makeRoots([r("A", 2), r("Z")]);
    const { fn: kids } = makeFetch({ A: [r("A1"), r("A2")] });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(2));

    const [a1, a2] = result.current.nodes[0].children;
    expect(a1.depth).toBe(1);
    expect(a1.isLast).toBe(false);
    expect(a1.continuations).toEqual([true]); // parent A is not the last root
    expect(a2.depth).toBe(1);
    expect(a2.isLast).toBe(true); // last child → elbow
    expect(a2.continuations).toEqual([true]);

    // flatNodes is the visible list in render order: A, A1, A2, Z.
    expect(result.current.flatNodes.map((n) => n.id)).toEqual([
      "A",
      "A1",
      "A2",
      "Z",
    ]);
  });

  it("lazy-fetches children on first expand and nests them under the parent", async () => {
    const { fn: roots } = makeRoots([r("A", 2)]);
    const { fn: kids, calls } = makeFetch({ A: [r("A1"), r("A2", 1)] });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());

    await waitFor(() => {
      expect(result.current.nodes[0].children).toHaveLength(2);
    });
    expect(calls.A).toBe(1);
    expect(result.current.nodes[0].expanded).toBe(true);
    expect(result.current.nodes[0].hasVisibleChildren).toBe(true);
    expect(result.current.nodes[0].children.map((c) => c.id)).toEqual([
      "A1",
      "A2",
    ]);
    expect(result.current.nodes[0].children[1].hasChildren).toBe(true);
  });

  it("collapse keeps the cache; re-expand does NOT refetch", async () => {
    const { fn: roots } = makeRoots([r("A", 1)]);
    const { fn: kids, calls } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle()); // expand
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(1);

    act(() => result.current.nodes[0].toggle()); // collapse
    expect(result.current.nodes[0].expanded).toBe(false);
    expect(result.current.nodes[0].children).toEqual([]);

    act(() => result.current.nodes[0].toggle()); // re-expand
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(1); // served from cache
  });

  it("guards against a double-fetch when toggled twice before resolve", async () => {
    const { fn: roots } = makeRoots([r("A", 1)]);
    let release!: (rows: Row[]) => void;
    const kids = vi.fn(
      () =>
        new Promise<Row[]>((res) => {
          release = res;
        }),
    );
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle()); // expand → fetch starts
    act(() => result.current.nodes[0].toggle()); // collapse before resolve
    act(() => result.current.nodes[0].toggle()); // expand again, still in flight

    expect(kids).toHaveBeenCalledTimes(1);
    act(() => release([r("A1")]));
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(kids).toHaveBeenCalledTimes(1);
  });

  it("drops the expansion if the fetch rejects (caret returns to closed)", async () => {
    const { fn: roots } = makeRoots([r("A", 1)]);
    const kids = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].expanded).toBe(false));
    expect(result.current.nodes[0].children).toEqual([]);
  });

  it("expandAll opens every known level via the cascade; allExpanded tracks it", async () => {
    const { fn: roots } = makeRoots([r("A", 1)]);
    const { fn: kids } = makeFetch({
      A: [r("A1", 1)],
      A1: [r("A1a")],
    });
    const { result } = await renderTree(opts(roots, kids));

    expect(result.current.allExpanded).toBe(false);
    act(() => result.current.expandAll());

    await waitFor(() => {
      const a = result.current.nodes[0];
      expect(a.expanded).toBe(true);
      expect(a.children[0]?.expanded).toBe(true);
      expect(a.children[0]?.children[0]?.id).toBe("A1a");
    });
    await waitFor(() => expect(result.current.allExpanded).toBe(true));
  });

  it("collapseAll clears expansion (cache retained)", async () => {
    const { fn: roots } = makeRoots([r("A", 1)]);
    const { fn: kids, calls } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => result.current.collapseAll());
    expect(result.current.nodes[0].expanded).toBe(false);

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(1);
  });

  it("updates a visible root or cached child without resetting expansion", async () => {
    const { fn: roots } = makeRoots([r("A", 1), r("B")]);
    const { fn: kids } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => {
      result.current.updateRow("A", (row) => ({ ...row, kids: 2 }));
      result.current.updateRow("A1", (row) => ({ ...row, id: "A1", kids: 3 }));
    });

    expect(result.current.nodes[0].row.kids).toBe(2);
    expect(result.current.nodes[0].expanded).toBe(true);
    expect(result.current.nodes[0].children[0].row.kids).toBe(3);
  });

  it("reset drops all expansion and cache", async () => {
    const { fn: roots } = makeRoots([r("A", 1)]);
    const { fn: kids, calls } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => result.current.reset());
    expect(result.current.nodes[0].expanded).toBe(false);

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(2); // cache cleared → fresh fetch
  });

  it("expandable:false → flat leaves, no carets, no fetch", async () => {
    const { fn: roots } = makeRoots([r("A", 5)]);
    const { fn: kids } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(
      opts(roots, kids, { expandable: false }),
    );

    const a = result.current.nodes[0];
    expect(a.hasChildren).toBe(false); // suppressed despite kids=5
    act(() => a.toggle()); // no-op
    expect(a.expanded).toBe(false);
    expect(kids).not.toHaveBeenCalled();
    expect(result.current.allExpanded).toBe(false);
  });

  // ── Root pagination ─────────────────────────────────────────────────────────

  it("loadMore APPENDS the next page and preserves expansion", async () => {
    // 5 roots, pageSize 2 → page0 = [A,B], page1 = [C,D], page2 = [E].
    const all = [r("A", 1), r("B"), r("C"), r("D"), r("E")];
    const { fn: roots, calls } = makeRoots(all);
    const { fn: kids } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids, { pageSize: 2 }));

    expect(result.current.loadedCount).toBe(2);
    expect(result.current.total).toBe(5);
    expect(result.current.hasMore).toBe(true);

    // Expand A before loading more — its expansion must survive the append.
    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadedCount).toBe(4));

    expect(calls[1]).toEqual({ limit: 2, offset: 2 }); // fetched from loadedCount
    expect(result.current.nodes.map((n) => n.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.current.nodes[0].expanded).toBe(true); // preserved
    expect(result.current.nodes[0].children).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadedCount).toBe(5));
    expect(result.current.hasMore).toBe(false); // window == total
  });

  it("jumpToPage REPLACES the window and resets expansion", async () => {
    const all = [r("A", 1), r("B"), r("C"), r("D"), r("E")];
    const { fn: roots, calls } = makeRoots(all);
    const { fn: kids } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids, { pageSize: 2 }));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => result.current.jumpToPage(2)); // → offset 4, page = [E]
    await waitFor(() => expect(result.current.currentPage).toBe(2));

    expect(calls.at(-1)).toEqual({ limit: 2, offset: 4 });
    expect(result.current.nodes.map((n) => n.id)).toEqual(["E"]); // replaced
    expect(result.current.loadedCount).toBe(1);
    expect(result.current.hasMore).toBe(false);
    // A is gone → its expansion reset (no expanded node remains).
    expect(result.current.nodes.every((n) => !n.expanded)).toBe(true);
  });

  it("refresh reloads from offset 0 with a clean reset", async () => {
    const all = [r("A", 1), r("B"), r("C")];
    const { fn: roots, calls } = makeRoots(all);
    const { fn: kids, calls: kidCalls } = makeFetch({ A: [r("A1")] });
    const { result } = await renderTree(opts(roots, kids, { pageSize: 2 }));

    act(() => result.current.jumpToPage(1)); // move off page 0
    await waitFor(() => expect(result.current.currentPage).toBe(1));
    act(() => result.current.nodes[0].toggle()); // expand C
    await waitFor(() => expect(result.current.rootsLoading).toBe(false));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.currentPage).toBe(0));

    expect(calls.at(-1)).toEqual({ limit: 2, offset: 0 });
    expect(result.current.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(result.current.nodes.every((n) => !n.expanded)).toBe(true);
    // Re-expanding A after refresh refetches (cache was cleared by reset).
    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(kidCalls.A).toBe(1);
  });

  it("refreshPreservingExpansion reloads visible data without collapsing expanded rows", async () => {
    const all = [r("A", 1), r("B", 1)];
    const childMap = {
      A: [r("A1")],
      B: [r("B1")],
    };
    const { fn: roots, calls } = makeRoots(all);
    const { fn: kids, calls: kidCalls } = makeFetch(childMap);
    const { result } = await renderTree(opts(roots, kids));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    act(() => result.current.nodes[1].toggle());
    await waitFor(() => expect(result.current.nodes[1].children).toHaveLength(1));

    childMap.A = [];
    childMap.B = [r("B1"), r("A1")];

    act(() => result.current.refreshPreservingExpansion());
    await waitFor(() => expect(result.current.nodes[1].children).toHaveLength(2));

    expect(calls.at(-1)).toEqual({ limit: 100, offset: 0 });
    expect(result.current.nodes[0].expanded).toBe(true);
    expect(result.current.nodes[1].expanded).toBe(true);
    expect(result.current.nodes[0].children.map((n) => n.id)).toEqual([]);
    expect(result.current.nodes[1].children.map((n) => n.id)).toEqual(["B1", "A1"]);
    expect(kidCalls.A).toBe(2);
    expect(kidCalls.B).toBe(2);
  });
});
