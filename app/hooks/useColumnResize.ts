"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Fixed column widths; null = flex column that absorbs leftover space.
type ColConfig = Array<number | null>;

function fitToContainer(fixed: ColConfig, mins: number[], totalPx: number): number[] {
  const n = fixed.length;
  const result = new Array<number>(n);
  let consumed = 0;
  let flexIdx = -1;
  for (let i = 0; i < n; i++) {
    if (fixed[i] === null) { flexIdx = i; continue; }
    result[i] = fixed[i] as number;
    consumed += result[i];
  }
  if (flexIdx >= 0) result[flexIdx] = Math.max(mins[flexIdx] ?? 40, totalPx - consumed);
  return result;
}

function load(key: string, fixed: ColConfig, mins: number[]): number[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length !== fixed.length) return null;
    return (saved as number[]).map((v, i) => Math.max(mins[i] ?? 40, Number(v) || (fixed[i] ?? 80)));
  } catch {
    return null;
  }
}

function save(key: string, widths: number[]) {
  try { localStorage.setItem(key, JSON.stringify(widths)); } catch { /* quota */ }
}

export function useColumnResize(
  fixedWidths: ColConfig,
  minWidthsArr: number[],
  tableRef: React.RefObject<HTMLTableElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  storageKey?: string,
) {
  const [widths, setWidths] = useState<number[]>(() => {
    if (storageKey) {
      const saved = load(storageKey, fixedWidths, minWidthsArr);
      if (saved) return saved;
    }
    return fitToContainer(fixedWidths, minWidthsArr, 1000);
  });

  const minWidths = useRef<number[]>(minWidthsArr);
  const fixedRef  = useRef<ColConfig>(fixedWidths);

  useEffect(() => {
    minWidths.current = minWidthsArr;
    fixedRef.current  = fixedWidths;
    const c = containerRef.current;
    const w = c ? c.clientWidth : 1000;
    // Only refit if no saved widths — otherwise honour the user's stored layout.
    if (!storageKey || !load(storageKey, fixedWidths, minWidthsArr)) {
      setWidths(fitToContainer(fixedWidths, minWidthsArr, w > 0 ? w : 1000));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWidthsArr, fixedWidths, containerRef, storageKey]);

  useEffect(() => {
    const fit = () => {
      const c = containerRef.current;
      if (!c) return;
      const w = c.clientWidth;
      if (w <= 0) return;
      // On resize, only refit if nothing is saved so user layout is preserved.
      if (!storageKey || !load(storageKey, fixedRef.current, minWidths.current)) {
        setWidths(fitToContainer(fixedRef.current, minWidths.current, w));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, storageKey]);

  const startResize = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      const table = tableRef.current;
      if (!table) return;
      const cols = Array.from(table.querySelectorAll<HTMLElement>("colgroup col"));
      if (colIndex >= cols.length - 1) return;

      const fixed    = fixedRef.current;
      const flexIdx  = fixed.findIndex((v) => v === null);
      const nextIdx  = colIndex + 1;
      const useFlex  = flexIdx >= 0 && flexIdx !== colIndex && flexIdx !== nextIdx;

      const startX    = e.clientX;
      const startThis = parseInt(cols[colIndex]?.style.width  || "0", 10) || 80;
      const startNext = parseInt(cols[nextIdx]?.style.width   || "0", 10) || 80;
      const startFlex = useFlex ? parseInt(cols[flexIdx]?.style.width || "0", 10) || 80 : 0;

      const minThis  = minWidths.current[colIndex] ?? 40;
      const minNext  = minWidths.current[nextIdx]  ?? 40;
      const minFlex  = useFlex ? minWidths.current[flexIdx] ?? 40 : 0;

      const thisSlack     = Math.max(0, startThis - minThis);
      const neighborSlack = Math.max(0, startNext - minNext);
      const flexSlack     = useFlex ? Math.max(0, startFlex - minFlex) : 0;

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

        if (cols[colIndex]) cols[colIndex].style.width = startThis + thisChange + "px";
        if (cols[nextIdx])  cols[nextIdx].style.width  = startNext + nextChange + "px";
        if (useFlex && flexChange !== 0 && cols[flexIdx]) {
          cols[flexIdx].style.width = startFlex + flexChange + "px";
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup",   onUp);
        document.body.style.cursor     = "";
        document.body.style.userSelect = "";
        const final = cols.map((c) => parseInt(c.style.width || "0", 10) || 80);
        setWidths(final);
        if (storageKey) save(storageKey, final);
      };

      document.body.style.cursor     = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup",   onUp);
    },
    [tableRef, storageKey],
  );

  const resetColumn = useCallback(
    (colIndex: number) => {
      setWidths((prev) => {
        const fixed   = fixedRef.current;
        const target  = fixed[colIndex];
        const flexIdx = fixed.findIndex((v) => v === null);
        let next: number[];
        if (target === null) {
          const c = containerRef.current;
          const w = c?.clientWidth ?? prev.reduce((s, x) => s + x, 0);
          next = fitToContainer(fixed, minWidths.current, w);
        } else {
          next = [...prev];
          const delta = target - next[colIndex];
          next[colIndex] = target;
          if (flexIdx >= 0 && flexIdx !== colIndex) {
            next[flexIdx] = Math.max(minWidths.current[flexIdx] ?? 0, next[flexIdx] - delta);
          }
        }
        if (storageKey) save(storageKey, next);
        return next;
      });
    },
    [containerRef, storageKey],
  );

  return { widths, startResize, resetColumn };
}
