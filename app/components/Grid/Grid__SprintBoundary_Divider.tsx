// app/components/Grid/Grid__SprintBoundary_Divider.tsx
"use client";

// Grid__SprintBoundary_Divider — the Jira-style velocity commitment line that
// sits between the in-sprint rows and the backlog. It is the sweep handle
// (spreads the imperative pointer handlers from useSweepSelect onto its root)
// AND the live readout: two pills — "Artefacts N" (count of rows above the
// line) on the left, "Points N" (summed story points above the line) on the
// right — joined by a coloured line.
//
// The colour blends green→amber→red with sprint load against Planned Velocity.
// At rest (not dragging) React renders the CURRENT in-sprint count / points /
// colour from props, so the line is informative before you touch it. During a
// drag useSweepSelect overwrites the pill text + the line's `--divider-colour`
// custom property directly in the DOM (zero React renders); on release the next
// render restores the prop-driven at-rest values.
//
// Press the handle and sweep DOWN over backlog rows to add them to the sprint,
// or UP over sprint rows to remove them; release to save.

import { velocityColour } from "./sprintVelocityColour";

export interface GridSprintBoundaryDividerProps {
  dragging: boolean;
  pointerProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
  // React 18 RefObject<T>.current is already T | null; pairs with the parent's
  // useRef<HTMLDivElement | null>(null) (a MutableRefObject) without widening.
  /** Root element — React sets the at-rest `--divider-colour` on it; the hook
   *  reads it as lineRef (kept for parity, drives the resting colour). */
  lineRef: React.RefObject<HTMLDivElement>;
  /** At-rest committed-artefact count (the resting display). */
  atRestCount: number;
  /** At-rest committed-points sum (the resting display). */
  atRestPoints: number;
  /** Sprint's Planned Velocity cap — drives the at-rest colour. */
  plannedVelocity: number | null;
}

export function GridSprintBoundaryDivider({
  dragging,
  pointerProps,
  lineRef,
  atRestCount,
  atRestPoints,
  plannedVelocity,
}: GridSprintBoundaryDividerProps) {
  // At-rest colour from the committed totals. The static divider is the RESTING
  // display — during a drag the floating overlay takes over (this element is
  // dimmed via the -dragging modifier) and the overlay carries the live values.
  const atRestColour = velocityColour(atRestPoints, plannedVelocity);

  return (
    <div
      ref={lineRef}
      className={`grid__SprintBoundary_Divider${dragging ? " grid__SprintBoundary_Divider-dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Sprint commitment line — drag down over backlog rows to add them to the sprint, or up over sprint rows to remove. Release to save."
      style={{ "--divider-colour": atRestColour } as React.CSSProperties}
      {...pointerProps}
    >
      <span className="grid__SprintBoundary_Divider_Pill grid__SprintBoundary_Divider_Pill-artefacts">
        <span className="grid__SprintBoundary_Divider_Pill_Label">Artefacts</span>{" "}
        <span className="grid__SprintBoundary_Divider_Pill_Value">{atRestCount}</span>
      </span>

      <span className="grid__SprintBoundary_Divider_Line" aria-hidden>
        <span className="grid__SprintBoundary_Divider_Grip" aria-hidden>
          ⇕
        </span>
      </span>

      <span className="grid__SprintBoundary_Divider_Pill grid__SprintBoundary_Divider_Pill-points">
        <span className="grid__SprintBoundary_Divider_Pill_Label">Points</span>{" "}
        <span className="grid__SprintBoundary_Divider_Pill_Value">{atRestPoints}</span>
      </span>
    </div>
  );
}
