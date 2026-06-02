"use client";

// Grid primitive — shared types for the headless core (useTree) and the
// canonical skin (Grid__Tree). This surface is deliberately INDEPENDENT of
// the legacy DataGrid types: the tree's depth / line geometry is gone (the
// CSS-border connector system derives ├ / └ / through-lines from real DOM
// nesting + :last-child, NOT from JS), so a node carries only behavioural
// state and its own children — never depth, isLast, or continuations[].

import type { ReactNode } from "react";

// ────────────────────────────────────────────────────────────────────────────
// Tree node — the headless render model
//
// useTree returns a NESTED list of these (roots → children → …) so the skin
// can render Grid__Tree_Branch recursively and let CSS draw the connectors. A node
// is a pure projection of (row + expansion/cache state); it holds NO geometry.
// ────────────────────────────────────────────────────────────────────────────

export interface TreeNode<TRow> {
  /** The raw wire row this node wraps. */
  row: TRow;
  /** Stable id (rowIdOf(row)) — React key + expansion-set key. */
  id: string;
  /** This row CAN expand (children_count > 0). Drives caret vs leaf. */
  hasChildren: boolean;
  /** This row is currently expanded. */
  expanded: boolean;
  /** Expanded AND at least one child node is present below. */
  hasVisibleChildren: boolean;
  /** This row's children fetch is in flight (spinner / barber-pole row). */
  loading: boolean;
  /**
   * Already-fetched, currently-visible children, as nested TreeNodes. Empty
   * when collapsed or childless. The skin renders these inside this node's
   * own Grid__Tree_Branch_Children so the CSS connector selectors match.
   */
  children: TreeNode<TRow>[];
  /** Toggle expansion (lazy-fetches children on first expand). */
  toggle: () => void;

  // ── Tree geometry (ResourceTree model) — drives the in-cell indent + rails ──
  /** Nesting depth from the roots (roots = 0). */
  depth: number;
  /** This node is the last among its siblings (└ vs ├). */
  isLast: boolean;
  /**
   * For each ANCESTOR level, true if that ancestor has more siblings below this
   * subtree — i.e. a │ through-line must be drawn at that level. Length =
   * depth (one flag per ancestor, ordered root→parent).
   */
  continuations: boolean[];
}

// ────────────────────────────────────────────────────────────────────────────
// useTree options — the injected behaviour. Resource-agnostic: the consumer
// supplies fetchChildren (the POST read-gateway call lives in the consumer,
// not the primitive — see TD-GRID-PRIMITIVE-GENERICITY).
// ────────────────────────────────────────────────────────────────────────────

export interface RootPage<TRow> {
  rows: TRow[];
  /** Server total across ALL roots (not just this page) — drives hasMore + jump. */
  total: number;
}

export interface UseTreeOptions<TRow> {
  /**
   * Paged root loader — owns the canopy. Called on mount for page 0, and on
   * loadMore() / jumpToPage() / refresh(). Returns the page's rows plus the
   * server total. Typically `workItems.query({ page })` → { rows, total }.
   */
  fetchRoots: (page: { limit: number; offset: number }) => Promise<RootPage<TRow>>;
  /** Roots per page. Default 100. */
  pageSize?: number;
  /** Stable id for a row. */
  rowIdOf: (row: TRow) => string;
  /**
   * Children count for a row, read off the wire row (e.g. children_count).
   * >0 makes the caret interactive BEFORE children are fetched. Only
   * consulted when `expandable` is true.
   */
  getChildrenCount: (row: TRow) => number;
  /**
   * Lazy child loader — called on first expand of a row; result is cached
   * and revealed beneath the parent. Typically `workItems.query({parentId})`.
   * Only consulted when `expandable` is true.
   */
  fetchChildren: (row: TRow) => Promise<TRow[]>;
  /**
   * Master switch. false → flat list: no carets, no fetch, every node is a
   * leaf (the non-expandable skin variant). true → full expand/lazy-load
   * machine. This is the extension seam: capability lives here in the hook,
   * the skin's row style is unchanged either way.
   */
  expandable?: boolean;
}

export interface UseTreeResult<TRow> {
  /** Roots + expanded descendants as a NESTED node tree, in render order. */
  nodes: TreeNode<TRow>[];
  /**
   * The same visible nodes FLATTENED in render order (depth-first), each
   * carrying its geometry (depth / isLast / continuations). The skin renders
   * these as flat rows so lead columns stay fixed and only the primary cell
   * indents. Replaces the old DOM-nested Branch rendering.
   */
  flatNodes: TreeNode<TRow>[];
  /** Row ids whose children fetch is currently in flight. */
  loadingIds: Set<string>;
  /** Drop all expansion + child caches — call when roots refetch. */
  reset: () => void;
  /** Expand every currently-known expandable row, recursively, in one shot. */
  expandAll: () => void;
  /** Collapse every row (clears expansion; keeps the child cache). */
  collapseAll: () => void;
  /** True when every known expandable row is expanded — drives the header icon. */
  allExpanded: boolean;

  // ── Root pagination (the canopy window the hook owns) ──────────────────────
  /** Server total across all roots. */
  total: number;
  /** Roots currently loaded (the accumulated/replaced window length). */
  loadedCount: number;
  /** Roots per page (the resolved pageSize). */
  pageSize: number;
  /** loadedCount < total — more roots remain to append. */
  hasMore: boolean;
  /** offset / pageSize — meaningful right after a jump. */
  currentPage: number;
  /** A root page fetch (mount / loadMore / jump / refresh) is in flight. */
  rootsLoading: boolean;
  /** Append the next root page below the current window; preserves expansion. */
  loadMore: () => void;
  /** Replace the window with page n (offset = n × pageSize); resets expansion. */
  jumpToPage: (n: number) => void;
  /** Re-load from offset 0 with a full reset — the post-mutation refresh. */
  refresh: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Column descriptor — consumed by the skin's Grid__Tree_Head + Grid__Tree_Row.
// (Carried over from DataGridColumn, minus the tree-geometry second arg: the
// primary cell renderer receives the node, which exposes expanded/toggle.)
// ────────────────────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc";

export interface SortState {
  columnId: string;
  dir: SortDir;
}

export interface GridColumn<TRow> {
  /** Stable id — React key + sort key + width-state key. */
  id: string;
  /** Header label. */
  label: string;
  /** Default width px. `null` = the single flex column that absorbs slack. */
  defaultWidth: number | null;
  /** Header click toggles sort on this column. */
  sortable?: boolean;
  /** Drag-resize gutter + dbl-click reset. Default true for fixed-width. */
  resizable?: boolean;
  /**
   * Cell renderer. The PRIMARY (first) column's renderer receives the node
   * so it can draw the caret + indentation hook; other columns ignore it.
   */
  renderCell?: (row: TRow, node?: TreeNode<TRow>) => ReactNode;
  /** Optional header-cell override. */
  renderHeader?: () => ReactNode;
}

// ────────────────────────────────────────────────────────────────────────────
// DnD — opt-in reparent wiring (mirrors the proven DataGrid/ResourceTree
// DnDConfig; the skin forwards this straight to useResourceRank).
// ────────────────────────────────────────────────────────────────────────────

export interface GridDnD<TRow> {
  resourceType: string;
  canReparent?: (moverId: string, targetId: string) => boolean;
  onReparent?: (
    moverId: string,
    targetId: string,
    intent: "onto" | "above" | "below",
  ) => void;
  getCandidateIds?: (moverId: string) => string[];
  getDescendants?: (row: TRow) => string[];
}

// loadingStyle is a PROP, not a component: "barberpole" makes a form-open /
// loading row paint the diagonal-stripe keyframe (grid__Tree_Row--formOpen).
// Omitted → no stripe. There is deliberately no Grid__BarberPole component.
export type GridLoadingStyle = "barberpole";

// ────────────────────────────────────────────────────────────────────────────
// Lead-column capabilities (OTV2 parity): type-stripe, selection, cog menu.
// Each is opt-in; the drag handle is wired via GridDnD. Order of the rendered
// lead tracks is always: stripe → selection → drag → cog → user columns.
// ────────────────────────────────────────────────────────────────────────────

/** Multi-select checkbox column. State is consumer-owned. */
export interface GridSelection {
  selectedIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
}

/** One row-actions menu entry under the cog. */
export interface GridMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}
