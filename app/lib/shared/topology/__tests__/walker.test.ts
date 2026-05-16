import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  byLabel,
  byPosition,
  walkTopology,
  type FlattenedRow,
  type TopologyNode,
} from "../walker";

type N = TopologyNode & { position: number; name: string };

const node = (id: string, parent_id: string | null, position = 0, name = id): N => ({
  id,
  parent_id,
  position,
  name,
});

const FIXTURES_DIR = join(
  process.cwd(),
  "dev",
  "fixtures",
  "shared",
  "topology",
);

const loadFixture = (slug: string): { input: unknown; expected: unknown } => {
  const raw = readFileSync(join(FIXTURES_DIR, `${slug}.json`), "utf8");
  return JSON.parse(raw);
};

// Project a walker row down to the JSON shape stored in the golden
// fixtures. Keep this in lockstep with the Go mirror's projection.
const projectRow = <T extends TopologyNode>(r: FlattenedRow<T>) => ({
  id: r.node.id,
  depth: r.depth,
  hasChildren: r.hasChildren,
  collapsed: r.collapsed,
  isFirst: r.isFirst,
  isLast: r.isLast,
  hasVisibleChildren: r.hasVisibleChildren,
  ancestorMoreChildren: r.ancestorMoreChildren,
});

describe("walkTopology", () => {
  it("flat-list — emits each root as its own row at depth 0", () => {
    const nodes: N[] = [node("a", null, 0), node("b", null, 1), node("c", null, 2)];
    const r = walkTopology(nodes, { collapsed: new Set(), sort: byPosition });
    expect(r.rows.map((x) => x.node.id)).toEqual(["a", "b", "c"]);
    expect(r.rows.every((x) => x.depth === 0)).toBe(true);
    expect(r.visibleEdges).toEqual([]);
    expect(r.rows[0].isFirst).toBe(true);
    expect(r.rows[2].isLast).toBe(true);
  });

  it("single-root-deep — descends through a single chain", () => {
    const nodes: N[] = [
      node("a", null, 0),
      node("b", "a", 0),
      node("c", "b", 0),
      node("d", "c", 0),
    ];
    const r = walkTopology(nodes, { collapsed: new Set(), sort: byPosition });
    expect(r.rows.map((x) => x.depth)).toEqual([0, 1, 2, 3]);
    expect(r.visibleEdges).toEqual([
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ]);
  });

  it("multi-root-forest — emits every root and its subtree in order", () => {
    const nodes: N[] = [
      node("r1", null, 0),
      node("r1-a", "r1", 0),
      node("r2", null, 1),
      node("r2-a", "r2", 0),
    ];
    const r = walkTopology(nodes, { collapsed: new Set(), sort: byPosition });
    expect(r.rows.map((x) => x.node.id)).toEqual(["r1", "r1-a", "r2", "r2-a"]);
  });

  it("orphan-drop — a node whose parent is missing is excluded entirely", () => {
    const nodes: N[] = [
      node("a", null, 0),
      node("b", "ghost", 0),
      node("c", "a", 0),
    ];
    const r = walkTopology(nodes, { collapsed: new Set(), sort: byPosition });
    expect(r.rows.map((x) => x.node.id)).toEqual(["a", "c"]);
    expect(r.visibleIds.has("b")).toBe(false);
  });

  it("cycle-guard — recursion stops at maxDepth without throwing", () => {
    // Long chain a→b→c→…→m (13 nodes). Default maxDepth = 12 means
    // depth-12 node is emitted; deeper descent halts (synthetic cycles
    // would otherwise loop forever).
    const ids = "abcdefghijklm".split("");
    const nodes: N[] = ids.map((id, i) =>
      node(id, i === 0 ? null : ids[i - 1], 0),
    );
    const r = walkTopology(nodes, {
      collapsed: new Set(),
      sort: byPosition,
      maxDepth: 5,
    });
    expect(r.rows.map((x) => x.depth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.rows.at(-1)?.node.id).toBe("f");
  });

  it("collapse-hides-subtree — collapsed node emits but its children do not", () => {
    const nodes: N[] = [
      node("a", null, 0),
      node("b", "a", 0),
      node("c", "b", 0),
      node("d", "a", 1),
    ];
    const r = walkTopology(nodes, {
      collapsed: new Set(["b"]),
      sort: byPosition,
    });
    expect(r.rows.map((x) => x.node.id)).toEqual(["a", "b", "d"]);
    const bRow = r.rows.find((x) => x.node.id === "b")!;
    expect(bRow.collapsed).toBe(true);
    expect(bRow.hasChildren).toBe(true);
    expect(bRow.hasVisibleChildren).toBe(false);
    expect(r.visibleEdges).toEqual([
      { source: "a", target: "b" },
      { source: "a", target: "d" },
    ]);
  });

  it("sort-by-label — comparator orders siblings alphabetically", () => {
    const nodes: N[] = [
      node("r", null, 0, "r"),
      node("z", "r", 0, "Zulu"),
      node("a", "r", 0, "Alpha"),
      node("m", "r", 0, "Mike"),
    ];
    const r = walkTopology(nodes, {
      collapsed: new Set(),
      sort: byLabel as (a: N, b: N) => number,
    });
    expect(r.rows.map((x) => x.node.id)).toEqual(["r", "a", "m", "z"]);
  });

  it("sort-by-position — comparator orders siblings by numeric position", () => {
    const nodes: N[] = [
      node("r", null, 0),
      node("c", "r", 200),
      node("a", "r", 100),
      node("b", "r", 150),
    ];
    const r = walkTopology(nodes, { collapsed: new Set(), sort: byPosition });
    expect(r.rows.map((x) => x.node.id)).toEqual(["r", "a", "b", "c"]);
  });

  it("edges-only-visible — collapsed subtree edges are not emitted", () => {
    const nodes: N[] = [
      node("a", null, 0),
      node("b", "a", 0),
      node("c", "b", 0),
      node("d", "c", 0),
    ];
    const r = walkTopology(nodes, {
      collapsed: new Set(["b"]),
      sort: byPosition,
    });
    expect(r.visibleEdges).toEqual([{ source: "a", target: "b" }]);
  });
});

describe("walkTopology — golden fixture parity", () => {
  // Same six fixtures consumed by backend/internal/shared/topology Go
  // tests. Bytes-identical row projections prove cross-runtime parity.
  for (const slug of [
    "flat-list",
    "single-root-deep",
    "multi-root-forest",
    "orphan-drop",
    "cycle-guard",
    "collapse-hides-subtree",
  ]) {
    it(`fixture: ${slug}`, () => {
      const fx = loadFixture(slug) as {
        input: {
          nodes: N[];
          collapsed: string[];
          sort: "byPosition" | "byLabel";
          maxDepth?: number;
        };
        expected: {
          rows: ReturnType<typeof projectRow>[];
          visibleIds: string[];
          visibleEdges: Array<{ source: string; target: string }>;
        };
      };
      const cmp =
        fx.input.sort === "byLabel"
          ? (byLabel as (a: N, b: N) => number)
          : byPosition;
      const r = walkTopology(fx.input.nodes, {
        collapsed: new Set(fx.input.collapsed),
        sort: cmp,
        maxDepth: fx.input.maxDepth,
      });
      expect(r.rows.map(projectRow)).toEqual(fx.expected.rows);
      expect([...r.visibleIds].sort()).toEqual(
        [...fx.expected.visibleIds].sort(),
      );
      expect(r.visibleEdges).toEqual(fx.expected.visibleEdges);
    });
  }
});
