// app/components/Grid/Grid__SprintBoundary_Divider.tsx
"use client";

// Grid__SprintBoundary_Divider — the draggable sprint-commitment line.
//
// Subtle at rest (a thin rule + grip on hover), blooms while dragging (the
// glowing frontier + live counter). Pointer-only; it reports pointer-move
// deltas in px to the parent, which converts them to a boundary row index. The
// parent owns the count it shows back here (inSprintCount / total).

import { useCallback, useRef } from "react";

export interface GridSprintBoundaryDividerProps {
  inSprintCount: number;
  total: number;
  dragging: boolean;
  /** Pointer went down on the grip — parent begins a drag session. */
  onDragStart: (clientY: number) => void;
  /** Pointer moved during a drag — absolute clientY. */
  onDragMove: (clientY: number) => void;
  /** Pointer released — parent commits the delta. */
  onDragEnd: () => void;
}

export function GridSprintBoundaryDivider({
  inSprintCount,
  total,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
}: GridSprintBoundaryDividerProps) {
  const activeRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Capture on currentTarget (the divider div this handler is bound to),
      // NOT e.target — pressing the grip/counter <span> makes e.target a CHILD,
      // and the browser releases implicit pointer capture the moment that child
      // is reconciled/re-inserted as the divider moves between row positions
      // during the drag. That dropped capture after the first row-cross, so the
      // sweep died at one row. The divider div carries the stable key
      // ("__divider__") and is the element that owns the pointer handlers, so
      // capturing it keeps every subsequent pointermove flowing to the drag.
      e.currentTarget.setPointerCapture(e.pointerId);
      activeRef.current = true;
      onDragStart(e.clientY);
    },
    [onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activeRef.current) return;
      onDragMove(e.clientY);
    },
    [onDragMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      // Release on currentTarget to match the capture target set on pointerdown.
      e.currentTarget.releasePointerCapture(e.pointerId);
      onDragEnd();
    },
    [onDragEnd],
  );

  return (
    <div
      className={`grid__SprintBoundary_Divider${dragging ? " grid__SprintBoundary_Divider-dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Sprint commitment line — ${inSprintCount} of ${total} in sprint. Drag to adjust.`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <span className="grid__SprintBoundary_Divider_Grip" aria-hidden>
        ⇕
      </span>
      <span className="grid__SprintBoundary_Divider_Count">
        {inSprintCount} of {total} in sprint
      </span>
    </div>
  );
}
