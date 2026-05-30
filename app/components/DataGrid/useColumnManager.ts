"use client";

// useColumnManager — owns column widths + sort for <DataGrid>.
//
// Semantics ported wholesale from ResourceTree/ObjectTree (the working
// implementation that's been battle-tested across OTV1/OTV2):
//
//   • Widths are an indexed numeric array, fitted to container width.
//     Fixed columns hold their declared px width; the single flex
//     column (defaultWidth === null) absorbs leftover space.
//   • A ResizeObserver re-fits on container resize so the flex column
//     tracks viewport changes without manual recalc.
//   • Drag model: column[i]'s right-edge tracks the mouse.
//     - Move right → take from neighbour[i+1]'s slack first, then spill
//       into the flex column (when neighbour pinned at min).
//     - Move left → give to neighbour[i+1], shrinking [i]'s width;
//       overflow spills to the flex column.
//     - Total grid width stays constant.
//   • During drag, mutate `gridTemplateColumns` on the header row + all
//     body rows directly via refs (avoids 60fps React re-renders).
//     Commit final widths to React state on mouseup.
//   • Double-click on a column's resize handle resets it to its declared
//     default; the delta is refunded to the flex column.
//   • Sort cycle: header click → none → asc → desc → none.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataGridColumn, SortDir, SortState } from "./types";

// ─── Tunables ───────────────────────────────────────────────────────────────
const MIN_FIXED_WIDTH = 60;   // minimum px for any fixed column
const MIN_FLEX_WIDTH  = 260;  // minimum px for the flex column

// ─── Args + return ──────────────────────────────────────────────────────────
export interface UseColumnManagerArgs<TRow = unknown> {
  columns: DataGridColumn<TRow>[];
  defaultSort?: SortState | null;
  /**
   * Fixed-width leading control columns (stripe / selection / drag / cog)
   * rendered BEFORE the user columns — mirrors ResourceTree's lead-column
   * block. Their widths prepend to gridTemplateColumns so the CSS grid
   * reserves real tracks (not borders/padding) for each control, exactly
   * as OTV2 does. They never sort or resize; the resize maths offsets
   * every user-column index by leadWidths.length so dragging a user
   * column still targets the right DOM track. Empty array → no lead
   * columns (flat grids), identical to before.
   */
  leadWidths?: number[];
}

export interface HeaderProps {
  onClick:           (e: React.MouseEvent) => void;
  onDoubleClick:     (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  "data-sort":       SortDir | undefined;
  "data-resizable":  boolean;
  "data-sortable":   boolean;
  style:             React.CSSProperties;
}

export interface UseColumnManagerReturn {
  /** Composed `grid-template-columns` string for header + body rows. */
  gridTemplateColumns: string;
  /** Current sort (null when no column is sorted). */
  sort: SortState | null;
  /** Props bundle for a header cell — spread onto the element. */
  getHeaderProps: (col: DataGridColumn<any>) => HeaderProps;
  /** Attach to the grid root container — used to measure available width. */
  containerRef: (el: HTMLDivElement | null) => void;
  /** Attach the header row's div — used for direct DOM mutation during drag. */
  headerRowRef: (el: HTMLDivElement | null) => void;
  /** Register each body row's div — same direct-DOM-mutation path. */
  registerBodyRow: (rowId: string, el: HTMLDivElement | null) => void;
}

// ─── fitToContainer ─────────────────────────────────────────────────────────
// Mirror of the ResourceTree helper. Fixed widths hold; the flex column
// absorbs leftover space (clamped to MIN_FLEX_WIDTH).
function fitToContainer(
  defaults: Array<number | null>,
  totalPx:  number,
): number[] {
  const n = defaults.length;
  const result = new Array<number>(n);
  let consumed = 0;
  let flexIdx = -1;
  for (let i = 0; i < n; i++) {
    if (defaults[i] === null) {
      flexIdx = i;
      continue;
    }
    result[i] = defaults[i] as number;
    consumed += result[i];
  }
  if (flexIdx >= 0) {
    result[flexIdx] = Math.max(MIN_FLEX_WIDTH, totalPx - consumed);
  }
  return result;
}

function joinTemplate(widths: number[]): string {
  return widths.map((w) => `${w}px`).join(" ");
}

// ─── The hook ───────────────────────────────────────────────────────────────
export function useColumnManager<TRow = unknown>(
  args: UseColumnManagerArgs<TRow>,
): UseColumnManagerReturn {
  const { columns, defaultSort } = args;

  // Leading control-column widths (stripe/selection/drag/cog). Kept in a
  // ref so the resize/apply closures always read the live value without
  // re-binding. The internal `widths` state holds ONLY the user columns —
  // lead widths are fixed and simply prepended at the template/DOM seam,
  // so all the fit + drag maths below is unchanged from the flat grid.
  const leadWidths = useMemo(() => args.leadWidths ?? [], [args.leadWidths]);
  const leadWidthsRef = useRef<number[]>(leadWidths);
  useEffect(() => { leadWidthsRef.current = leadWidths; }, [leadWidths]);

  // Default-width vector + flex-index lookup.
  const defaultsRef = useRef<Array<number | null>>(columns.map((c) => c.defaultWidth));
  const flexIdxRef  = useRef<number>(columns.findIndex((c) => c.defaultWidth === null));
  useEffect(() => {
    defaultsRef.current = columns.map((c) => c.defaultWidth);
    flexIdxRef.current  = columns.findIndex((c) => c.defaultWidth === null);
  }, [columns]);

  // Container + row refs for direct DOM mutation during drag.
  const containerEl  = useRef<HTMLDivElement | null>(null);
  const headerEl     = useRef<HTMLDivElement | null>(null);
  const bodyRowsEl   = useRef<Map<string, HTMLDivElement>>(new Map());

  const containerRef = useCallback((el: HTMLDivElement | null) => { containerEl.current = el; }, []);
  const headerRowRef = useCallback((el: HTMLDivElement | null) => { headerEl.current    = el; }, []);
  const registerBodyRow = useCallback((rowId: string, el: HTMLDivElement | null) => {
    if (el) bodyRowsEl.current.set(rowId, el);
    else    bodyRowsEl.current.delete(rowId);
  }, []);

  // — Widths state ——————————————————————————————————————————————————————————
  const [widths, setWidths] = useState<number[]>(() =>
    fitToContainer(defaultsRef.current, 1000),
  );

  // Re-fit on container resize.
  useEffect(() => {
    const fit = () => {
      const c = containerEl.current;
      if (!c) return;
      const w = c.clientWidth;
      if (w <= 0) return;
      setWidths(fitToContainer(defaultsRef.current, w));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (containerEl.current) ro.observe(containerEl.current);
    return () => ro.disconnect();
  }, []);

  // Re-fit when the columns config itself changes (rare — but covers
  // dynamic column toggles in a future column-picker plugin).
  useEffect(() => {
    const c = containerEl.current;
    const w = c ? c.clientWidth : 1000;
    setWidths(fitToContainer(defaultsRef.current, w > 0 ? w : 1000));
  }, [columns]);

  // — Sort state ————————————————————————————————————————————————————————————
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);

  const toggleSort = useCallback(
    (col: DataGridColumn<TRow>) => {
      if (!col.sortable) return;
      setSort((cur) => {
        if (!cur || cur.columnId !== col.id) return { columnId: col.id, dir: "asc" };
        if (cur.dir === "asc")                return { columnId: col.id, dir: "desc" };
        return null;
      });
    },
    [],
  );

  // — Drag-resize ——————————————————————————————————————————————————————————
  // Apply a width vector to every row's gridTemplateColumns. Used both
  // for live drag (no setState) and as a sanity sync post-commit.
  const applyToDom = useCallback((next: number[]) => {
    // Prepend the fixed lead widths so the live-drag template matches the
    // rendered DOM (lead cells + user cells). next holds user widths only.
    const tpl = joinTemplate([...leadWidthsRef.current, ...next]);
    if (headerEl.current) headerEl.current.style.gridTemplateColumns = tpl;
    bodyRowsEl.current.forEach((el) => { el.style.gridTemplateColumns = tpl; });
  }, []);

  const startResize = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startW    = widths.slice();
      const defaults  = defaultsRef.current;
      const flexIdx   = flexIdxRef.current;
      const nextIdx   = colIndex + 1;

      // Edge cases: last column has no neighbour to absorb from; bail.
      if (nextIdx >= startW.length) return;

      // The flex column is the spill target. If colIndex IS the flex
      // column or its immediate neighbour, no spill (just neighbour
      // absorbs the full delta — same as ResourceTree).
      const useFlex   = flexIdx >= 0 && flexIdx !== colIndex && flexIdx !== nextIdx;
      const minThis   = defaults[colIndex] === null ? MIN_FLEX_WIDTH : MIN_FIXED_WIDTH;
      const minNext   = defaults[nextIdx]  === null ? MIN_FLEX_WIDTH : MIN_FIXED_WIDTH;
      const minFlex   = useFlex ? MIN_FLEX_WIDTH : 0;
      const startX    = e.clientX;
      const startThis = startW[colIndex];
      const startNext = startW[nextIdx];
      const startFlex = useFlex ? startW[flexIdx] : 0;

      const thisSlack     = Math.max(0, startThis - minThis);
      const neighborSlack = Math.max(0, startNext - minNext);
      const flexSlack     = useFlex ? Math.max(0, startFlex - minFlex) : 0;

      // Track latest computed widths so onUp can commit them.
      let latest = startW.slice();

      const onMove = (mv: MouseEvent) => {
        let delta = mv.clientX - startX;
        // Clamp delta by the slack available on both sides.
        delta = Math.max(delta, -(thisSlack + flexSlack));
        delta = Math.min(delta,  neighborSlack + flexSlack);

        let thisChange = delta;
        let nextChange = 0;
        let flexChange = 0;

        if (delta > 0) {
          // Growing column[i] — take from neighbour first, then flex.
          const fromNeighbor = Math.min(delta, neighborSlack);
          nextChange = -fromNeighbor;
          flexChange = -(delta - fromNeighbor);
        } else if (delta < 0) {
          // Shrinking column[i] — give to neighbour; overflow to flex.
          const wantedShrink = -delta;
          nextChange = wantedShrink;
          if (wantedShrink > thisSlack) {
            thisChange = -thisSlack;
            flexChange = -(wantedShrink - thisSlack);
          }
        }

        latest = startW.slice();
        latest[colIndex] = startThis + thisChange;
        latest[nextIdx]  = startNext + nextChange;
        if (useFlex && flexChange !== 0) {
          latest[flexIdx] = startFlex + flexChange;
        }
        applyToDom(latest);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup",   onUp);
        document.body.style.cursor     = "";
        document.body.style.userSelect = "";
        setWidths(latest);
      };

      document.body.style.cursor     = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup",   onUp);
    },
    [applyToDom, widths],
  );

  // — Double-click reset ——————————————————————————————————————————————————
  const resetColumn = useCallback(
    (colIndex: number) => {
      setWidths((prev) => {
        const defaults = defaultsRef.current;
        const target   = defaults[colIndex];
        const flexIdx  = flexIdxRef.current;
        // Flex column: refit the whole layout to current container.
        if (target === null) {
          const c = containerEl.current;
          const w = c?.clientWidth ?? prev.reduce((s, x) => s + x, 0);
          return fitToContainer(defaults, w);
        }
        // Fixed column: snap to default; refund delta to flex.
        const next = [...prev];
        const delta = target - next[colIndex];
        next[colIndex] = target;
        if (flexIdx >= 0 && flexIdx !== colIndex) {
          next[flexIdx] = Math.max(MIN_FLEX_WIDTH, next[flexIdx] - delta);
        }
        return next;
      });
    },
    [],
  );

  // — Composed grid-template + header props ———————————————————————————————
  // Lead widths first (fixed control tracks), then the fitted user widths.
  const gridTemplateColumns = useMemo(
    () => joinTemplate([...leadWidths, ...widths]),
    [leadWidths, widths],
  );

  const getHeaderProps = useCallback(
    (col: DataGridColumn<any>): HeaderProps => {
      const colIndex  = columns.findIndex((c) => c.id === col.id);
      const resizable = !!col.resizable && col.defaultWidth !== null;
      return {
        onClick:           () => toggleSort(col),
        onDoubleClick:     () => { if (resizable) resetColumn(colIndex); },
        onResizeMouseDown: (e) => { if (resizable) startResize(colIndex, e); },
        "data-sort":       sort?.columnId === col.id ? sort.dir : undefined,
        "data-resizable":  resizable,
        "data-sortable":   !!col.sortable,
        style:             {},
      };
    },
    [columns, resetColumn, sort, startResize, toggleSort],
  );

  return {
    gridTemplateColumns,
    sort,
    getHeaderProps,
    containerRef,
    headerRowRef,
    registerBodyRow,
  };
}
