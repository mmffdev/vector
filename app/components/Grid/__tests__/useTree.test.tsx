// useTree tests — the headless tree core extracted from useDataGridTree.
//
// Covers the behaviour that MUST survive the extraction: lazy-fetch on first
// expand, cache-reuse + no-refetch on re-expand, collapse-keeps-cache, the
// nested node model (NO geometry — depth/isLast/continuations are gone), the
// in-flight double-fetch guard, expand-all cascade, and the expandable:false
// flat mode.
//
// useTree takes an INJECTED fetchChildren, so no apiSite mock is needed — we
// drive it with a controllable vi.fn().

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTree } from "../useTree";
import type { UseTreeOptions } from "../types";

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

function opts(
  fetchChildren: (row: Row) => Promise<Row[]>,
  expandable = true,
): UseTreeOptions<Row> {
  return {
    rowIdOf: (row) => row.id,
    getChildrenCount: (row) => row.kids,
    fetchChildren,
    expandable,
  };
}

describe("useTree", () => {
  it("renders roots as a nested node model with no geometry fields", () => {
    const { fn } = makeFetch({});
    const roots = [r("A", 2), r("B")];
    const { result } = renderHook(() => useTree(roots, opts(fn)));

    expect(result.current.nodes).toHaveLength(2);
    const [a, b] = result.current.nodes;
    expect(a.id).toBe("A");
    expect(a.hasChildren).toBe(true); // kids=2
    expect(a.expanded).toBe(false);
    expect(a.children).toEqual([]);
    expect(b.hasChildren).toBe(false); // kids=0 → leaf
    // No depth / isLast / continuations leaked onto the node.
    expect(a).not.toHaveProperty("depth");
    expect(a).not.toHaveProperty("isLast");
    expect(a).not.toHaveProperty("continuations");
  });

  it("lazy-fetches children on first expand and nests them under the parent", async () => {
    const { fn, calls } = makeFetch({ A: [r("A1"), r("A2", 1)] });
    const roots = [r("A", 2)];
    const { result } = renderHook(() => useTree(roots, opts(fn)));

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
    // A2 reports kids=1 → it can expand even before its own fetch.
    expect(result.current.nodes[0].children[1].hasChildren).toBe(true);
  });

  it("collapse keeps the cache; re-expand does NOT refetch", async () => {
    const { fn, calls } = makeFetch({ A: [r("A1")] });
    const { result } = renderHook(() => useTree([r("A", 1)], opts(fn)));

    act(() => result.current.nodes[0].toggle()); // expand
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(1);

    act(() => result.current.nodes[0].toggle()); // collapse
    expect(result.current.nodes[0].expanded).toBe(false);
    expect(result.current.nodes[0].children).toEqual([]); // hidden

    act(() => result.current.nodes[0].toggle()); // re-expand
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(1); // STILL one — served from cache, no refetch
  });

  it("guards against a double-fetch when toggled twice before resolve", async () => {
    let release!: (rows: Row[]) => void;
    const fn = vi.fn(
      () =>
        new Promise<Row[]>((res) => {
          release = res;
        }),
    );
    const { result } = renderHook(() => useTree([r("A", 1)], opts(fn)));

    act(() => result.current.nodes[0].toggle()); // expand → fetch starts
    act(() => result.current.nodes[0].toggle()); // collapse before resolve
    act(() => result.current.nodes[0].toggle()); // expand again, still in flight

    expect(fn).toHaveBeenCalledTimes(1); // inFlightRef guard held
    act(() => release([r("A1")]));
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops the expansion if the fetch rejects (caret returns to closed)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useTree([r("A", 1)], opts(fn)));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].expanded).toBe(false));
    expect(result.current.nodes[0].children).toEqual([]);
  });

  it("expandAll opens every known level via the cascade; allExpanded tracks it", async () => {
    // A → A1 (has 1 kid) → A1a (leaf). Two levels of lazy fetch.
    const { fn } = makeFetch({
      A: [r("A1", 1)],
      A1: [r("A1a")],
    });
    const { result } = renderHook(() => useTree([r("A", 1)], opts(fn)));

    expect(result.current.allExpanded).toBe(false);
    act(() => result.current.expandAll());

    await waitFor(() => {
      const a = result.current.nodes[0];
      expect(a.expanded).toBe(true);
      expect(a.children[0]?.expanded).toBe(true); // A1 auto-expanded too
      expect(a.children[0]?.children[0]?.id).toBe("A1a");
    });
    await waitFor(() => expect(result.current.allExpanded).toBe(true));
  });

  it("collapseAll clears expansion (cache retained)", async () => {
    const { fn, calls } = makeFetch({ A: [r("A1")] });
    const { result } = renderHook(() => useTree([r("A", 1)], opts(fn)));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => result.current.collapseAll());
    expect(result.current.nodes[0].expanded).toBe(false);

    act(() => result.current.nodes[0].toggle()); // re-expand
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(1); // cache survived collapseAll
  });

  it("reset drops all expansion and cache", async () => {
    const { fn, calls } = makeFetch({ A: [r("A1")] });
    const { result } = renderHook(() => useTree([r("A", 1)], opts(fn)));

    act(() => result.current.nodes[0].toggle());
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));

    act(() => result.current.reset());
    expect(result.current.nodes[0].expanded).toBe(false);

    act(() => result.current.nodes[0].toggle()); // re-expand
    await waitFor(() => expect(result.current.nodes[0].children).toHaveLength(1));
    expect(calls.A).toBe(2); // reset cleared cache → a fresh fetch happened
  });

  it("expandable:false → flat leaves, no carets, no fetch", () => {
    const { fn } = makeFetch({ A: [r("A1")] });
    const { result } = renderHook(() => useTree([r("A", 5)], opts(fn, false)));

    const a = result.current.nodes[0];
    expect(a.hasChildren).toBe(false); // suppressed despite kids=5
    act(() => a.toggle()); // no-op
    expect(a.expanded).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.allExpanded).toBe(false);
  });
});
