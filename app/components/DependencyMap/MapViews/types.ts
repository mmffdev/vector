/**
 * Shared input shapes for every map renderer (journey-rows, dagre,
 * d3-dag, hand-rolled Sugiyama, cytoscape). All renderers consume the
 * same node + edge contract so we can A/B compare layouts against
 * identical data.
 */

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

export interface MapNode {
  id: string;
  formattedId: string;
  title: string;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Kind drives the connector colour — same `requires` / `unlocks` /
   *  `parallel` semantics as the persisted edge model. */
  kind: "requires" | "unlocks" | "parallel";
}

export interface MapViewProps {
  nodes: MapNode[];
  edges: MapEdge[];
}

/**
 * Measure the live `clientWidth` of an element via ResizeObserver.
 * Re-runs the measurement whenever the element resizes (window
 * resize, layout shift, sidebar collapse, etc.). Used by each map
 * view so library-positioned layouts can fit the available width.
 */
export function useElementWidth<E extends HTMLElement>(): [
  MutableRefObject<E | null>,
  number,
] {
  const ref = useRef<E | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
