// Layout registry — name → layout function. Adding a new layout means
// writing the file + one line here; no view or accordion changes needed.

import type { Graph, LaidOutGraph, LayoutFn } from "../types";
import { hierarchyLayout } from "./hierarchy";

const layouts: Record<string, LayoutFn> = {
  hierarchy: hierarchyLayout,
};

export function layoutByName(g: Graph): LaidOutGraph {
  const fn = layouts[g.layout];
  if (!fn) throw new Error(`Unknown graph layout: ${g.layout}`);
  return fn(g);
}

export { hierarchyLayout };
