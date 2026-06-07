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
  /** The divider line element — moved through the grid to follow the boundary. */
  handleRef?: { current: HTMLElement | null };
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

export function useSweepSelect({
  containerRef,
  counterRef,
  handleRef,
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

      // Contiguous tint: every row above the line is "in sprint". Direct DOM.
      snap.forEach((row, i) => {
        row.el.classList.toggle(IN_SPRINT, i < boundary);
      });

      // Move the divider line to sit at the boundary, in-grid. The handle is a
      // grid child; reposition it between the boundary-th and (boundary+1)-th row.
      const container = containerRef.current;
      const handle = handleRef?.current;
      if (container && handle) {
        if (boundary >= snap.length) {
          container.appendChild(handle); // line at the very bottom
        } else {
          container.insertBefore(handle, snap[boundary].el);
        }
      }

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
    [containerRef, counterRef, handleRef],
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

      // Clear the live tint + counter (the real refetch will repaint the truth).
      for (const row of snap) row.el.classList.remove(IN_SPRINT);
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
