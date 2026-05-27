"use client";

import { useEffect, useRef } from "react";
import type { ErdResponse, ErdNode, ErdEdge, Filters } from "./DevErdPanel";

type Props = {
  data: ErdResponse | null;
  filters: Filters | null;
  onSelect: (selected: ErdNode | ErdEdge) => void;
  registerFit?: (fn: () => void) => void;
};

type CyControllable = { destroy: () => void; fit: () => void };

export default function DevErdCanvas({ data, filters, onSelect, registerFit }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!data || !filters || !hostRef.current) return;
    let disposed = false;
    let cy: CyControllable | null = null;

    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const dagre = (await import("cytoscape-dagre")).default;
      cytoscape.use(dagre);

      const visibleNodes = data.nodes.filter(
        (n) => filters.databases.has(n.database) && filters.groups.has(n.group),
      );
      const visibleIDs = new Set(visibleNodes.map((n) => n.id));
      const visibleEdges = data.edges.filter(
        (e) => filters.edgeKinds.has(e.kind) && visibleIDs.has(e.from) && visibleIDs.has(e.to),
      );

      type Scratch = { node?: ErdNode; edge?: ErdEdge };

      const built = cytoscape({
        container: hostRef.current!,
        elements: [
          ...visibleNodes.map((n) => ({
            data: { id: n.id, label: n.table, group: n.group },
            scratch: { node: n } satisfies Scratch,
          })),
          ...visibleEdges.map((e) => ({
            data: { id: e.id, source: e.from, target: e.to, kind: e.kind },
            scratch: { edge: e } satisfies Scratch,
          })),
        ],
        layout: { name: "dagre", rankDir: "BT" } as unknown as cytoscape.LayoutOptions,
        style: [
          { selector: "node", style: { label: "data(label)", "text-valign": "center", "background-color": "#222", color: "#fff", "border-width": 1, "border-color": "#444" } },
          { selector: "edge", style: { "curve-style": "bezier", "target-arrow-shape": "triangle", "line-color": "#666", "target-arrow-color": "#666" } },
          { selector: 'edge[kind = "soft_ref"]', style: { "line-style": "dashed" } },
        ],
      });
      cy = built;
      registerFit?.(() => built.fit());

      built.on("tap", "node", (evt) => {
        if (disposed) return;
        const s = evt.target.scratch() as Scratch;
        if (s.node) onSelect(s.node);
      });
      built.on("tap", "edge", (evt) => {
        if (disposed) return;
        const s = evt.target.scratch() as Scratch;
        if (s.edge) onSelect(s.edge);
      });
    })().catch((err) => console.error("erd canvas init", err));

    return () => {
      disposed = true;
      cy?.destroy();
    };
  }, [data, filters, onSelect, registerFit]);

  return <div ref={hostRef} className="dui-erd-canvas" aria-label="ERD canvas" />;
}
