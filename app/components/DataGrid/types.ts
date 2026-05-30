// <DataGrid> — public type contract.
//
// The scaffold is configured entirely through DataGridConfig<TRow>.
// Pages own their own config file (e.g. p_workItems_dataGridConfig.tsx)
// and pass it to the scaffold. The scaffold reads it; the scaffold never
// branches on which page it serves.
//
// Rule for adding new features:
//   1. New behaviour goes onto DataGridConfig as an OPTIONAL property.
//   2. Default = off. Pages that want the behaviour opt in.
//   3. Adding the property must not change any existing page's behaviour.

import type { ReactNode } from "react";

// ────────────────────────────────────────────────────────────────────────────
// Tree-row render context (tree mode only)
// ────────────────────────────────────────────────────────────────────────────

// Handed to a column's renderCell ONLY when the grid runs in tree mode
// (config.tree is set). Carries the per-row tree geometry the primary
// column needs to draw indentation lines + the expander caret — mirrors
// ResourceTree's RenderCtx so the same exported PrimaryCellTreeLines /
// PrimaryCellExpander helpers can be reused verbatim.
//
// In flat mode this is undefined; renderCell receives only the row.
export interface RowTreeCtx {
  /** 0 for roots, +1 per nesting level. Drives indent width. */
  depth: number;
  /** This row currently has its children expanded below it. */
  expanded: boolean;
  /** This row has children that CAN be expanded (children_count > 0). */
  hasChildren: boolean;
  /** This row is the last among its siblings (└─ elbow vs ├─ T). */
  isLast: boolean;
  /** Expanded AND at least one child row is rendered beneath. */
  hasVisibleChildren: boolean;
  /**
   * Per-ancestor-level flag: does the ancestor at this depth still have
   * siblings below this subtree (→ draw a pass-through vertical line)?
   * Length === depth. Same shape ResourceTree's TreeLines consumes.
   */
  continuations: boolean[];
  /** Toggle this row's expansion (lazy-loads children on first expand). */
  toggle: () => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Column descriptor
// ────────────────────────────────────────────────────────────────────────────

export interface DataGridColumn<TRow = unknown> {
  /** Stable identifier — used as React key + sort key + width-state key. */
  id: string;
  /** Header label rendered in __Grid_HeaderRow_Cell. */
  label: string;
  /**
   * Default width in px. Use `null` for the single flex column that
   * absorbs remaining horizontal space (typically "Summary"/"title").
   */
  defaultWidth: number | null;
  /** Header click toggles sort direction on this column. Default false. */
  sortable?: boolean;
  /**
   * Drag-resize gutter + double-click reset to defaultWidth. Default true
   * for fixed-width columns; ignored when defaultWidth is null (the flex
   * column doesn't resize — its width is computed).
   */
  resizable?: boolean;
  /**
   * Cell renderer. Receives the raw row. Default = no rendering (empty
   * cell). In TREE mode the renderer also receives a RowTreeCtx as the
   * second arg so the primary column can draw lines + the expander; flat
   * mode passes undefined (back-compat — existing renderers ignore it).
   */
  renderCell?: (row: TRow, treeCtx?: RowTreeCtx) => ReactNode;
  /** Optional header-cell override. Default = label text. */
  renderHeader?: () => ReactNode;
}

// ────────────────────────────────────────────────────────────────────────────
// Sort + column state
// ────────────────────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc";

export interface SortState {
  columnId: string;
  dir:      SortDir;
}

export interface ColumnState {
  /** Per-column widths in px. Absent entries fall back to defaultWidth. */
  widths: Record<string, number>;
  sort:   SortState | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Row flyout
// ────────────────────────────────────────────────────────────────────────────

export type FlyoutMode = "view" | "duplicate" | "delete";

export interface FlyoutOpen {
  rowId: string;
  mode:  FlyoutMode;
}

/** Context handed to the flyout renderer so it can close itself. */
export interface FlyoutCtx {
  close: () => void;
  /** Re-open the same row in a different mode (e.g. view → duplicate). */
  switchMode: (mode: FlyoutMode) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Row gear / overflow menu
// ────────────────────────────────────────────────────────────────────────────

export interface RowMenuCtx {
  /** Open the row flyout in a given mode. */
  openFlyout: (mode: FlyoutMode) => void;
  /** Close the row flyout if this row owns it. */
  closeFlyout: () => void;
}

export interface RowMenuItem<TRow = unknown> {
  id:    string;
  label: string;
  icon?: ReactNode;
  /** Hide the item for specific rows. Return false to omit. */
  visible?: (row: TRow) => boolean;
  onClick: (row: TRow, ctx: RowMenuCtx) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Create action (TitleBar/ActionBar create button)
// ────────────────────────────────────────────────────────────────────────────

export interface CreateCtx {
  /** Re-fetch the grid after a successful create. */
  refresh: () => void;
}

export interface CreateAction {
  label:   string;
  onClick: (ctx: CreateCtx) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Fetch params handed to config.fetchRows
// ────────────────────────────────────────────────────────────────────────────

export interface FetchParams {
  page:     number;
  pageSize: number;
  sort:     SortState | null;
  search:   string;
}

export interface FetchResult<TRow> {
  rows:  TRow[];
  total: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Row selection (leading checkbox column) — mirrors ResourceTree's selection
//
// Selection is GRID-DISPLAY state, so the scaffold owns it internally (the
// same way useDataGridTree owns expansion) — a page opts in with a single
// `enableSelection: true` flag and never has to thread a Set + handlers
// through a module-constant config. The optional onSelectionChange callback
// lets a page observe the set (e.g. to enable a bulk-action bar) without
// owning it.
// ────────────────────────────────────────────────────────────────────────────

export interface DataGridSelectionConfig {
  /** Turn on the leading checkbox column + header select-all box. */
  enabled: boolean;
  /** Optional observer — fired with the live selected-id set on every change. */
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// DnD (tree mode) — mirrors ResourceTree's DnDConfig
// ────────────────────────────────────────────────────────────────────────────

export interface DataGridDnD<TRow = unknown> {
  /** Resource type id sent on the rank POST (e.g. "work_item"). */
  resourceType: string;
  /**
   * Legality check for a reparent (drop ONTO the middle of a row). Runs
   * on every dragover so the target row paints legal (green) or illegal
   * (red). Caller owns the rule (same-parent, cycle, allowed type, scope).
   */
  canReparent?: (moverId: string, targetId: string) => boolean;
  /** Fires on drop. intent: "onto" = new parent; "above"/"below" = sibling. */
  onReparent?: (
    moverId: string,
    targetId: string,
    intent: "onto" | "above" | "below",
  ) => void;
  /**
   * Eligibility pre-pass — called once on dragstart, returns every id
   * that's a legal reparent target so each can paint a calm green marker
   * for the duration of the drag. Optional.
   */
  getCandidateIds?: (moverId: string) => string[];
  /** Descendant id resolver — paints the whole subtree as it drags. */
  getDescendants?: (row: TRow) => string[];
}

// ────────────────────────────────────────────────────────────────────────────
// The config object the page hands to <DataGrid>
// ────────────────────────────────────────────────────────────────────────────

export interface DataGridConfig<TRow = unknown> {
  /** Stable identity for this grid instance (used for storage keys etc). */
  id: string;

  // — Identity & chrome —
  title:               string;
  titleDescription?:   string;
  subTitle:            string;
  subTitleDescription?: string;
  identBlockText:      string;
  searchPlaceholder?:  string;

  // — Data shape —
  columns:   DataGridColumn<TRow>[];
  rowIdOf:   (row: TRow) => string;
  fetchRows: (params: FetchParams) => Promise<FetchResult<TRow>>;

  // — Tree mode (opt-in) —
  //
  // When present, the scaffold renders a hierarchical tree instead of a
  // flat list: roots come from fetchRows (top-level only), and each row's
  // children load lazily on expand via tree.fetchChildren. The scaffold
  // owns expansion state, DFS-flattens roots + expanded descendants into
  // the rendered window, computes per-row geometry (depth / isLast /
  // continuations), draws a leading colour-stripe column when getColour
  // is set, and passes a RowTreeCtx into every column's renderCell so the
  // primary column can paint indentation lines + the expander caret.
  //
  // Absent → flat grid, exactly as before (zero behaviour change).
  tree?: {
    /**
     * Children count for a row. >0 makes the expander interactive; 0
     * renders a leaf (no caret). Read off the wire row (e.g.
     * children_count) — drives whether the row can expand BEFORE its
     * children are fetched.
     */
    getChildrenCount: (row: TRow) => number;
    /**
     * Lazy child loader. Called the first time a row is expanded; the
     * returned rows are cached by the scaffold and spliced beneath the
     * parent. Typically GET <resource>/{id}/children.
     */
    fetchChildren: (row: TRow) => Promise<TRow[]>;
    /**
     * Optional per-row stripe colour (the 10px leading colour border).
     * Return null to leave the slot transparent (slot still reserved so
     * widths stay aligned). When the whole callback is omitted, no stripe
     * column is rendered at all. Mirrors OTV2's getRowStripeColour.
     */
    getColour?: (row: TRow) => string | null;
    /**
     * Show an expand-all / collapse-all caret in the header row's leading
     * control slot (opt-in, default off). One click opens the entire known
     * hierarchy (cascading through each level as children resolve); a second
     * click collapses it. Use on scope-clamped grids whose rows arrive as a
     * flat windowed-tree and are nested client-side, so the user can reveal
     * all parent→child nesting at once. Absent/false → no header control,
     * rows expand individually via their own caret (unchanged behaviour).
     */
    expandAllControl?: boolean;
  };

  /**
   * Optional per-row class hook (opt-in). Returned class is appended to
   * the row element's className — used for state styling the scaffold
   * can't infer (e.g. the form-open barber-pole marker on the row whose
   * flyout is open). Mirrors ResourceTree's getRowClass. Absent → no
   * extra class. The scaffold already applies its own structural classes
   * (epic/child/selected/open); this only ADDS to them.
   */
  rowClassName?: (row: TRow) => string | undefined;

  /**
   * Drag-and-drop rank + reparent (opt-in, tree mode). When present the
   * scaffold paints a leading drag-handle column and wires the shared
   * useResourceRank hook (POST /rank/move) + drag-to-reparent. Omitted →
   * no handle column, no drag behaviour. Shape mirrors ResourceTree's
   * DnDConfig so the work-items wiring is identical across both surfaces.
   */
  dnd?: DataGridDnD<TRow>;

  /**
   * Multi-select checkbox column (opt-in). When enabled the scaffold paints
   * a leading 28px checkbox column with a header select-all box, exactly like
   * OTV2's selection column, and owns the selected-id set internally. Omitted
   * or { enabled: false } → no checkbox column.
   */
  selection?: DataGridSelectionConfig;

  /**
   * Leading cog/overflow menu column (opt-in). Same item shape as rowMenu
   * but rendered as a LEADING 32px gear column (OTV2 layout) instead of a
   * trailing dots button. Use this for the work-items grid to match OTV2;
   * rowMenu stays for flat grids that want a trailing menu. If both are
   * set, cogMenu (leading) wins and rowMenu is ignored.
   */
  cogMenu?: RowMenuItem<TRow>[];

  // — Pagination —
  pageSizeOptions?: number[];
  defaultPageSize?: number;

  // — Sorting default —
  defaultSort?: SortState | null;

  // — Row flyout (opt-in) —
  rowFlyout?: {
    /** Fetched once per rowId; cached by the consumer's data layer. */
    fetchDetail: (rowId: string) => Promise<unknown>;
    /**
     * One body component, three render branches. The component MUST be
     * keyed on rowId only (NOT on mode) so switching view↔duplicate↔delete
     * does not re-fetch — the fetched data is shared across all modes.
     */
    renderBody:  (args: {
      data:  unknown;
      mode:  FlyoutMode;
      rowId: string;
      ctx:   FlyoutCtx;
    }) => ReactNode;
    /** Optional loading state while fetchDetail is pending. */
    renderLoading?: (rowId: string) => ReactNode;
    /** Optional error state. */
    renderError?:   (error: unknown, rowId: string) => ReactNode;
  };

  // — Row gear menu (opt-in) —
  rowMenu?: RowMenuItem<TRow>[];

  // — Create action (opt-in) —
  createAction?: CreateAction;

  // — Filter buttons rendered in __ActionBar_Filters (opt-in) —
  filters?: Array<{
    id:    string;
    label: string;
    icon?: ReactNode;
    onClick: () => void;
  }>;
}
