"use client";

/**
 * MapViewCytoscape — DAG visualisation via cytoscape.js with the
 * cytoscape-dagre layout extension.
 *
 * Cytoscape brings its own renderer (canvas-based), so unlike the
 * other map views this one isn't SVG-driven from React state — we
 * mount a `<div>`, hand it to cytoscape, and let cytoscape paint.
 * Trade-off: cytoscape's bundle is ~750 KB but it gives us
 * interaction primitives (zoom, pan, hover, fit) that the
 * hand-rolled and library-positioning views don't have.
 *
 * Lifecycle: mount → init → destroy on unmount. We re-init when the
 * input data changes — cheaper than diffing for our graph sizes.
 */

import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import dagreLayout from "cytoscape-dagre";
import type { MapViewProps } from "./types";

let dagreRegistered = false;
function ensureDagreRegistered() {
  if (dagreRegistered) return;
  cytoscape.use(dagreLayout);
  dagreRegistered = true;
}

export function MapViewCytoscape({ nodes, edges }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    ensureDagreRegistered();
    const el = containerRef.current;
    if (!el) return;
    if (nodes.length === 0) {
      cyRef.current?.destroy();
      cyRef.current = null;
      return;
    }
    const idSet = new Set(nodes.map((n) => n.id));
    const cy = cytoscape({
      container: el,
      elements: [
        ...nodes.map((n) => ({
          data: { id: n.id, label: n.formattedId, title: n.title },
        })),
        ...edges
          .filter(
            (e) =>
              e.kind !== "parallel" && idSet.has(e.from) && idSet.has(e.to),
          )
          .map((e) => ({
            data: {
              id: `${e.from}__${e.to}`,
              source: e.from,
              target: e.to,
              kind: e.kind,
            },
          })),
      ],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "var(--surface)",
            "border-color": "var(--border-default)",
            "border-width": 1,
            color: "var(--ink)",
            "font-family": "var(--font-mono)",
            "font-size": 11,
            "font-weight": 600,
            "text-valign": "center",
            "text-halign": "center",
            shape: "round-rectangle",
            width: 80,
            height: 28,
            padding: "8px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "var(--border-strong)",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "var(--border-strong)",
            "curve-style": "bezier",
          },
        },
        {
          selector: 'edge[kind = "requires"]',
          style: {
            "line-color": "var(--orange)",
            "target-arrow-color": "var(--orange)",
          },
        },
        {
          selector: 'edge[kind = "unlocks"]',
          style: {
            "line-color": "var(--good-green)",
            "target-arrow-color": "var(--good-green)",
          },
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layout: { name: "dagre", rankDir: "LR", nodeSep: 24, rankSep: 80 } as any,
      wheelSensitivity: 0.3,
    });
    cyRef.current?.destroy();
    cyRef.current = cy;

    return () => {
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="dependency-map__MapSurface">
        <p className="dependency-map__MapEmpty">
          No relationships found in this topology yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className="dependency-map__MapSurface"
      role="region"
      aria-label="Cytoscape.js DAG layout"
    >
      <div
        ref={containerRef}
        className="dependency-map__CytoscapeHost"
      />
    </div>
  );
}
