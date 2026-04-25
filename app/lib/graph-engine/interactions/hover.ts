// Hover scaffold — flag-gated off by default.
//
// Same shape as drag.ts: minimal surface today, real implementation in a
// later story. When `opts.enabled` is false this is a no-op; when true,
// future work will toggle `.ge-node--hover` on the hovered node and any
// edges incident to it (CSS already styles those classes).

import type { LaidOutGraph, LaidOutNode } from "../types";

export interface HoverHandle {
  destroy(): void;
}

export interface HoverOptions {
  enabled: boolean;
  /** Notified on hover enter/leave. `node === null` means "no hover". */
  onChange?: (node: LaidOutNode | null, graph: LaidOutGraph) => void;
}

export function attachHover(
  _root: HTMLElement | null,
  _graph: LaidOutGraph,
  opts: HoverOptions
): HoverHandle {
  if (!opts.enabled) {
    return { destroy() {} };
  }
  // TODO(graph-engine hover): pointerover/out delegation, edge dimming.
  return { destroy() {} };
}
