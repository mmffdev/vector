"use client";

// useSweepSelect — imperative sprint-boundary line. Restores the original
// look (a divider line that moves through the rows; every row ABOVE the line
// tints contiguously as "in sprint") but drives it imperatively so it is fast
// and collects every row in one gesture:
//
//   • pointerdown snapshots the rows + their midpoints + the initial split ONCE.
//   • pointermove computes the boundary index from the pointer Y, then via direct
//     DOM (NO React state → NO re-render of the 100+ row grid): moves the divider
//     element to that index in the grid, and toggles .Row-inSprint on every row
//     above the line (contiguous block — sprint rows + any swept-in backlog rows).
//   • pointerup diffs the final boundary vs the initial split → the rows that
//     crossed → commit once.
//
// Only two React renders happen per gesture (dragging true/false). This replaces
// the old per-move-setState engine that re-rendered the whole grid on every pixel
// and "checked each artefact" as you passed it.

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

const IN_SPRINT = "grid__SprintBoundary_Row-inSprint";
// The last in-sprint row carries this → a strong bottom edge that reads as the
// commitment line. It travels via class toggling (no DOM move → capture safe).
const LINE = "grid__SprintBoundary_Row-line";

export function useSweepSelect({
  containerRef,
  counterRef,
  onCommit,
}: UseSweepSelectArgs): UseSweepSelectResult {
  const [dragging, setDragging] = useState(false);
  const snapRef = useRef<RowSnap[]>([]);
  // Initial split = number of rows in the sprint section at pointerdown (the
  // un-dragged boundary). The line starts here.
  const initialSplitRef = useRef(0);
  // Current boundary index = how many of the combined rows are above the line.
  const boundaryRef = useRef(0);

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
      const split = snapRef.current.filter((r) => r.section === "sprint").length;
      initialSplitRef.current = split;
      boundaryRef.current = split;
      setDragging(true);
    },
    [containerRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const snap = snapRef.current;
      if (snap.length === 0) return;
      const y = e.clientY;
      // Boundary index = count of rows whose midpoint is above the pointer.
      let boundary = 0;
      for (const row of snap) {
        if (row.mid <= y) boundary++;
        else break;
      }
      boundaryRef.current = boundary;

      // Paint the boundary purely via classes — NO DOM relocation of the handle.
      //   • every row above the line → IN_SPRINT (the contiguous "in sprint" tint)
      //   • the last row above the line → LINE (a strong bottom edge = the moving
      //     commitment line). The line therefore travels with the pointer as the
      //     tint extends, WITHOUT re-inserting the handle element (which would
      //     drop the pointer capture and freeze the drag after one move).
      snap.forEach((row, i) => {
        const above = i < boundary;
        row.el.classList.toggle(IN_SPRINT, above);
        row.el.classList.toggle(LINE, above && i === boundary - 1);
      });

      // Live counter: how many rows crossed vs the initial split.
      const delta = boundary - initialSplitRef.current;
      if (counterRef.current) {
        counterRef.current.textContent =
          delta === 0
            ? ""
            : delta > 0
              ? `${delta} to add`
              : `${-delta} to remove`;
      }
    },
    [counterRef],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      const snap = snapRef.current;
      const boundary = boundaryRef.current;
      const split = initialSplitRef.current;

      // Diff the final boundary vs the initial split → the rows that crossed.
      let result: SweepResult = { direction: "add", uuids: [] };
      if (boundary > split) {
        // line moved DOWN — backlog rows [split, boundary) joined the sprint
        result = {
          direction: "add",
          uuids: snap.slice(split, boundary).map((r) => r.uuid),
        };
      } else if (boundary < split) {
        // line moved UP — sprint rows [boundary, split) left the sprint
        result = {
          direction: "remove",
          uuids: snap.slice(boundary, split).map((r) => r.uuid),
        };
      }

      // Clear the live tint + line + counter (the refetch repaints the truth).
      for (const row of snap) row.el.classList.remove(IN_SPRINT, LINE);
      if (counterRef.current) counterRef.current.textContent = "";
      snapRef.current = [];
      setDragging(false);

      if (result.uuids.length > 0) onCommit(result);
    },
    [counterRef, onCommit],
  );

  return {
    dragging,
    handlePointerProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
