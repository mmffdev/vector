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
  // useRef<HTMLSpanElement | null>(null) (a MutableRefObject) without widening.
  /** Live "N to add / remove" delta text (hook-written during a sweep). */
  counterRef: React.RefObject<HTMLSpanElement>;
  /** "Artefacts N" pill text node — hook overwrites during a sweep. */
  artefactsRef: React.RefObject<HTMLSpanElement>;
  /** "Points N" pill text node — hook overwrites during a sweep. */
  pointsRef: React.RefObject<HTMLSpanElement>;
  /** Root element — hook sets `--divider-colour` on it during a sweep. */
  lineRef: React.RefObject<HTMLDivElement>;
  /** At-rest committed-artefact count (shown when not dragging). */
  atRestCount: number;
  /** At-rest committed-points sum (shown when not dragging). */
  atRestPoints: number;
  /** Sprint's Planned Velocity cap — drives the at-rest colour. */
  plannedVelocity: number | null;
}

export function GridSprintBoundaryDivider({
  dragging,
  pointerProps,
  counterRef,
  artefactsRef,
  pointsRef,
  lineRef,
  atRestCount,
  atRestPoints,
  plannedVelocity,
}: GridSprintBoundaryDividerProps) {
  // At-rest colour from the committed totals. During a drag the hook overwrites
  // this inline custom property; on the next render (release) this value wins
  // again. Set as a CSS custom property the pills + line read via var().
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
        <span className="grid__SprintBoundary_Divider_Pill_Value" ref={artefactsRef}>
          {atRestCount}
        </span>
      </span>

      <span className="grid__SprintBoundary_Divider_Line" aria-hidden>
        <span className="grid__SprintBoundary_Divider_Grip" aria-hidden>
          ⇕
        </span>
        <span className="grid__SprintBoundary_Divider_Count" ref={counterRef} />
      </span>

      <span className="grid__SprintBoundary_Divider_Pill grid__SprintBoundary_Divider_Pill-points">
        <span className="grid__SprintBoundary_Divider_Pill_Label">Points</span>{" "}
        <span className="grid__SprintBoundary_Divider_Pill_Value" ref={pointsRef}>
          {atRestPoints}
        </span>
      </span>
    </div>
  );
}
