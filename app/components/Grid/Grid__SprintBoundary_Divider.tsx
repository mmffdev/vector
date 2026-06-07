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
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
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
