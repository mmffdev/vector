"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// Chart ref: C-18
// PortfolioGraphChart — force-directed node-link diagram for the
// Vector portfolio hierarchy. A drop-down picks the root level
// (Workspaces → Tasks); clicking a node toggles its children;
// dragging a node lets the user organise sub-trees by hand. Spring
// physics keep edges taut while letting subtrees follow when their
// parent is moved.
//
// Levels mirror the canonical Vector portfolio hierarchy
// (workspace → portfolio → product → business objective → theme →
// feature → story → task). Stub data ships by default; replace
// `tree` with API data when wiring up. Colours come from the active
// theme via design tokens, so the chart restyles automatically when
// the user switches theme packs.
//
// Usage: <PortfolioGraphChart />                          // stub
//        <PortfolioGraphChart tree={...} />               // real data
//        <PortfolioGraphChart randomize />                // PREVIEW ONLY

export type PortfolioLevel =
  | "workspace"
  | "portfolio"
  | "product"
  | "objective"
  | "theme"
  | "feature"
  | "story"
  | "task";

export type PortfolioNode = {
  id: string;
  label: string;
  level: PortfolioLevel;
  parentId: string | null;
  childIds: string[];
};

export type PortfolioTree = Record<string, PortfolioNode>;

const LEVEL_ORDER: PortfolioLevel[] = [
  "workspace",
  "portfolio",
  "product",
  "objective",
  "theme",
  "feature",
  "story",
  "task",
];

const LEVEL_LABELS: Record<PortfolioLevel, string> = {
  workspace: "Workspaces",
  portfolio: "Portfolios",
  product: "Products",
  objective: "Business Objectives",
  theme: "Themes",
  feature: "Features",
  story: "Stories",
  task: "Tasks",
};

const LEVEL_TAGS: Record<PortfolioLevel, string> = {
  workspace: "WS",
  portfolio: "PO",
  product: "PR",
  objective: "OB",
  theme: "TH",
  feature: "FE",
  story: "ST",
  task: "TK",
};

// --- Stub data -------------------------------------------------------
// Replace `DEFAULT_TREE` with API data when wiring up. Stub mirrors
// the canonical hierarchy with realistic fanout (some branches go
// deep, others stop early — like a real portfolio mid-decomposition).

function buildStubTree(): PortfolioTree {
  const tree: PortfolioTree = {};
  let counter = 0;
  const add = (label: string, level: PortfolioLevel, parentId: string | null): string => {
    const id = `${level}-${++counter}`;
    tree[id] = { id, label, level, parentId, childIds: [] };
    if (parentId) tree[parentId].childIds.push(id);
    return id;
  };

  // Single workspace
  const ws = add("Acme HQ", "workspace", null);

  // Two portfolios
  const growth = add("Growth", "portfolio", ws);
  const platform = add("Platform", "portfolio", ws);

  // Products under each portfolio
  const vector = add("Vector", "product", growth);
  const pulse = add("Pulse", "product", growth);
  const atlas = add("Atlas", "product", platform);
  const conduit = add("Conduit", "product", platform);

  // Objectives under Vector
  const activation = add("Activation", "objective", vector);
  const retention = add("Retention", "objective", vector);
  add("Expansion", "objective", vector);

  // Objectives under Pulse / Atlas / Conduit (left shallow)
  add("Reliability", "objective", pulse);
  add("Cost-to-serve", "objective", pulse);
  add("Time-to-insight", "objective", atlas);
  add("Throughput", "objective", conduit);

  // Themes under Activation
  const onboarding = add("Onboarding flow", "theme", activation);
  const inAppGuide = add("In-app guidance", "theme", activation);

  // Themes under Retention
  const powerUser = add("Power-user tooling", "theme", retention);
  add("Re-engagement nudges", "theme", retention);

  // Features under each theme (varied depth)
  const wizard = add("First-run wizard", "feature", onboarding);
  add("Account verification", "feature", onboarding);
  const tooltip = add("Tooltip system", "feature", inAppGuide);
  const palette = add("Command palette", "feature", powerUser);

  // Stories under wizard / tooltip / palette
  const tour = add("Step-through tour", "story", wizard);
  add("Skip & resume", "story", wizard);
  add("Tooltip authoring", "story", tooltip);
  add("Fuzzy command match", "story", palette);

  // Tasks under tour
  add("Build tour shell", "task", tour);
  add("Wire tour data", "task", tour);
  add("Track completion", "task", tour);

  return tree;
}

const DEFAULT_TREE: PortfolioTree = buildStubTree();
const DEFAULT_ROOT: PortfolioLevel = "product";

// --- Geometry / physics ----------------------------------------------
const W = 1000;
const H = 600;
const NODE_R_BY_DEPTH = [26, 22, 19, 17, 15, 13, 12, 11];
const SPRING_K = 0.04;
const REST_LEN = 110;
const REPULSE_K = 2400;
const DAMPING = 0.82;
// Hierarchical gravity — each depth-row settles at a target Y so the
// rest state reads top-down: root at the top, descendants stacked
// below in canonical order. Horizontal pull is much weaker so siblings
// can spread out across the canvas.
const TOP_MARGIN = 70;
const ROW_GAP = 80;
const DEPTH_GRAVITY = 0.05;
const H_CENTER_PULL = 0.003;
const STEP_LIMIT = 10;        // px per frame, prevents jitter on large forces
const ENERGY_FLOOR = 0.05;    // below this we stop ticking re-renders
const RENDER_MS = 33;         // ~30fps repaint cadence
const BORDER = 24;            // keep nodes inside the viewBox

type SimNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
};

function depthFor(level: PortfolioLevel, rootLevel: PortfolioLevel): number {
  return Math.max(0, LEVEL_ORDER.indexOf(level) - LEVEL_ORDER.indexOf(rootLevel));
}

function toneFromDepth(depth: number): 1 | 2 | 3 | 4 | 5 {
  return (Math.min(5, Math.max(1, depth + 1))) as 1 | 2 | 3 | 4 | 5;
}

function radiusForDepth(depth: number): number {
  return NODE_R_BY_DEPTH[Math.min(NODE_R_BY_DEPTH.length - 1, Math.max(0, depth))];
}

// =============================================================
// PREVIEW-ONLY — random data generator. Not part of the normal
// chart API. Pass `randomize` so the catalogue page can show
// shape variability without backend wiring; on mount it re-rolls
// the entire tree, and the inline ↻ button re-rolls again on
// click. DO NOT pass `randomize` when wiring real data.
//
// Sanitisation rules for THIS chart shape — "Force-directed graph
// / hierarchical node-link tree". Not in the matrix; shape
// constraints are structural (tree topology) rather than numeric.
// Closest cousin is sankey/flow but a tree has no flow
// conservation — instead each non-root node has exactly one
// parent and the resulting graph is acyclic and connected.
//   • Tree must be CONNECTED — every non-root node has exactly
//     one parent at the level immediately above it. No cross-
//     edges, no orphan branches.
//   • Branching factor capped at 1..3 children per parent so
//     the layout doesn't blow up under "expand all"; depth
//     capped at the canonical hierarchy length (8).
//   • Labels sampled from per-level pools WITHOUT REPLACEMENT
//     within siblings so no two siblings collide on name.
//   • Fanout tapers with depth — wider near root, narrower at
//     the leaves — to mirror realistic portfolio shapes (many
//     features per theme is OK; many tasks per story is not).
//   • Exactly one workspace, always — workspaces are tenant-
//     singletons in the canonical model.
//   • IDs are unique and stable per generation; no collisions
//     between re-rolls (counter resets per call).
// If you build another graph chart with different topology
// constraints (DAGs with multiple parents, cyclic networks,
// bipartite graphs) write a separate generator — do not reuse
// this one.
// =============================================================
const RANDOM_LABEL_POOLS: Record<PortfolioLevel, string[]> = {
  workspace: ["Acme HQ", "Northwind Group", "Helix Co", "Meridian Labs", "Aperture"],
  portfolio: ["Growth", "Platform", "Customer Experience", "Foundations", "Trust", "Data", "Mobile"],
  product: ["Vector", "Pulse", "Atlas", "Conduit", "Beacon", "Lattice", "Prism", "Ember", "Halo"],
  objective: ["Activation", "Retention", "Expansion", "Reliability", "Cost-to-serve",
              "Time-to-insight", "Throughput", "Latency", "NPS lift", "Conversion"],
  theme: ["Onboarding flow", "In-app guidance", "Power-user tooling", "Re-engagement",
          "Self-serve admin", "Mobile parity", "Analytics surface", "Workflow automation",
          "Collaboration", "Notifications"],
  feature: ["First-run wizard", "Tooltip system", "Command palette", "Bulk actions",
            "Saved views", "Keyboard nav", "Audit log", "Export", "Webhook delivery",
            "Inline search", "Drag-drop reorder", "Annotations"],
  story: ["Tour skeleton", "Skip & resume", "Authoring UI", "Fuzzy match",
          "Permission gating", "Empty states", "Loading states", "Error recovery",
          "Telemetry", "A11y pass"],
  task: ["Spike", "Implement", "Wire data", "Add tests", "Polish", "Document",
         "Review", "Ship", "Backfill", "Metric"],
};

const FANOUT_BY_DEPTH: number[] = [2, 3, 3, 2, 2, 2, 1, 1];

function pickWithoutReplacement<T>(pool: T[], n: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function randomTree(): PortfolioTree {
  const tree: PortfolioTree = {};
  let counter = 0;
  const add = (label: string, level: PortfolioLevel, parentId: string | null): string => {
    const id = `${level}-${++counter}`;
    tree[id] = { id, label, level, parentId, childIds: [] };
    if (parentId) tree[parentId].childIds.push(id);
    return id;
  };

  const wsLabel = pickWithoutReplacement(RANDOM_LABEL_POOLS.workspace, 1)[0];
  const wsId = add(wsLabel, "workspace", null);

  const grow = (parentId: string, levelIdx: number) => {
    if (levelIdx >= LEVEL_ORDER.length) return;
    const level = LEVEL_ORDER[levelIdx];
    const fanCap = FANOUT_BY_DEPTH[levelIdx] ?? 1;
    const fan = 1 + Math.floor(Math.random() * fanCap);
    const labels = pickWithoutReplacement(RANDOM_LABEL_POOLS[level], fan);
    labels.forEach((label) => {
      const childId = add(label, level, parentId);
      // Probability of further descent tapers with depth so leaves
      // stay sparse (matches realistic portfolio shape).
      const continueProb = Math.max(0.2, 0.95 - levelIdx * 0.1);
      if (Math.random() < continueProb) grow(childId, levelIdx + 1);
    });
  };

  grow(wsId, 1);
  return tree;
}

// =====================================================================

export default function PortfolioGraphChart({
  tree = DEFAULT_TREE,
  initialRoot = DEFAULT_ROOT,
  randomize = false,
}: {
  tree?: PortfolioTree;
  initialRoot?: PortfolioLevel;
  /** PREVIEW ONLY — re-roll the tree on mount + show ↻ button. */
  randomize?: boolean;
}) {
  const [activeTree, setActiveTree] = useState<PortfolioTree>(tree);
  const [rootLevel, setRootLevel] = useState<PortfolioLevel>(initialRoot);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);

  const simRef = useRef<Map<string, SimNode>>(new Map());
  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Re-seed tree on randomize.
  useEffect(() => {
    if (randomize) {
      setActiveTree(randomTree());
      setExpanded(new Set());
      simRef.current.clear();
    }
  }, [randomize]);

  // Compute visible node ids: start with all root-level nodes, then
  // walk children of any expanded node.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    const queue: string[] = Object.values(activeTree)
      .filter((n) => n.level === rootLevel)
      .map((n) => n.id);
    queue.forEach((id) => ids.add(id));
    while (queue.length) {
      const id = queue.shift()!;
      if (expanded.has(id)) {
        for (const cid of activeTree[id].childIds) {
          ids.add(cid);
          queue.push(cid);
        }
      }
    }
    return ids;
  }, [activeTree, rootLevel, expanded]);

  const visibleEdges = useMemo(() => {
    const edges: { from: string; to: string }[] = [];
    visibleIds.forEach((id) => {
      const node = activeTree[id];
      if (node.parentId && visibleIds.has(node.parentId)) {
        edges.push({ from: node.parentId, to: id });
      }
    });
    return edges;
  }, [visibleIds, activeTree]);

  // Seed positions for newly-visible nodes. Y is initialised at the
  // node's depth-row target so the layout snaps near its rest state
  // immediately; X starts near the parent (with jitter) or near the
  // centre line for orphan roots. Evict positions for nodes that are
  // no longer visible so the sim doesn't drift forever.
  useEffect(() => {
    const sim = simRef.current;
    const rootNodes: string[] = [];
    visibleIds.forEach((id) => {
      if (sim.has(id)) return;
      const node = activeTree[id];
      const depth = depthFor(node.level, rootLevel);
      const targetY = TOP_MARGIN + depth * ROW_GAP;
      const parent = node.parentId ? sim.get(node.parentId) : null;
      const jitter = (Math.random() - 0.5) * 80;
      const cx = parent ? parent.x + jitter : W / 2 + jitter;
      sim.set(id, {
        id,
        x: cx,
        y: targetY,
        vx: 0,
        vy: 0,
        fixed: false,
      });
      if (!node.parentId || !visibleIds.has(node.parentId)) rootNodes.push(id);
    });
    // Spread orphan-root nodes horizontally across the canvas so they
    // don't all spawn on top of each other when the dropdown switches
    // root level. Y is already pinned to the root row by the seed above.
    rootNodes.forEach((id, i) => {
      const n = sim.get(id);
      if (!n) return;
      const span = W - BORDER * 2;
      n.x = BORDER + span * ((i + 1) / (rootNodes.length + 1));
    });
    Array.from(sim.keys()).forEach((id) => {
      if (!visibleIds.has(id)) sim.delete(id);
    });
  }, [visibleIds, activeTree, rootLevel]);

  // Physics loop — fixed-step integration, throttled re-render so
  // React reconciliation isn't the bottleneck.
  useEffect(() => {
    let raf = 0;
    let lastRender = 0;
    const loop = (t: number) => {
      const sim = simRef.current;
      const ids = Array.from(sim.keys());
      if (ids.length === 0) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const fx: Record<string, number> = {};
      const fy: Record<string, number> = {};
      ids.forEach((id) => {
        fx[id] = 0;
        fy[id] = 0;
      });

      // Spring forces along edges
      visibleEdges.forEach((e) => {
        const a = sim.get(e.from);
        const b = sim.get(e.to);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = SPRING_K * (dist - REST_LEN);
        const ux = dx / dist;
        const uy = dy / dist;
        fx[a.id] += force * ux;
        fy[a.id] += force * uy;
        fx[b.id] -= force * ux;
        fy[b.id] -= force * uy;
      });

      // Repulsion between every pair of visible nodes
      for (let i = 0; i < ids.length; i++) {
        const a = sim.get(ids[i])!;
        for (let j = i + 1; j < ids.length; j++) {
          const b = sim.get(ids[j])!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = Math.max(120, dx * dx + dy * dy);
          const dist = Math.sqrt(distSq);
          const force = REPULSE_K / distSq;
          const ux = dx / dist;
          const uy = dy / dist;
          fx[a.id] -= force * ux;
          fy[a.id] -= force * uy;
          fx[b.id] += force * ux;
          fy[b.id] += force * uy;
        }
      }

      // Hierarchical gravity: vertical position is pulled toward the
      // depth-row target Y so the rest state reads top-down; horizontal
      // pull is weak so siblings spread out across the canvas instead
      // of stacking on the centre line.
      ids.forEach((id) => {
        const n = sim.get(id)!;
        const node = activeTree[id];
        const depth = node ? depthFor(node.level, rootLevel) : 0;
        const targetY = TOP_MARGIN + depth * ROW_GAP;
        fx[id] += (W / 2 - n.x) * H_CENTER_PULL;
        fy[id] += (targetY - n.y) * DEPTH_GRAVITY;
      });

      // Integrate
      let energy = 0;
      ids.forEach((id) => {
        const n = sim.get(id)!;
        if (n.fixed) {
          n.vx = 0;
          n.vy = 0;
          return;
        }
        n.vx = (n.vx + fx[id]) * DAMPING;
        n.vy = (n.vy + fy[id]) * DAMPING;
        const stepX = Math.max(-STEP_LIMIT, Math.min(STEP_LIMIT, n.vx));
        const stepY = Math.max(-STEP_LIMIT, Math.min(STEP_LIMIT, n.vy));
        n.x = Math.max(BORDER, Math.min(W - BORDER, n.x + stepX));
        n.y = Math.max(BORDER, Math.min(H - BORDER, n.y + stepY));
        energy += stepX * stepX + stepY * stepY;
      });

      // Throttle React re-renders; skip when settled and no drag.
      if (t - lastRender > RENDER_MS && (energy > ENERGY_FLOOR || dragRef.current)) {
        lastRender = t;
        setTick((tt) => tt + 1);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [visibleEdges, activeTree, rootLevel]);

  // --- Pointer handlers ---------------------------------------------
  // Click vs drag: track movement during pointerdown→up; if the
  // cursor barely moved, treat as a click and toggle expansion.
  const handlePointerDown = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      e.preventDefault();
      const sim = simRef.current.get(id);
      if (!sim) return;
      sim.fixed = true;
      dragRef.current = {
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    const sim = simRef.current.get(drag.id);
    if (!sim) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    sim.x = Math.max(BORDER, Math.min(W - BORDER, sx));
    sim.y = Math.max(BORDER, Math.min(H - BORDER, sy));
    sim.vx = 0;
    sim.vy = 0;
    setTick((t) => t + 1);
  }, []);

  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const sim = simRef.current.get(drag.id);
    if (sim) sim.fixed = false;
    if (!drag.moved) {
      const node = activeTree[drag.id];
      if (node && node.childIds.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(drag.id)) next.delete(drag.id);
          else next.add(drag.id);
          return next;
        });
      }
    }
    dragRef.current = null;
    setTick((t) => t + 1);
  }, [activeTree]);

  // --- Toolbar handlers ---------------------------------------------
  const handleRootChange = (next: PortfolioLevel) => {
    setRootLevel(next);
    setExpanded(new Set());
    simRef.current.clear();
  };

  const handleExpandAll = () => {
    const next = new Set<string>();
    Object.values(activeTree).forEach((n) => {
      if (n.childIds.length > 0) next.add(n.id);
    });
    setExpanded(next);
  };

  const handleCollapseAll = () => setExpanded(new Set());

  const handleReroll = () => {
    setActiveTree(randomTree());
    setExpanded(new Set());
    simRef.current.clear();
  };

  // --- Render --------------------------------------------------------
  return (
    <div className="portfolio-graph-host">
      <div className="portfolio-graph__toolbar">
        <label className="portfolio-graph__select-wrap">
          <span className="portfolio-graph__select-label">Root</span>
          <select
            className="portfolio-graph__select"
            value={rootLevel}
            onChange={(ev) => handleRootChange(ev.target.value as PortfolioLevel)}
          >
            {LEVEL_ORDER.map((lvl) => (
              <option key={lvl} value={lvl}>
                {LEVEL_LABELS[lvl]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="portfolio-graph__btn" onClick={handleExpandAll}>
          Expand all
        </button>
        <button type="button" className="portfolio-graph__btn" onClick={handleCollapseAll}>
          Collapse all
        </button>
        {randomize && (
          <button
            type="button"
            className="portfolio-graph__btn portfolio-graph__btn--reroll"
            onClick={handleReroll}
            aria-label="Generate new random data"
            title="Generate new random data (preview only)"
          >
            ↻
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="portfolio-graph chart-card__svg"
        role="img"
        aria-label={`Portfolio graph rooted at ${LEVEL_LABELS[rootLevel]}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Edges first so nodes overlay them. Endpoints are truncated
            to the perimeter of each circle (rather than its centre) so
            the line never visibly crosses the disc — even with translucent
            node fills, the connector reads as joining edge-to-edge. */}
        {visibleEdges.map((e) => {
          const a = simRef.current.get(e.from);
          const b = simRef.current.get(e.to);
          if (!a || !b) return null;
          const aNode = activeTree[e.from];
          const bNode = activeTree[e.to];
          const aR = radiusForDepth(depthFor(aNode.level, rootLevel));
          const bR = radiusForDepth(depthFor(bNode.level, rootLevel));
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          return (
            <line
              key={`edge-${e.from}-${e.to}`}
              x1={a.x + ux * aR}
              y1={a.y + uy * aR}
              x2={b.x - ux * bR}
              y2={b.y - uy * bR}
              className="portfolio-graph__edge"
            />
          );
        })}

        {/* Nodes */}
        {Array.from(visibleIds).map((id) => {
          const node = activeTree[id];
          const sim = simRef.current.get(id);
          if (!sim) return null;
          const depth = depthFor(node.level, rootLevel);
          const tone = toneFromDepth(depth);
          const r = radiusForDepth(depth);
          const isExpanded = expanded.has(id);
          const hasChildren = node.childIds.length > 0;
          return (
            <g
              key={`node-${id}`}
              className="portfolio-graph__node"
              onPointerDown={handlePointerDown(id)}
            >
              <circle
                cx={sim.x}
                cy={sim.y}
                r={r}
                className={`portfolio-graph__node-bg portfolio-graph__node-bg--tone-${tone}`}
              />
              {hasChildren && (
                <text
                  x={sim.x}
                  y={sim.y}
                  className={`portfolio-graph__node-glyph portfolio-graph__node-glyph--tone-${tone}`}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {isExpanded ? "−" : "+"}
                </text>
              )}
              <text
                x={sim.x + r + 6}
                y={sim.y}
                className="portfolio-graph__node-label"
                textAnchor="start"
                dominantBaseline="central"
              >
                <tspan className="portfolio-graph__node-tag">{LEVEL_TAGS[node.level]}</tspan>
                <tspan> - {node.label}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
