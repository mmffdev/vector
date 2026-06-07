// app/components/Grid/Grid__SprintBoundary_Divider.tsx
"use client";

// Grid__SprintBoundary_Divider — the sweep handle (formerly the draggable
// commitment line). Presentational only: it spreads the imperative pointer
// handlers from useSweepSelect onto its root div and exposes a counter <span>
// via ref so the hook can write the live "N to add/remove" text directly to the
// DOM during a sweep (zero React renders). Subtle at rest, blooms while
// dragging. Press the handle and sweep DOWN over backlog rows to add them to the
// sprint, or UP over sprint rows to remove them; release to save.

export interface GridSprintBoundaryDividerProps {
  dragging: boolean;
  pointerProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
  // React 18 RefObject<T>.current is already T | null; pairs with the parent's
  // useRef<HTMLSpanElement | null>(null) (a MutableRefObject) without widening.
  counterRef: React.RefObject<HTMLSpanElement>;
  // The divider line's own element — useSweepSelect moves it through the grid
  // during a sweep so the boundary travels with the pointer (in-grid).
  handleRef?: React.RefObject<HTMLDivElement>;
}

export function GridSprintBoundaryDivider({
  dragging,
  pointerProps,
  counterRef,
  handleRef,
}: GridSprintBoundaryDividerProps) {
  return (
    <div
      ref={handleRef}
      className={`grid__SprintBoundary_Divider${dragging ? " grid__SprintBoundary_Divider-dragging" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Sprint commitment handle — drag down over backlog rows to add them to the sprint, or up over sprint rows to remove. Release to save."
      {...pointerProps}
    >
      <span className="grid__SprintBoundary_Divider_Grip" aria-hidden>
        ⇕
      </span>
      <span className="grid__SprintBoundary_Divider_Count" ref={counterRef} />
    </div>
  );
}
