// filterState.ts — single source of truth for V2A's filter dispatch.
//
// Replaces V2's nine scattered useState hooks (filterCategory,
// filterItem, kHops, selectionSet, isolationMode, etc.) with one
// reducer. The rail dispatches actions; the canvas reads the result
// through a single dimNode(node, state) predicate.

import type { FilterDef, FilterGroupId } from "./filterRegistry";
import { FILTERS } from "./filterRegistry";

// ─── Audit shape (the enriched node — Phase A/B/C fields present) ──────────

export type GraphNode = {
  id: string;
  side: "frontend" | "backend";
  folder: string;
  layer: string;
  sloc: number;
  fan_in: number;
  fan_out: number;
  criticality: number;
  // Phase B/C enrichment (present on every node from 2026-05-24):
  tags?: string[];
  generated?: boolean;
  visibility?: "exported" | "internal";
  system?: string | null;
  has_test?: boolean;
  test_path?: string | null;
  critical_paths?: string[];
  in_critical_path?: boolean;
  cycle_id?: number | null;
  in_cycle?: boolean;
  complexity?: number;
};

export type GraphEdge = { source: string; target: string; kind: "import" | "bridge" };

// ─── Filter state ─────────────────────────────────────────────────────────

export type FilterState = {
  layers: string[];                    // [] = no filter
  side: "all" | "frontend" | "backend";
  systems: string[];
  uiComposition: null | "page" | "layout" | "component" | "hook";

  importDirection: "all" | "in" | "out" | "bi";
  depth: 0 | 1 | 2 | 3;                // 0 = infinity / off (off when no seed)
  bridgeKinds: string[];               // ["import","bridge"] or subset
  boundaryCrossingsOnly: boolean;
  apiSurfaceKinds: string[];           // Phase B placeholder

  fanInRange: [number, number] | null; // null = no filter
  fanOutRange: [number, number] | null;
  orphansOnly: boolean;
  deadEndsOnly: boolean;
  cyclesOnly: boolean;
  criticalPaths: string[];             // seed names; [] = no filter
  complexityRange: [number, number] | null;

  surfaceTags: string[];               // toggles concatenated: auth/authz/audit/security/error/db/config
  stateOnly: boolean;
  stylingKinds: string[];              // ["catalog","dui","bespoke"] subset
  generatedMode: "all" | "handwritten" | "generated";
  visibilityMode: "all" | "exported" | "internal";

  testCoverageMode: "all" | "covered" | "uncovered";

  // Seed for node-seeded filters (direction + depth + critical-path source).
  seedNodeId: string | null;
};

export const DEFAULT_STATE: FilterState = {
  layers: [],
  side: "all",
  systems: [],
  uiComposition: null,
  importDirection: "all",
  depth: 0,
  bridgeKinds: ["import", "bridge"],
  boundaryCrossingsOnly: false,
  apiSurfaceKinds: [],
  fanInRange: null,
  fanOutRange: null,
  orphansOnly: false,
  deadEndsOnly: false,
  cyclesOnly: false,
  criticalPaths: [],
  complexityRange: null,
  surfaceTags: [],
  stateOnly: false,
  stylingKinds: [],
  generatedMode: "all",
  visibilityMode: "all",
  testCoverageMode: "all",
  seedNodeId: null,
};

// ─── Reducer ──────────────────────────────────────────────────────────────

export type FilterAction =
  | { type: "set"; filterId: string; value: unknown }
  | { type: "resetFilter"; filterId: string }
  | { type: "resetGroup"; groupId: FilterGroupId }
  | { type: "resetAll" }
  | { type: "setSeed"; nodeId: string | null };

export function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "set":
      // Generic setter — filterId maps 1:1 to FilterState key for chips,
      // radio, range, toggle archetypes. Cast is contained here.
      return { ...state, [action.filterId]: action.value } as FilterState;
    case "resetFilter":
      return resetFilter(state, action.filterId);
    case "resetGroup":
      return resetGroup(state, action.groupId);
    case "resetAll":
      // Preserve seed selection across reset (the canvas selection is
      // orthogonal to filter clearing — clicking Reset shouldn't lose
      // the user's selected node).
      return { ...DEFAULT_STATE, seedNodeId: state.seedNodeId };
    case "setSeed":
      // Clearing the seed also clears node-seeded filters that depend
      // on it (direction / depth) — they'd be meaningless without it.
      if (action.nodeId === null) {
        return { ...state, seedNodeId: null, importDirection: "all", depth: 0 };
      }
      return { ...state, seedNodeId: action.nodeId };
  }
}

function resetFilter(state: FilterState, filterId: string): FilterState {
  const def: FilterDef | undefined = FILTERS.find(f => f.id === filterId);
  if (!def) return state;
  return { ...state, [filterId]: getDefaultValue(filterId) } as FilterState;
}

function resetGroup(state: FilterState, groupId: FilterGroupId): FilterState {
  let next: FilterState = state;
  for (const f of FILTERS) {
    if (f.group === groupId) {
      next = { ...next, [f.id]: getDefaultValue(f.id) } as FilterState;
    }
  }
  return next;
}

function getDefaultValue(filterId: string): unknown {
  return (DEFAULT_STATE as unknown as Record<string, unknown>)[filterId];
}

// ─── Active-filter detection ──────────────────────────────────────────────
// "Active" = differs from the default. Used by the active-filter summary
// line + per-group counts + global reset disabled state.

export function isFilterActive(state: FilterState, filterId: string): boolean {
  const def = FILTERS.find(f => f.id === filterId);
  if (!def) return false;
  const current = (state as unknown as Record<string, unknown>)[filterId];
  const fallback = getDefaultValue(filterId);
  return !shallowEqual(current, fallback);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return false;
}

export function activeFilters(state: FilterState): FilterDef[] {
  return FILTERS.filter(f => isFilterActive(state, f.id));
}

export function activeCountInGroup(state: FilterState, groupId: FilterGroupId): number {
  return FILTERS.filter(f => f.group === groupId && isFilterActive(state, f.id)).length;
}

// ─── dimNode predicate — the SINGLE place all filters AND together ────────
//
// Replaces V2's filterDimSet + isolateSet + selectionSet composition.
// Returns true if the node should be dimmed (not matched). False = bright.

export function buildDimPredicate(
  state: FilterState,
  edges: GraphEdge[],
): (node: GraphNode) => boolean {
  // Precompute the BFS k-hop set if depth filter is active + seed exists.
  // This is per-render, but BFS on 1,260 edges is sub-ms.
  let kHopSet: Set<string> | null = null;
  if (state.seedNodeId && state.depth > 0) {
    kHopSet = bfsKHops(edges, state.seedNodeId, state.depth);
  }

  // Direction-restricted set: from the seed, ONLY the in / out / bi peers.
  let directionSet: Set<string> | null = null;
  if (state.seedNodeId && state.importDirection !== "all") {
    directionSet = new Set([state.seedNodeId]);
    for (const e of edges) {
      if (state.importDirection === "out" && e.source === state.seedNodeId) directionSet.add(e.target);
      else if (state.importDirection === "in" && e.target === state.seedNodeId) directionSet.add(e.source);
      else if (state.importDirection === "bi") {
        if (e.source === state.seedNodeId) directionSet.add(e.target);
        if (e.target === state.seedNodeId) directionSet.add(e.source);
      }
    }
  }

  // Side-boundary edges precomputed once per render.
  const boundaryNodeIds: Set<string> | null = state.boundaryCrossingsOnly
    ? new Set()
    : null;
  if (boundaryNodeIds) {
    // We don't have node→side lookup in this scope; the caller bakes it
    // into the predicate via a closure on the nodes list. Predicate gets
    // node objects, so side is on each.
    // We'll lift this check into the predicate body.
  }

  return (n: GraphNode): boolean => {
    // Structure
    if (state.layers.length > 0 && !state.layers.includes(n.layer)) return true;
    if (state.side !== "all" && n.side !== state.side) return true;
    if (state.systems.length > 0) {
      if (!n.system || !state.systems.includes(n.system)) return true;
    }
    if (state.uiComposition) {
      if (n.layer !== state.uiComposition) return true;
    }

    // Connections (depth + direction)
    if (kHopSet && !kHopSet.has(n.id)) return true;
    if (directionSet && !directionSet.has(n.id)) return true;
    if (state.boundaryCrossingsOnly) {
      // A node is "on a crossing" if any of its edges crosses sides.
      // We need an edge lookup; predicate captured edges via closure.
      let touches = false;
      for (const e of edges) {
        if (e.source === n.id || e.target === n.id) {
          const otherSide =
            (e.source === n.id ? e.target : e.source);
          // Heuristic: cross-side if id prefix divergence. We pin this
          // properly below using the node's own side and a quick map.
          // Simpler — bridge edges by definition cross sides.
          if (e.kind === "bridge") { touches = true; break; }
          // For import edges we need the other node's side; we'll
          // approximate via path prefix.
          if ((n.side === "frontend" && otherSide.startsWith("backend/")) ||
              (n.side === "backend" && !otherSide.startsWith("backend/"))) {
            touches = true; break;
          }
        }
      }
      if (!touches) return true;
    }

    // Criticality
    if (state.fanInRange) {
      const [lo, hi] = state.fanInRange;
      if (n.fan_in < lo || n.fan_in > hi) return true;
    }
    if (state.fanOutRange) {
      const [lo, hi] = state.fanOutRange;
      if (n.fan_out < lo || n.fan_out > hi) return true;
    }
    if (state.orphansOnly && n.fan_in !== 0) return true;
    if (state.deadEndsOnly && n.fan_out !== 0) return true;
    if (state.cyclesOnly && !n.in_cycle) return true;
    if (state.criticalPaths.length > 0) {
      const paths = n.critical_paths ?? [];
      if (!state.criticalPaths.some(p => paths.includes(p))) return true;
    }
    if (state.complexityRange) {
      const [lo, hi] = state.complexityRange;
      const c = n.complexity ?? 0;
      if (c < lo || c > hi) return true;
    }

    // Surface tags — every active toggle AND's onto required tags.
    if (state.surfaceTags.length > 0) {
      const tags = n.tags ?? [];
      if (!state.surfaceTags.every(t => tags.includes(t))) return true;
    }

    // State & Style
    if (state.stateOnly && !(n.tags ?? []).includes("state")) return true;
    if (state.stylingKinds.length > 0) {
      const has = (n.tags ?? []);
      const hasCatalog = has.includes("styled");
      const hasDui = has.includes("dui");
      const hasBespoke = !hasCatalog && !hasDui;
      const matches =
        (state.stylingKinds.includes("catalog") && hasCatalog) ||
        (state.stylingKinds.includes("dui") && hasDui) ||
        (state.stylingKinds.includes("bespoke") && hasBespoke);
      if (!matches) return true;
    }
    if (state.generatedMode === "handwritten" && n.generated) return true;
    if (state.generatedMode === "generated" && !n.generated) return true;
    if (state.visibilityMode !== "all" && n.visibility !== state.visibilityMode) return true;

    // Provenance
    if (state.testCoverageMode === "covered" && !n.has_test) return true;
    if (state.testCoverageMode === "uncovered" && n.has_test) return true;

    // Bridge-kind filter applies to EDGES, not nodes — handled in the
    // edge visibility callback, not here.

    return false;
  };
}

function bfsKHops(edges: GraphEdge[], seed: string, k: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  const reached = new Set<string>([seed]);
  let frontier = new Set<string>([seed]);
  for (let hop = 0; hop < k; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const nbr of adj.get(id) ?? []) {
        if (!reached.has(nbr)) {
          reached.add(nbr);
          next.add(nbr);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return reached;
}
