// Drag scaffold — flag-gated off by default.
//
// Compiles and is callable today, but does nothing unless explicitly
// enabled via Graph.interactions.drag === true. We ship the surface now
// so Story 3 callers don't have to wait on a future engine bump; when
// drag becomes a real feature, the implementation lands here without
// public-API churn.

import type { LaidOutGraph, LaidOutNode } from "../types";

export interface DragHandle {
  /** Detach pointer listeners. Always safe to call. */
  destroy(): void;
}

export interface DragOptions {
  enabled: boolean;
  /** Notified when a node is moved. Receives the mutated graph snapshot. */
  onMove?: (node: LaidOutNode, graph: LaidOutGraph) => void;
}

/**
 * Wire drag listeners onto a canvas root. No-op when `opts.enabled`
 * is false; returns a destroy() that's safe to call regardless.
 *
 * Real implementation will land in a follow-up story; this surface is
 * deliberately minimal so callers can wire it up today.
 */
export function attachDrag(
  _root: HTMLElement | null,
  _graph: LaidOutGraph,
  opts: DragOptions
): DragHandle {
  if (!opts.enabled) {
    return { destroy() {} };
  }
  // TODO(graph-engine drag): pointerdown/move/up, snap-to-grid, edge re-route.
  return { destroy() {} };
}
