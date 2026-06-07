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
import { velocityColour } from "./sprintVelocityColour";

export interface SweepResult {
  direction: "add" | "remove";
  uuids: string[];
}

interface RowSnap {
  el: HTMLElement;
  uuid: string;
  section: "sprint" | "backlog";
  mid: number;
  points: number;
  // The row's bottom edge in CONTAINER-relative px (offsetTop + height). Used
  // to position the floating overlay line at the boundary as the sweep moves,
  // so the coloured bar visibly travels with the pointer.
  bottom: number;
}

export interface UseSweepSelectArgs {
  containerRef: { current: HTMLElement | null };
  counterRef: { current: HTMLElement | null };
  onCommit: (result: SweepResult) => void;
  /**
   * Live "Artefacts N" pill text node — set to the count of rows above the line
   * during the drag (pure DOM, zero React render). Optional: omit and the pill
   * simply isn't driven by the sweep.
   */
  artefactsRef?: { current: HTMLElement | null };
  /** Live "Points N" pill text node — set to the summed story points above the line. */
  pointsRef?: { current: HTMLElement | null };
  /**
   * The element whose `--divider-colour` custom property is set to the
   * velocity blend each move. Typically the divider root so its pills + line
   * inherit the colour. Optional.
   */
  lineRef?: { current: HTMLElement | null };
  /**
   * The floating overlay line — an absolutely-positioned child of the container
   * that VISIBLY TRACKS the pointer during a drag. Each move sets its `top`
   * (container-relative px of the boundary row's bottom edge) and its
   * `--divider-colour`, so the coloured commitment bar rides down the grid with
   * the mouse. NEVER reparented (only style mutated) → pointer capture is safe.
   * Optional: omit and no floating line is drawn (class-toggle line still shows).
   */
  overlayRef?: { current: HTMLElement | null };
  /**
   * The sprint's Planned Velocity cap that drives the colour escalation. Read
   * via a ref internally so the LATEST value is used mid-drag without
   * re-snapshotting; null/0/undefined → neutral green (no divide-by-zero).
   */
  plannedVelocity?: number | null;
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
  artefactsRef,
  pointsRef,
  lineRef,
  overlayRef,
  plannedVelocity,
}: UseSweepSelectArgs): UseSweepSelectResult {
  const [dragging, setDragging] = useState(false);
  const snapRef = useRef<RowSnap[]>([]);
  // Initial split = number of rows in the sprint section at pointerdown (the
  // un-dragged boundary). The line starts here.
  const initialSplitRef = useRef(0);
  // Current boundary index = how many of the combined rows are above the line.
  const boundaryRef = useRef(0);
  // The Planned Velocity cap, mirrored into a ref so the move handler reads the
  // LATEST value (the handlers are stable callbacks; without the ref a velocity
  // edit mid-mount would be captured stale). Kept in sync every render.
  const velocityRef = useRef<number | null>(plannedVelocity ?? null);
  velocityRef.current = plannedVelocity ?? null;

  // Write the live readouts for a given boundary index — the Artefacts count,
  // the Points sum, and the velocity colour — straight to the ref'd DOM nodes.
  // Pure DOM, no React state. Called on pointerdown (initial paint) and every
  // pointermove. Defined ABOVE the pointer handlers so they can list it as a
  // dependency without a temporal-dead-zone reference.
  const paintReadouts = useCallback(
    (boundary: number) => {
      const snap = snapRef.current;
      let pointsAbove = 0;
      for (let i = 0; i < boundary && i < snap.length; i++) {
        pointsAbove += snap[i].points;
      }
      const colour = velocityColour(pointsAbove, velocityRef.current);

      if (artefactsRef?.current) {
        artefactsRef.current.textContent = String(boundary);
      }
      if (pointsRef?.current) {
        pointsRef.current.textContent = String(pointsAbove);
      }
      if (lineRef?.current) {
        lineRef.current.style.setProperty("--divider-colour", colour);
      }

      // The floating overlay line — ride it to the bottom edge of the last
      // in-sprint row (boundary 0 → the very top of the container). Only `top`
      // + `--divider-colour` are mutated; the element is never reparented, so
      // the pointer capture on the handle survives and the drag keeps going.
      if (overlayRef?.current) {
        const ov = overlayRef.current;
        const top = boundary <= 0 ? 0 : snap[boundary - 1]?.bottom ?? 0;
        ov.style.top = `${top}px`;
        ov.style.setProperty("--divider-colour", colour);
      }
    },
    [artefactsRef, pointsRef, lineRef, overlayRef],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const container = containerRef.current;
      if (!container) return;
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>("[data-sweep-row]"),
      );
      // Container origin (viewport) + its scroll offset → convert each row's
      // viewport rect into a CONTAINER-relative bottom edge for the overlay.
      const containerTop = container.getBoundingClientRect().top;
      const scrollTop = container.scrollTop;
      snapRef.current = rows.map((el) => {
        const r = el.getBoundingClientRect();
        // data-sweep-points carries the row's story points ("" / missing → 0).
        const pts = Number(el.getAttribute("data-sweep-points"));
        return {
          el,
          uuid: el.getAttribute("data-sweep-uuid") ?? "",
          section:
            (el.getAttribute("data-sweep-section") as "sprint" | "backlog") ??
            "backlog",
          mid: r.top + r.height / 2,
          points: Number.isFinite(pts) ? pts : 0,
          bottom: r.bottom - containerTop + scrollTop,
        };
      });
      const split = snapRef.current.filter((r) => r.section === "sprint").length;
      initialSplitRef.current = split;
      boundaryRef.current = split;
      // Paint the readouts for the un-dragged boundary so the pills + colour are
      // correct the instant the gesture begins (before the first move).
      paintReadouts(split);
      setDragging(true);
    },
    [containerRef, paintReadouts],
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
      //   • the last row above the line → LINE (a thin edge under the tint that
      //     anchors the floating overlay bar). Both travel with the pointer via
      //     class toggling — no element is re-inserted (which would drop the
      //     pointer capture and freeze the drag after one move). The bold
      //     coloured commitment bar itself is the overlay, positioned below.
      snap.forEach((row, i) => {
        const above = i < boundary;
        row.el.classList.toggle(IN_SPRINT, above);
        row.el.classList.toggle(LINE, above && i === boundary - 1);
      });

      // Live Artefacts / Points / colour readouts on the divider pills.
      paintReadouts(boundary);

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
    [counterRef, paintReadouts],
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
