"use client";

// PLA-0006/00332 — camera-fly hook lifted out of page.tsx.
//
// Owns the canvas DOM ref, the in-flight rAF handle, and the
// centerOnNode tween so page.tsx is free of the parabolic-zoom math.
// The ResizeObserver and selectedId-change effects stay in page.tsx
// because they couple to selection state from the page body.

import { useCallback, useEffect, useRef } from "react";
import type { Node, Edge, ReactFlowInstance } from "@xyflow/react";
import {
  NODE_W,
  NODE_H,
  SELECTED_NODE_W,
  SELECTED_NODE_H,
  type OrgNodeData,
} from "./types";

const ZOOM = 0.84;
const ZOOM_OUT = 0.4;
const FLY_MS = 720;

export function useTopologyCamera(
  rfRef: React.MutableRefObject<ReactFlowInstance<Node<OrgNodeData>, Edge> | null>,
  layout: { nodes: Node<OrgNodeData>[]; edges: Edge[] },
  selectedId: string | null,
) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const flyRafRef = useRef<number | null>(null);

  const cancelFly = useCallback(() => {
    if (flyRafRef.current != null) {
      cancelAnimationFrame(flyRafRef.current);
      flyRafRef.current = null;
    }
  }, []);

  const centerOnNode = useCallback(
    (
      nodeOrId:
        | string
        | { id?: string; position: { x: number; y: number } },
      opts?: { duration?: number },
    ) => {
      const inst = rfRef.current;
      if (!inst) return;
      let target:
        | { id?: string; position: { x: number; y: number }; w: number; h: number }
        | null = null;
      if (typeof nodeOrId === "string") {
        const n = layout.nodes.find((x) => x.id === nodeOrId);
        if (!n) return;
        const isSel = n.id === selectedId;
        target = {
          id: n.id,
          position: n.position,
          w: isSel ? SELECTED_NODE_W : NODE_W,
          h: isSel ? SELECTED_NODE_H : NODE_H,
        };
      } else {
        const isSel = nodeOrId.id === selectedId;
        target = {
          id: nodeOrId.id,
          position: nodeOrId.position,
          w: isSel ? SELECTED_NODE_W : NODE_W,
          h: isSel ? SELECTED_NODE_H : NODE_H,
        };
      }
      const cx = target.position.x + target.w / 2;
      const cy = target.position.y + target.h / 2;
      cancelFly();
      if (opts?.duration === 0) {
        inst.setCenter(cx, cy, { zoom: ZOOM, duration: 0 });
        return;
      }
      const start = inst.getViewport();
      const vpW = canvasRef.current?.getBoundingClientRect().width ?? 0;
      const vpH = canvasRef.current?.getBoundingClientRect().height ?? 0;
      const startCenterFlowX = (vpW / 2 - start.x) / start.zoom;
      const startCenterFlowY = (vpH / 2 - start.y) / start.zoom;
      const startZoom = start.zoom;
      const t0 = performance.now();
      const easeInOut = (t: number) =>
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const step = (now: number) => {
        const inst2 = rfRef.current;
        if (!inst2) {
          flyRafRef.current = null;
          return;
        }
        const t = Math.min(1, (now - t0) / FLY_MS);
        const e = easeInOut(t);
        const px = startCenterFlowX + (cx - startCenterFlowX) * e;
        const py = startCenterFlowY + (cy - startCenterFlowY) * e;
        const a = 2 * (startZoom + ZOOM) - 4 * ZOOM_OUT;
        const b = -3 * startZoom - ZOOM + 4 * ZOOM_OUT;
        const c = startZoom;
        const z = a * t * t + b * t + c;
        inst2.setViewport(
          { x: vpW / 2 - px * z, y: vpH / 2 - py * z, zoom: z },
          { duration: 0 },
        );
        if (t < 1) {
          flyRafRef.current = requestAnimationFrame(step);
        } else {
          flyRafRef.current = null;
        }
      };
      flyRafRef.current = requestAnimationFrame(step);
    },
    [rfRef, layout, selectedId, cancelFly],
  );

  // Cancel any in-flight fly animation when the component unmounts.
  useEffect(() => () => cancelFly(), [cancelFly]);

  return { canvasRef, centerOnNode, cancelFly };
}
