"use client";

// Generic hierarchical-resource tree primitive (PLA-0021 / 00445).
//
// ResourceTree is the foundational primitive for unlimited-depth hierarchical
// data — work items, portfolio items, topology nodes, etc. It owns the table
// scaffold, lazy-load expand/collapse, server pagination, search/sort, column
// resize, tree-line geometry, and empty/loading placeholders.
//
// Five prop sets define the surface (see dev/research/R042.json § 0):
//   1. Data       — row generic <T>, fetchers, patch
//   2. Scaffold   — column defs (key/label/width/render/align), row metrics
//   3. Features   — pagination / search / sort / expand-all (opt-in)
//   4. CogMenu    — per-row menu items (type only this card; not wired)
//   5. Colour     — tone overrides (badge/icon/pill); default no-op
//
// Concrete trees (WorkItemsTree, PortfolioItemsTree, …) compose this primitive
// by passing column defs and fetchers — no per-tree scaffold copies.

import React, {
  useCallback,
  useState,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import {
  MdOutlineArrowForwardIos,
  MdSearch,
  MdUnfoldMore,
  MdExpandLess,
  MdExpandMore,
} from "react-icons/md";
import { BsArrowsCollapse, BsArrowsExpand } from "react-icons/bs";

// ─── Public types ─────────────────────────────────────────────────────────────

// Set 2 — Scaffold. Column definition for ResourceTree. The first column is
// always treated as the "ID" column in the header (gets the expand-all toggle).
// Cells render via the `render` callback; concrete trees use exposed helpers
// (`PrimaryCellTreeLines`, `PrimaryCellExpander`) inside that callback.
export interface ColumnDef<T> {
  /** Stable key used for sort identity and column index. */
  key: string;
  /** Header label (plain text). */
  label: string;
  /** Pixel width when the column is fixed. Pass `null` for the flex column. */
  width?: number | null;
  /** Minimum pixel width — column never shrinks below this. */
  minWidth?: number;
  /** Right-align variant — adds `tree_accordion-dense__th--mono` family. */
  align?: "left" | "mono";
  /** Extra modifier classes appended to cell + th (e.g. `--id`, `--summary`). */
  cellModifier?: string;
  /** When true, cell `onClick` calls `stopPropagation` (for interactive cells). */
  stopClick?: boolean;
  /** Cell renderer. Receives row + render context (depth, expand toggle). */
  render: (row: T, ctx: RenderCtx<T>) => ReactNode;
}

// Render context passed to each column.render — exposes the tree-line slot
// (drawn for the primary column only) and a stop-click helper for cells that
// host inline editors and shouldn't bubble row-select.
export interface RenderCtx<T> {
  row: T;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  isLast: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
  toggle: () => void;
}

// Set 3 — opt-in features.
export interface PaginationConfig {
  pageSize: number | "all";
  options: number[];
}

export interface SearchConfig<T> {
  placeholder: string;
  accessor: (row: T) => string;
}

export interface SortConfig {
  key: string | null;
  dir: "asc" | "desc";
  onChange: (key: string | null, dir: "asc" | "desc") => void;
}

// Set 4 — CogMenu. Type only; not wired in this card.
export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

// Set 5 — Colour / tone hooks. Each entry is an override callback; defaults
// resolve to no-op. Reserved for future tone packs (e.g. risk colour rules).
export interface ToneOverrides<T> {
  typeBadge?: (row: T) => string | null;
  priorityIcon?: (row: T) => string | null;
  statusPill?: (row: T) => string | null;
}

export interface ResourceTreeProps<T> {
  // ── Set 1: Data ──
  roots: T[];
  total: number;
  getId: (row: T) => string;
  getParentId: (row: T) => string | null;
  getChildrenCount: (row: T) => number;
  fetchChildren: (parentId: string) => Promise<T[]>;
  patch: (id: string, patch: Record<string, unknown>) => Promise<T>;

  // ── Set 2: Scaffold ──
  columns: ColumnDef<T>[];
  rowHeight?: number;
  indentStep?: number;

  // ── Set 3: Features (opt-in) ──
  pagination?: PaginationConfig;
  search?: SearchConfig<T>;
  sort?: SortConfig;
  expandAllConcurrency?: number;

  // ── Set 4: CogMenu (type-only this card) ──
  cogMenu?: (row: T) => MenuItem[];

  // ── Set 5: Colour / tone (no-op default) ──
  tone?: ToneOverrides<T>;

  // Selection wiring (selection itself stays caller-owned).
  selectedId?: string | null;
  onSelect?: (row: T) => void;

  // Pagination control: caller owns pageIndex (so URL adoption can replace it).
  pageIndex?: number;
  onPageIndexChange?: (next: number) => void;
  onPageSizeChange?: (next: number | "all") => void;

  // Loading flag for the current root window — drives placeholder.
  loading?: boolean;

  // Filter chips slot — caller-owned (work-items uses Type/Status/Assignee).
  filterChips?: ReactNode;

  // Accessibility label for the underlying <table>.
  ariaLabel: string;
}

// ─── Sort header icon ─────────────────────────────────────────────────────────

function SortIcon({
  active,
  dir,
  onClick,
  ariaLabel,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={
        "tree_accordion-dense__sort-btn" +
        (active ? " tree_accordion-dense__sort-btn--active" : "")
      }
      aria-label={ariaLabel}
      title={
        active
          ? dir === "asc"
            ? "Sorted ascending — click to reverse"
            : "Sorted descending — click to reverse"
          : "Sort"
      }
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {!active && <MdUnfoldMore size={16} />}
      {active && dir === "asc" && <MdExpandLess size={16} />}
      {active && dir === "desc" && <MdExpandMore size={16} />}
    </button>
  );
}

// ─── Column resize ────────────────────────────────────────────────────────────

// Most columns are FIXED at a content-appropriate pixel width; the column
// declared with width: null is the FLEX column that absorbs leftover space.
// This matches Rally's `flex` config — one greedy column, the rest fixed.
function fitToContainer(
  fixed: Array<number | null>,
  mins: number[],
  totalPx: number,
): number[] {
  const n = fixed.length;
  const result = new Array<number>(n);
  let consumed = 0;
  let flexIdx = -1;
  for (let i = 0; i < n; i++) {
    if (fixed[i] === null) {
      flexIdx = i;
      continue;
    }
    result[i] = fixed[i] as number;
    consumed += result[i];
  }
  if (flexIdx >= 0) {
    result[flexIdx] = Math.max(mins[flexIdx], totalPx - consumed);
  }
  return result;
}

function useColumnResize(
  fixedWidths: Array<number | null>,
  minWidthsArr: number[],
  tableRef: React.RefObject<HTMLTableElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [widths, setWidths] = useState<number[]>(() =>
    fitToContainer(fixedWidths, minWidthsArr, 1000),
  );
  const minWidths = useRef<number[]>(minWidthsArr);
  const fixedRef = useRef<Array<number | null>>(fixedWidths);
  // Keep refs in sync if the column config changes.
  useEffect(() => {
    minWidths.current = minWidthsArr;
    fixedRef.current = fixedWidths;
  }, [minWidthsArr, fixedWidths]);

  // Measure container on mount + on resize. Fixed columns stay at their
  // declared widths; the flex column absorbs the remainder.
  useEffect(() => {
    const fit = () => {
      const c = containerRef.current;
      if (!c) return;
      const w = c.clientWidth;
      if (w <= 0) return;
      setWidths(fitToContainer(fixedRef.current, minWidths.current, w));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef]);

  // Drag model: column[i]'s right edge tracks the mouse. The immediate next
  // neighbour absorbs the change first; when pinned at min, the remainder
  // spills into the flex column. Total table width stays constant.
  const startResize = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      const table = tableRef.current;
      if (!table) return;
      const cols = Array.from(
        table.querySelectorAll<HTMLElement>("colgroup col"),
      );
      if (colIndex >= cols.length - 1) return;

      const fixed = fixedRef.current;
      const flexIdx = fixed.findIndex((v) => v === null);
      const nextIdx = colIndex + 1;
      const useFlex = flexIdx >= 0 && flexIdx !== colIndex && flexIdx !== nextIdx;

      const startX = e.clientX;
      const startThis = parseInt(cols[colIndex]?.style.width || "0", 10) || 80;
      const startNext = parseInt(cols[nextIdx]?.style.width || "0", 10) || 80;
      const startFlex = useFlex
        ? parseInt(cols[flexIdx]?.style.width || "0", 10) || 80
        : 0;
      const minThis = minWidths.current[colIndex] ?? 40;
      const minNext = minWidths.current[nextIdx] ?? 40;
      const minFlex = useFlex ? minWidths.current[flexIdx] ?? 40 : 0;

      const thisSlack = Math.max(0, startThis - minThis);
      const neighborSlack = Math.max(0, startNext - minNext);
      const flexSlack = useFlex ? Math.max(0, startFlex - minFlex) : 0;

      const onMove = (mv: MouseEvent) => {
        let delta = mv.clientX - startX;
        delta = Math.max(delta, -(thisSlack + flexSlack));
        delta = Math.min(delta, neighborSlack + flexSlack);

        let thisChange = delta;
        let nextChange = 0;
        let flexChange = 0;
        if (delta > 0) {
          const fromNeighbor = Math.min(delta, neighborSlack);
          nextChange = -fromNeighbor;
          flexChange = -(delta - fromNeighbor);
        } else if (delta < 0) {
          const wantedShrink = -delta;
          nextChange = wantedShrink;
          if (wantedShrink > thisSlack) {
            thisChange = -thisSlack;
            flexChange = -(wantedShrink - thisSlack);
          }
        }

        if (cols[colIndex])
          cols[colIndex].style.width = startThis + thisChange + "px";
        if (cols[nextIdx])
          cols[nextIdx].style.width = startNext + nextChange + "px";
        if (useFlex && flexChange !== 0 && cols[flexIdx]) {
          cols[flexIdx].style.width = startFlex + flexChange + "px";
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const final = cols.map(
          (c) => parseInt(c.style.width || "0", 10) || 80,
        );
        setWidths(final);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [tableRef],
  );

  // Double-click reset: snap a column back to its declared default. The flex
  // column refits the whole layout instead of resetting itself.
  const resetColumn = useCallback(
    (colIndex: number) => {
      setWidths((prev) => {
        const fixed = fixedRef.current;
        const target = fixed[colIndex];
        const flexIdx = fixed.findIndex((v) => v === null);
        if (target === null) {
          const c = containerRef.current;
          const w = c?.clientWidth ?? prev.reduce((s, x) => s + x, 0);
          return fitToContainer(fixed, minWidths.current, w);
        }
        const next = [...prev];
        const delta = target - next[colIndex];
        next[colIndex] = target;
        if (flexIdx >= 0 && flexIdx !== colIndex) {
          next[flexIdx] = Math.max(
            minWidths.current[flexIdx] ?? 0,
            next[flexIdx] - delta,
          );
        }
        return next;
      });
    },
    [containerRef],
  );

  return { widths, startResize, resetColumn };
}

// ─── Resize handle ────────────────────────────────────────────────────────────

function ResizeHandle({
  colIndex,
  onStart,
}: {
  colIndex: number;
  onStart: (colIndex: number, e: React.MouseEvent) => void;
}) {
  return (
    <span
      className="tree_accordion-dense__resize-handle"
      onMouseDown={(e) => onStart(colIndex, e)}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-hidden="true"
    />
  );
}

// ─── Tree-line geometry ───────────────────────────────────────────────────────

// STEP = horizontal width per depth level (px).
// ROW_H must match `.tree_accordion-dense__row` height in CSS (28px).
// CARET_OFFSET centres the elbow's vertical drop under the parent caret.
const DEFAULT_STEP = 20;
const DEFAULT_ROW_H = 28;
const CARET_OFFSET = 8;

function TreeLines({
  depth,
  isLast,
  hasVisibleChildren,
  continuations,
  step,
  rowH,
}: {
  depth: number;
  isLast: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
  step: number;
  rowH: number;
}) {
  if (depth === 0) return null;
  const H = rowH;
  const MID = H / 2;
  const W = depth * step;
  const lineX = (depth - 1) * step + CARET_OFFSET;
  const childLineX = depth * step + CARET_OFFSET;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  // Ancestor pass-throughs: every level above our parent that still has
  // siblings below this subtree gets a full-height vertical line.
  const ancestors = continuations.slice(0, -1);
  ancestors.forEach((cont, i) => {
    if (cont) {
      const x = i * step + CARET_OFFSET;
      throughPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  // Own connector. A last-sibling with no visible children is a clean elbow.
  // Otherwise it's a T (├) so the parent's vertical continues through.
  const renderAsLast = isLast && !hasVisibleChildren;
  if (renderAsLast) {
    paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
  } else {
    paths.push(`M${lineX} 0 L${lineX} ${H}`);
    paths.push(`M${lineX} ${MID} L${W} ${MID}`);
    if (hasVisibleChildren) {
      paths.push(`M${childLineX} ${MID + 6} L${childLineX} ${H}`);
    }
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="tree_accordion-dense__svg"
      aria-hidden="true"
    >
      {throughPaths.map((d, i) => (
        <path
          key={`t${i}`}
          d={d}
          stroke="var(--border)"
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {paths.map((d, i) => (
        <path
          key={`c${i}`}
          d={d}
          stroke="var(--border)"
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

// Re-exported so concrete trees that need to align indentation in Loading row
// can compute the same offset (`12 + depth * indentStep + 32`).
export const TREE_LINE_STEP = DEFAULT_STEP;

// ─── Expander button ──────────────────────────────────────────────────────────

function ExpanderButton({
  expanded,
  hasChildren,
  onToggle,
}: {
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={
        "tree_accordion-dense__expander" +
        (expanded ? " tree_accordion-dense__expander--open" : "") +
        (!hasChildren ? " tree_accordion-dense__expander--leaf" : "")
      }
      aria-label={expanded ? "Collapse" : "Expand"}
      onClick={(e) => {
        e.stopPropagation();
        if (hasChildren) onToggle();
      }}
      tabIndex={hasChildren ? 0 : -1}
    >
      <MdOutlineArrowForwardIos
        size={10}
        className="tree_accordion-dense__expander-icon"
      />
    </button>
  );
}

// Public helpers exposed to column renderers — concrete trees use these in the
// primary column to draw the tree lines + expander caret slot consistently.
export function PrimaryCellTreeLines(props: {
  depth: number;
  isLast: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
  step?: number;
  rowH?: number;
}) {
  return (
    <TreeLines
      depth={props.depth}
      isLast={props.isLast}
      hasVisibleChildren={props.hasVisibleChildren}
      continuations={props.continuations}
      step={props.step ?? DEFAULT_STEP}
      rowH={props.rowH ?? DEFAULT_ROW_H}
    />
  );
}

export function PrimaryCellExpander(props: {
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
}) {
  return (
    <ExpanderButton
      expanded={props.expanded}
      hasChildren={props.hasChildren}
      onToggle={props.onToggle}
    />
  );
}

// ─── ResourceTree ─────────────────────────────────────────────────────────────

export function ResourceTree<T>({
  // Data
  roots,
  total,
  getId,
  getParentId,
  getChildrenCount,
  fetchChildren,
  // Scaffold
  columns,
  rowHeight = DEFAULT_ROW_H,
  indentStep = DEFAULT_STEP,
  // Features
  pagination,
  search,
  sort,
  expandAllConcurrency = 6,
  // Tone (reserved; not consumed in v1 internals — column renderers handle it)
  // (cogMenu / patch / tone are accepted to keep the surface contract; column
  // renderers consume them via closures.)
  // Selection
  selectedId = null,
  onSelect,
  // Pagination control
  pageIndex = 0,
  onPageIndexChange,
  onPageSizeChange,
  // Loading
  loading = false,
  // Filter chips
  filterChips,
  // a11y
  ariaLabel,
}: ResourceTreeProps<T>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childMap, setChildMap] = useState<Record<string, T[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Column resize ────────────────────────────────────────────────────────
  const fixedWidths = useMemo<Array<number | null>>(
    () => columns.map((c) => (c.width === undefined ? 100 : c.width)),
    [columns],
  );
  const minWidthsArr = useMemo<number[]>(
    () => columns.map((c) => c.minWidth ?? 40),
    [columns],
  );

  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { widths, startResize, resetColumn } = useColumnResize(
    fixedWidths,
    minWidthsArr,
    tableRef,
    scrollRef,
  );

  // ── Expand / collapse ────────────────────────────────────────────────────

  const toggle = useCallback(
    async (item: T) => {
      const id = getId(item);
      if (expanded.has(id)) {
        setExpanded((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
        return;
      }
      if (!childMap[id]) {
        setLoadingId(id);
        try {
          const items = await fetchChildren(id);
          setChildMap((prev) => ({ ...prev, [id]: items }));
        } finally {
          setLoadingId(null);
        }
      }
      setExpanded((prev) => new Set(prev).add(id));
    },
    [expanded, childMap, getId, fetchChildren],
  );

  // Expand every level: walk roots → fetch unloaded children → recurse until
  // no expandable rows remain. Each level is one round trip; concurrency-bounded.
  const expandAll = useCallback(async () => {
    const currentMap: Record<string, T[]> = { ...childMap };
    const allExpandable = new Set<string>();

    const collectUnfetched = (rows: T[]): T[] => {
      const unfetched: T[] = [];
      for (const it of rows) {
        const id = getId(it);
        if (
          getChildrenCount(it) > 0 ||
          (currentMap[id] ?? []).length > 0
        ) {
          allExpandable.add(id);
          if (!currentMap[id]) {
            unfetched.push(it);
          } else {
            unfetched.push(...collectUnfetched(currentMap[id]));
          }
        }
      }
      return unfetched;
    };

    const fetchInPool = async (
      items: T[],
    ): Promise<{ id: string; children: T[] }[]> => {
      const out: { id: string; children: T[] }[] = new Array(items.length);
      let next = 0;
      const workers = Array.from(
        { length: Math.min(expandAllConcurrency, items.length) },
        async () => {
          while (true) {
            const i = next++;
            if (i >= items.length) return;
            const it = items[i];
            const id = getId(it);
            const children = await fetchChildren(id);
            out[i] = { id, children };
          }
        },
      );
      await Promise.all(workers);
      return out;
    };

    let toFetch = collectUnfetched(roots);
    while (toFetch.length > 0) {
      const results = await fetchInPool(toFetch);
      for (const { id, children } of results) {
        currentMap[id] = children;
        for (const c of children) {
          if (getChildrenCount(c) > 0) allExpandable.add(getId(c));
        }
      }
      toFetch = results.flatMap(({ children }) =>
        children.filter(
          (c) => getChildrenCount(c) > 0 && !currentMap[getId(c)],
        ),
      );
    }
    setChildMap(currentMap);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of allExpandable) next.add(id);
      return next;
    });
  }, [
    roots,
    childMap,
    getId,
    getChildrenCount,
    fetchChildren,
    expandAllConcurrency,
  ]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // ── Sort header click ────────────────────────────────────────────────────

  // Two-state toggle on the active column: asc ↔ desc. Switching to a different
  // column resets to asc on the new column. To clear, click another column.
  const handleSortClick = useCallback(
    (col: string) => {
      if (!sort) return;
      if (sort.key !== col) {
        sort.onChange(col, "asc");
      } else {
        sort.onChange(col, sort.dir === "asc" ? "desc" : "asc");
      }
    },
    [sort],
  );

  // ── Filter / sort the loaded window ──────────────────────────────────────

  // Defensive identity in case the server ever includes children in `roots`.
  const rootsOnly = useMemo(
    () => roots.filter((r) => !getParentId(r)),
    [roots, getParentId],
  );

  const filteredRoots = useMemo(() => {
    if (!search) return rootsOnly;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rootsOnly;
    return rootsOnly.filter((r) => search.accessor(r).toLowerCase().includes(q));
  }, [rootsOnly, search, searchQuery]);

  // Quick filter operates on the loaded window only — sorting is server-driven
  // (caller provides ORDER BY in fetchChildren / roots); local sort is omitted
  // in the generic primitive so consumers don't accidentally double-sort.
  const visibleRoots = filteredRoots;

  // ── Pagination math ──────────────────────────────────────────────────────

  const pageSize = pagination?.pageSize ?? "all";
  const pageCount =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRoots = visibleRoots;

  // Total visible count (incl. expanded children) for the "N items" indicator.
  const visibleCount = useMemo(() => {
    let n = 0;
    const walk = (rows: T[]) => {
      for (const r of rows) {
        n += 1;
        if (expanded.has(getId(r))) {
          const kids = childMap[getId(r)] ?? [];
          if (kids.length) walk(kids);
        }
      }
    };
    walk(pagedRoots);
    return n;
  }, [pagedRoots, expanded, childMap, getId]);

  // ── Row rendering ────────────────────────────────────────────────────────

  function renderRows(
    rows: T[],
    depth: number,
    ancestorContinuations: boolean[] = [],
  ): React.ReactNode {
    return rows.map((item, idx) => {
      const id = getId(item);
      const children = childMap[id] ?? [];
      const isExpanded = expanded.has(id);
      const mightHaveChildren =
        getChildrenCount(item) > 0 || children.length > 0;
      const isLast = idx === rows.length - 1;
      const hasVisibleChildren = isExpanded && children.length > 0;
      // continuations passed to this row = ancestors + (this row continues)
      const ownContinuations = [...ancestorContinuations, !isLast];
      const ctx: RenderCtx<T> = {
        row: item,
        depth,
        expanded: isExpanded,
        hasChildren: mightHaveChildren,
        isLast,
        hasVisibleChildren,
        continuations: ancestorContinuations,
        toggle: () => void toggle(item),
      };

      return (
        <React.Fragment key={id}>
          <tr
            className={
              "tree_accordion-dense__row" +
              (depth === 0
                ? " tree_accordion-dense__row--epic"
                : " tree_accordion-dense__row--child") +
              (selectedId === id
                ? " tree_accordion-dense__row--selected"
                : "")
            }
            onClick={() => onSelect?.(item)}
          >
            {columns.map((col) => {
              const cellClass =
                "tree_accordion-dense__cell" +
                (col.align === "mono"
                  ? " tree_accordion-dense__cell--mono"
                  : "") +
                (col.cellModifier
                  ? ` tree_accordion-dense__cell--${col.cellModifier}`
                  : "");
              return (
                <td
                  key={col.key}
                  className={cellClass}
                  onClick={
                    col.stopClick
                      ? (e) => e.stopPropagation()
                      : undefined
                  }
                >
                  {col.render(item, ctx)}
                </td>
              );
            })}
          </tr>
          {loadingId === id && (
            <tr>
              <td
                className="tree_accordion-dense__cell"
                colSpan={columns.length}
                style={{
                  paddingLeft: 12 + depth * indentStep + 32,
                  color: "var(--ink-subtle)",
                }}
              >
                Loading…
              </td>
            </tr>
          )}
          {hasVisibleChildren &&
            renderRows(children, depth + 1, ownContinuations)}
        </React.Fragment>
      );
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // Suppress unused-prop warnings for surface-only props (rowHeight is read
  // by rowH default below; rowHeight itself unused beyond that on purpose).
  void rowHeight;

  return (
    <div>
      <div className="tree_accordion-dense__filterbar" role="search">
        {search && (
          <div className="tree_accordion-dense__filterbar-search">
            <span
              className="tree_accordion-dense__filterbar-search-icon"
              aria-hidden="true"
            >
              <MdSearch size={12} />
            </span>
            <input
              type="search"
              className="tree_accordion-dense__filterbar-search-input"
              placeholder={search.placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={search.placeholder}
            />
          </div>
        )}
        {filterChips}
        <span className="tree_accordion-dense__filterbar-spacer" />
        <span className="tree_accordion-dense__filterbar-count">
          {visibleCount} items
        </span>
      </div>

      {pagination && (
        <Pagination
          totalRoots={total}
          pageSize={pageSize}
          pageIndex={safePageIndex}
          pageCount={pageCount}
          options={pagination.options}
          onPageChange={(n) => onPageIndexChange?.(n)}
          onPageSizeChange={(next) => {
            onPageSizeChange?.(next);
            onPageIndexChange?.(0);
          }}
          position="top"
        />
      )}

      <div ref={scrollRef} className="tree_accordion-dense__scroll">
        <table
          ref={tableRef}
          className="tree_accordion-dense__table tree_accordion-dense__table--resizable tree_accordion-dense__table--fixed"
          style={{ tableLayout: "fixed", width: "100%" }}
          aria-label={ariaLabel}
        >
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="tree_accordion-dense__head">
            <tr>
              {columns.map((col, ci) => {
                const thClass =
                  "tree_accordion-dense__th" +
                  (col.align === "mono"
                    ? " tree_accordion-dense__th--mono"
                    : "");
                const sortActive = sort?.key === col.key;
                const sortDir = sort?.dir ?? "asc";
                if (ci === 0) {
                  return (
                    <th
                      key={col.key}
                      className={thClass}
                      onDoubleClick={() => resetColumn(0)}
                      title="Double-click to reset column width"
                    >
                      <span className="tree_accordion-dense__th-id">
                        {expanded.size > 0 ? (
                          <button
                            type="button"
                            className="tree_accordion-dense__th-toggle"
                            aria-label="Collapse all"
                            title="Collapse all"
                            onClick={collapseAll}
                          >
                            <BsArrowsCollapse size={10} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="tree_accordion-dense__th-toggle"
                            aria-label="Expand all"
                            title="Expand all"
                            onClick={() => {
                              void expandAll();
                            }}
                          >
                            <BsArrowsExpand size={10} />
                          </button>
                        )}
                        {col.label}
                        {sort && (
                          <SortIcon
                            active={sortActive}
                            dir={sortDir}
                            onClick={() => handleSortClick(col.key)}
                            ariaLabel={
                              sortActive
                                ? sortDir === "asc"
                                  ? "Sorted ascending"
                                  : "Sorted descending"
                                : "Sort"
                            }
                          />
                        )}
                      </span>
                    </th>
                  );
                }
                return (
                  <th
                    key={col.key}
                    className={thClass}
                    onDoubleClick={() => resetColumn(ci)}
                    title="Double-click to reset column width"
                  >
                    <ResizeHandle colIndex={ci - 1} onStart={startResize} />
                    <span className="tree_accordion-dense__th-sortable">
                      {col.label}
                      {sort && (
                        <SortIcon
                          active={sortActive}
                          dir={sortDir}
                          onClick={() => handleSortClick(col.key)}
                          ariaLabel={
                            sortActive
                              ? sortDir === "asc"
                                ? "Sorted ascending"
                                : "Sorted descending"
                              : "Sort"
                          }
                        />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{renderRows(pagedRoots, 0)}</tbody>
        </table>
      </div>

      {pagination && (
        <Pagination
          totalRoots={total}
          pageSize={pageSize}
          pageIndex={safePageIndex}
          pageCount={pageCount}
          options={pagination.options}
          onPageChange={(n) => onPageIndexChange?.(n)}
          onPageSizeChange={(next) => {
            onPageSizeChange?.(next);
            onPageIndexChange?.(0);
          }}
          position="bottom"
        />
      )}

      {loading && visibleRoots.length === 0 && (
        <div className="placeholder">
          <p className="placeholder__body">Loading…</p>
        </div>
      )}
      {!loading && visibleRoots.length === 0 && (
        <div className="placeholder">
          <p className="placeholder__body">
            No work items match the current filters.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  totalRoots,
  pageSize,
  pageIndex,
  pageCount,
  options,
  onPageChange,
  onPageSizeChange,
  position,
}: {
  totalRoots: number;
  pageSize: number | "all";
  pageIndex: number;
  pageCount: number;
  options: number[];
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number | "all") => void;
  position: "top" | "bottom";
}) {
  // "View all" loads everything (chunked) — single page, no prev/next needed.
  const effSize =
    pageSize === "all" ? Math.max(totalRoots, 1) : pageSize;

  // Page-button window: show first, last, current ±1, with ellipses elsewhere.
  const pages: (number | "…")[] = [];
  if (pageCount > 1) {
    const window = new Set<number>([
      0,
      pageCount - 1,
      pageIndex - 1,
      pageIndex,
      pageIndex + 1,
    ]);
    const sorted = [...window]
      .filter((n) => n >= 0 && n < pageCount)
      .sort((a, b) => a - b);
    let prev = -1;
    for (const n of sorted) {
      if (prev >= 0 && n - prev > 1) pages.push("…");
      pages.push(n);
      prev = n;
    }
  }

  const sizeOptions: { value: number | "all"; label: string }[] = options.map(
    (v) => ({ value: v, label: String(v) }),
  );

  const start = totalRoots === 0 ? 0 : pageIndex * effSize + 1;
  const end = Math.min(totalRoots, (pageIndex + 1) * effSize);

  return (
    <div
      className={`tree_accordion-dense__pagination tree_accordion-dense__pagination--${position}`}
      role="navigation"
      aria-label="Pagination"
    >
      <span className="tree_accordion-dense__pagination-info">
        {totalRoots === 0
          ? "0 rows"
          : `${start.toLocaleString()}–${end.toLocaleString()} of ${totalRoots.toLocaleString()}`}
      </span>

      <div
        className="tree_accordion-dense__pagination-pagesize"
        role="group"
        aria-label="Rows per page"
      >
        {sizeOptions.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className={
              "tree_accordion-dense__pagination-pagesize-btn" +
              (opt.value === pageSize
                ? " tree_accordion-dense__pagination-pagesize-btn--active"
                : "")
            }
            onClick={() => onPageSizeChange(opt.value)}
            aria-pressed={opt.value === pageSize}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {pages.length > 0 && (
        <div
          className="tree_accordion-dense__pagination-pager"
          role="group"
          aria-label="Pages"
        >
          <button
            type="button"
            className="tree_accordion-dense__pagination-btn"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          {pages.map((p, i) =>
            p === "…" ? (
              <span
                key={`e${i}`}
                className="tree_accordion-dense__pagination-ellipsis"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={
                  "tree_accordion-dense__pagination-btn" +
                  (p === pageIndex
                    ? " tree_accordion-dense__pagination-btn--active"
                    : "")
                }
                onClick={() => onPageChange(p)}
                aria-current={p === pageIndex ? "page" : undefined}
                aria-label={`Page ${p + 1}`}
              >
                {p + 1}
              </button>
            ),
          )}
          <button
            type="button"
            className="tree_accordion-dense__pagination-btn"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
