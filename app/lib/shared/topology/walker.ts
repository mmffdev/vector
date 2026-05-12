// PLA-0044: unified topology-traversal engine.
//
// Single generic walker used by every consumer that needs to flatten a
// parent_id-linked node forest into an ordered, visibility-aware row list:
// canvas dagre layout, tree-state hook, topology flyout, scope rail, BFF
// scope-clamped tree responses. The Go mirror at
// backend/internal/shared/topology lives behind a golden-fixture parity
// test (dev/fixtures/shared/topology) so both runtimes produce
// byte-identical output for the same input.
//
// Catalogued in docs/c_shared_methods.md.

export type TopologyNode = {
  id: string;
  parent_id: string | null;
};

export type FlattenedRow<T extends TopologyNode> = {
  node: T;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  isFirst: boolean;
  isLast: boolean;
  hasVisibleChildren: boolean;
  // Tree-spine encoding. Length = depth. Index d entry encodes "does the
  // ancestor at depth d have a later sibling subtree below this row?" —
  // renderers paint a vertical at column d*STEP + STEP/2 through the row
  // wherever the entry is true. The entry for the immediate parent
  // (index depth-1) is included; consumers that draw their own elbow on
  // that column can ignore it. Depth 0 rows always get an empty array.
  ancestorMoreChildren: boolean[];
};

export type WalkOpts<T extends TopologyNode> = {
  // Collapsed node ids. A collapsed node still emits its own row; its
  // subtree is skipped and not counted toward visibleEdges.
  collapsed: Set<string>;
  // Sibling order comparator. Applied to children of each parent before
  // emission. Caller injects byPosition / byLabel / etc.
  sort: (a: T, b: T) => number;
  // Pre-filter. Returning false drops the node AND its subtree (e.g.
  // archived_at !== null). Default = keep all.
  filter?: (n: T) => boolean;
  // Hard recursion cap, matches DescendantNodeIDs (12). On overflow the
  // walker stops descending; no synthetic row is emitted.
  maxDepth?: number;
};

export type WalkResult<T extends TopologyNode> = {
  rows: FlattenedRow<T>[];
  visibleIds: Set<string>;
  visibleEdges: Array<{ source: string; target: string }>;
  childrenOf: Map<string | null, T[]>;
};

const DEFAULT_MAX_DEPTH = 12;

export function walkTopology<T extends TopologyNode>(
  nodes: T[],
  opts: WalkOpts<T>,
): WalkResult<T> {
  const { collapsed, sort, filter, maxDepth = DEFAULT_MAX_DEPTH } = opts;

  // Pass 1: build childrenOf, applying filter. Orphan policy = drop:
  // a node whose parent_id is set but whose parent is missing/filtered
  // is excluded entirely (it does NOT get re-rooted under null). This
  // was the ScopeRail "phantom D" bug.
  const byId = new Map<string, T>();
  for (const n of nodes) {
    if (filter && !filter(n)) continue;
    byId.set(n.id, n);
  }

  const childrenOf = new Map<string | null, T[]>();
  for (const n of byId.values()) {
    const key =
      n.parent_id === null
        ? null
        : byId.has(n.parent_id)
          ? n.parent_id
          : undefined; // sentinel: drop
    if (key === undefined) continue;
    let bucket = childrenOf.get(key);
    if (!bucket) {
      bucket = [];
      childrenOf.set(key, bucket);
    }
    bucket.push(n);
  }
  for (const bucket of childrenOf.values()) bucket.sort(sort);

  // Pass 2: depth-first emission with visibility tracking.
  const rows: FlattenedRow<T>[] = [];
  const visibleIds = new Set<string>();
  const visibleEdges: Array<{ source: string; target: string }> = [];

  const walk = (
    parentId: string | null,
    depth: number,
    pathMoreChildren: boolean[],
  ): void => {
    if (depth > maxDepth) return;
    const kids = childrenOf.get(parentId) ?? [];
    kids.forEach((node, idx) => {
      const childKids = childrenOf.get(node.id) ?? [];
      const hasChildren = childKids.length > 0;
      const isCollapsed = collapsed.has(node.id);
      const isFirst = idx === 0;
      const isLast = idx === kids.length - 1;
      const hasVisibleChildren = hasChildren && !isCollapsed;
      visibleIds.add(node.id);
      if (parentId !== null) {
        visibleEdges.push({ source: parentId, target: node.id });
      }
      rows.push({
        node,
        depth,
        hasChildren,
        collapsed: isCollapsed,
        isFirst,
        isLast,
        hasVisibleChildren,
        ancestorMoreChildren: pathMoreChildren,
      });
      if (hasVisibleChildren) {
        // Children at depth+1 carry a path array of length depth+1.
        // The new entry (index depth) records "does the ancestor at
        // depth `depth` — i.e. this row — have a later sibling
        // subtree?" → !isLast. Renderers that suppress the depth-0
        // spine can ignore index 0; the walker always emits uniformly.
        const childPath = [...pathMoreChildren, !isLast];
        walk(node.id, depth + 1, childPath);
      }
    });
  };
  walk(null, 0, []);

  return { rows, visibleIds, visibleEdges, childrenOf };
}

// Convenience comparators used across consumers. Callers pass these
// directly as opts.sort.

export const byPosition = <
  T extends TopologyNode & { position: number; id: string },
>(
  a: T,
  b: T,
): number => {
  if (a.position !== b.position) return a.position - b.position;
  return a.id.localeCompare(b.id);
};

export const byLabel = <
  T extends TopologyNode & { __label?: string; name?: string },
>(
  a: T,
  b: T,
): number => {
  const la = a.__label ?? a.name ?? a.id;
  const lb = b.__label ?? b.name ?? b.id;
  return la.localeCompare(lb);
};
