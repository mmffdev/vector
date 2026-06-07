"use client";

// useSweepSelect — imperative DOM sweep for the sprint boundary. The gesture is
// pure DOM: pointerdown snapshots the rows + their midpoints ONCE; pointermove
// toggles a .swept class via classList (NO React state → NO re-render of the
// 100+ row grid); pointerup collects the swept uuids and commits once. Only two
// React renders happen per gesture (dragging true/false). This replaces the old
// per-move-setState divider that re-rendered the whole grid on every pixel and
// "checked each artefact" as you passed it.

import { useCallback, useRef, useState } from "react";

export interface SweepResult {
  direction: "add" | "remove";
  uuids: string[];
}

interface RowSnap {
  el: HTMLElement;
  uuid: string;
  section: "sprint" | "backlog";
  mid: number;
}

export interface UseSweepSelectArgs {
  containerRef: { current: HTMLElement | null };
  counterRef: { current: HTMLElement | null };
  onCommit: (result: SweepResult) => void;
}

export interface UseSweepSelectResult {
  dragging: boolean;
  handlePointerProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

const ADD = "grid__SprintBoundary_Row-sweptAdd";
const REMOVE = "grid__SprintBoundary_Row-sweptRemove";

export function useSweepSelect({
  containerRef,
  counterRef,
  onCommit,
}: UseSweepSelectArgs): UseSweepSelectResult {
  const [dragging, setDragging] = useState(false);
  const snapRef = useRef<RowSnap[]>([]);
  const originRef = useRef(0);
  const sweptRef = useRef<SweepResult>({ direction: "add", uuids: [] });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const container = containerRef.current;
      if (!container) return;
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>("[data-sweep-row]"),
      );
      snapRef.current = rows.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          uuid: el.getAttribute("data-sweep-uuid") ?? "",
          section:
            (el.getAttribute("data-sweep-section") as "sprint" | "backlog") ??
            "backlog",
          mid: r.top + r.height / 2,
        };
      });
      originRef.current = e.clientY;
      sweptRef.current = { direction: "add", uuids: [] };
      setDragging(true);
    },
    [containerRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const snap = snapRef.current;
      if (snap.length === 0) return;
      const y = e.clientY;
      const goingDown = y >= originRef.current;
      const direction: "add" | "remove" = goingDown ? "add" : "remove";
      const uuids: string[] = [];
      for (const row of snap) {
        let swept = false;
        if (goingDown) {
          swept =
            row.section === "backlog" &&
            row.mid > originRef.current &&
            row.mid <= y;
          row.el.classList.toggle(ADD, swept);
          row.el.classList.remove(REMOVE);
        } else {
          swept =
            row.section === "sprint" &&
            row.mid < originRef.current &&
            row.mid >= y;
          row.el.classList.toggle(REMOVE, swept);
          row.el.classList.remove(ADD);
        }
        if (swept) uuids.push(row.uuid);
      }
      sweptRef.current = { direction, uuids };
      if (counterRef.current) {
        counterRef.current.textContent =
          uuids.length === 0
            ? ""
            : `${uuids.length} to ${direction === "add" ? "add" : "remove"}`;
      }
    },
    [counterRef],
  );

  const clearClasses = useCallback(() => {
    for (const row of snapRef.current) {
      row.el.classList.remove(ADD, REMOVE);
    }
    if (counterRef.current) counterRef.current.textContent = "";
  }, [counterRef]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      const result = sweptRef.current;
      clearClasses();
      snapRef.current = [];
      setDragging(false);
      if (result.uuids.length > 0) onCommit(result);
    },
    [clearClasses, onCommit],
  );

  return {
    dragging,
    handlePointerProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
