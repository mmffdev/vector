// app/components/Grid/useSprintBoundary.ts
"use client";

// useSprintBoundary — headless boundary state for the Grid__SprintBoundary POC.
//
// The combined list is [sprint rows…, backlog rows…]. boundaryIndex = how many
// of the combined rows sit ABOVE the divider (i.e. "in the sprint"). Initial =
// sprintIds.length. Dragging mutates boundaryIndex (UI-only); computeDelta()
// diffs the current split against the initial split to get the rows that
// crossed — the membership PATCH set committed on release.
//
// The hook is DOM-free: it takes the two id arrays and the geometry decision
// (which index a pointer-y maps to) is the caller's. This keeps the math unit-
// testable without a rendered tree.

import { useCallback, useMemo, useState } from "react";

export interface SprintBoundaryDelta {
  toSprint: string[]; // backlog rows that ended up above the line
  toBacklog: string[]; // sprint rows that ended up below the line
}

export interface UseSprintBoundaryResult {
  /** Rows above the divider (count). */
  boundaryIndex: number;
  /** Same as boundaryIndex — the "N in sprint" the divider counter shows. */
  inSprintCount: number;
  /** Total combined rows. */
  total: number;
  /** Sprint rows initially (the un-dragged split point). */
  initialSplit: number;
  /** Set the divider position, clamped to [0, total]. */
  setBoundaryIndex: (n: number) => void;
  /** Rows that crossed vs the initial split. */
  computeDelta: () => SprintBoundaryDelta;
  /** Reset the divider back to the initial split (e.g. after commit/refetch). */
  reset: () => void;
}

export function useSprintBoundary(
  sprintIds: string[],
  backlogIds: string[],
): UseSprintBoundaryResult {
  const initialSplit = sprintIds.length;
  const total = sprintIds.length + backlogIds.length;
  const [boundaryIndex, setBoundaryIndexRaw] = useState(initialSplit);

  const combined = useMemo(
    () => [...sprintIds, ...backlogIds],
    [sprintIds, backlogIds],
  );

  const setBoundaryIndex = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(total, n));
      setBoundaryIndexRaw(clamped);
    },
    [total],
  );

  const computeDelta = useCallback((): SprintBoundaryDelta => {
    const toSprint: string[] = [];
    const toBacklog: string[] = [];
    if (boundaryIndex > initialSplit) {
      // line moved DOWN — backlog rows [initialSplit, boundaryIndex) joined sprint
      for (let i = initialSplit; i < boundaryIndex; i++) toSprint.push(combined[i]);
    } else if (boundaryIndex < initialSplit) {
      // line moved UP — sprint rows [boundaryIndex, initialSplit) left sprint
      for (let i = boundaryIndex; i < initialSplit; i++) toBacklog.push(combined[i]);
    }
    return { toSprint, toBacklog };
  }, [boundaryIndex, initialSplit, combined]);

  const reset = useCallback(
    () => setBoundaryIndexRaw(initialSplit),
    [initialSplit],
  );

  return {
    boundaryIndex,
    inSprintCount: boundaryIndex,
    total,
    initialSplit,
    setBoundaryIndex,
    computeDelta,
    reset,
  };
}
