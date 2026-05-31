"use client";

// useColumnManager — owns column widths + sort for the Grid skin.
//
// Lifted verbatim from app/components/DataGrid/useColumnManager.ts (the
// battle-tested OTV1/OTV2 implementation), retyped from DataGridColumn to the
// primitive's GridColumn. ZERO tree coupling — widths + sort + resize only.
//
//   • Widths are an indexed numeric array, fitted to container width. Fixed
//     columns hold their declared px width; the single flex column
//     (defaultWidth === null) absorbs leftover space.
//   • A ResizeObserver re-fits on container resize.
//   • Drag model: column[i]'s right-edge tracks the mouse; delta is absorbed
//     by the neighbour first, then spills into the flex column. Total width
//     stays constant. During drag we mutate gridTemplateColumns on the header
//     + body rows directly via refs (no 60fps React re-render); commit on up.
//   • Double-click a resize handle → reset to declared default; delta refunded
//     to flex.
//   • Sort cycle: header click → none → asc → desc → none.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridColumn, SortDir, SortState } from "./types";

const MIN_FIXED_WIDTH = 60;
const MIN_FLEX_WIDTH = 260;

export interface UseColumnManagerArgs<TRow> {
  columns: GridColumn<TRow>[];
  defaultSort?: SortState | null;
  /**
   * Fixed-width leading control columns (stripe / selection / drag / caret)
   * rendered BEFORE the user columns. Their widths prepend to
   * gridTemplateColumns so the CSS grid reserves real tracks for each
   * control. They never sort or resize; the resize maths offsets user-column
   * indices by leadWidths.length so dragging still targets the right track.
   */
  leadWidths?: number[];
}

export interface HeaderProps {
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  "data-sort": SortDir | undefined;
  "data-resizable": boolean;
  "data-sortable": boolean;
  style: React.CSSProperties;
}

export interface UseColumnManagerReturn {
  gridTemplateColumns: string;
  sort: SortState | null;
  getHeaderProps: (col: GridColumn<any>) => HeaderProps;
  containerRef: (el: HTMLDivElement | null) => void;
  headerRowRef: (el: HTMLDivElement | null) => void;
  registerBodyRow: (rowId: string, el: HTMLDivElement | null) => void;
}

function fitToContainer(
  defaults: Array<number | null>,
  totalPx: number,
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

export function useColumnManager<TRow>(
  args: UseColumnManagerArgs<TRow>,
): UseColumnManagerReturn {
  const { columns, defaultSort } = args;

  const leadWidths = useMemo(() => args.leadWidths ?? [], [args.leadWidths]);
  const leadWidthsRef = useRef<number[]>(leadWidths);
  useEffect(() => {
    leadWidthsRef.current = leadWidths;
  }, [leadWidths]);

  const defaultsRef = useRef<Array<number | null>>(
    columns.map((c) => c.defaultWidth),
  );
  const flexIdxRef = useRef<number>(
    columns.findIndex((c) => c.defaultWidth === null),
  );
  useEffect(() => {
    defaultsRef.current = columns.map((c) => c.defaultWidth);
    flexIdxRef.current = columns.findIndex((c) => c.defaultWidth === null);
  }, [columns]);

  const containerEl = useRef<HTMLDivElement | null>(null);
  const headerEl = useRef<HTMLDivElement | null>(null);
  const bodyRowsEl = useRef<Map<string, HTMLDivElement>>(new Map());

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerEl.current = el;
  }, []);
  const headerRowRef = useCallback((el: HTMLDivElement | null) => {
    headerEl.current = el;
  }, []);
  const registerBodyRow = useCallback(
    (rowId: string, el: HTMLDivElement | null) => {
      if (el) bodyRowsEl.current.set(rowId, el);
      else bodyRowsEl.current.delete(rowId);
    },
    [],
  );

  const [widths, setWidths] = useState<number[]>(() =>
    fitToContainer(defaultsRef.current, 1000),
  );

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

  useEffect(() => {
    const c = containerEl.current;
    const w = c ? c.clientWidth : 1000;
    setWidths(fitToContainer(defaultsRef.current, w > 0 ? w : 1000));
  }, [columns]);

  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);

  const toggleSort = useCallback((col: GridColumn<TRow>) => {
    if (!col.sortable) return;
    setSort((cur) => {
      if (!cur || cur.columnId !== col.id)
        return { columnId: col.id, dir: "asc" };
      if (cur.dir === "asc") return { columnId: col.id, dir: "desc" };
      return null;
    });
  }, []);

  const applyToDom = useCallback((next: number[]) => {
    const tpl = joinTemplate([...leadWidthsRef.current, ...next]);
    if (headerEl.current) headerEl.current.style.gridTemplateColumns = tpl;
    bodyRowsEl.current.forEach((el) => {
      el.style.gridTemplateColumns = tpl;
    });
  }, []);

  const startResize = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startW = widths.slice();
      const defaults = defaultsRef.current;
      const flexIdx = flexIdxRef.current;
      const nextIdx = colIndex + 1;

      if (nextIdx >= startW.length) return;

      const useFlex =
        flexIdx >= 0 && flexIdx !== colIndex && flexIdx !== nextIdx;
      const minThis = defaults[colIndex] === null ? MIN_FLEX_WIDTH : MIN_FIXED_WIDTH;
      const minNext = defaults[nextIdx] === null ? MIN_FLEX_WIDTH : MIN_FIXED_WIDTH;
      const minFlex = useFlex ? MIN_FLEX_WIDTH : 0;
      const startX = e.clientX;
      const startThis = startW[colIndex];
      const startNext = startW[nextIdx];
      const startFlex = useFlex ? startW[flexIdx] : 0;

      const thisSlack = Math.max(0, startThis - minThis);
      const neighborSlack = Math.max(0, startNext - minNext);
      const flexSlack = useFlex ? Math.max(0, startFlex - minFlex) : 0;

      let latest = startW.slice();

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

        latest = startW.slice();
        latest[colIndex] = startThis + thisChange;
        latest[nextIdx] = startNext + nextChange;
        if (useFlex && flexChange !== 0) {
          latest[flexIdx] = startFlex + flexChange;
        }
        applyToDom(latest);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setWidths(latest);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [applyToDom, widths],
  );

  const resetColumn = useCallback((colIndex: number) => {
    setWidths((prev) => {
      const defaults = defaultsRef.current;
      const target = defaults[colIndex];
      const flexIdx = flexIdxRef.current;
      if (target === null) {
        const c = containerEl.current;
        const w = c?.clientWidth ?? prev.reduce((s, x) => s + x, 0);
        return fitToContainer(defaults, w);
      }
      const next = [...prev];
      const delta = target - next[colIndex];
      next[colIndex] = target;
      if (flexIdx >= 0 && flexIdx !== colIndex) {
        next[flexIdx] = Math.max(MIN_FLEX_WIDTH, next[flexIdx] - delta);
      }
      return next;
    });
  }, []);

  const gridTemplateColumns = useMemo(
    () => joinTemplate([...leadWidths, ...widths]),
    [leadWidths, widths],
  );

  const getHeaderProps = useCallback(
    (col: GridColumn<any>): HeaderProps => {
      const colIndex = columns.findIndex((c) => c.id === col.id);
      const resizable = !!col.resizable && col.defaultWidth !== null;
      return {
        onClick: () => toggleSort(col),
        onDoubleClick: () => {
          if (resizable) resetColumn(colIndex);
        },
        onResizeMouseDown: (e) => {
          if (resizable) startResize(colIndex, e);
        },
        "data-sort": sort?.columnId === col.id ? sort.dir : undefined,
        "data-resizable": resizable,
        "data-sortable": !!col.sortable,
        style: {},
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
