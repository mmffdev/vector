"use client";

// PLA-0006 / 00274 — MiniMap layer.
//
// Reads the same node array as the main canvas, projects the world
// bounds into a fixed-size HTMLCanvasElement, and overlays a viewport
// rectangle showing what the user currently sees. Phase 1: read-only
// (no click-to-pan); the controls below cover fitView and zoom.

import { useEffect, useRef } from "react";
import type { DiagramNode, Viewport } from "./types";
import { nodesBounds, readThemeColors, type ViewportSize } from "./render";

interface MiniMapProps {
  nodes: DiagramNode[];
  viewport: Viewport;
  canvasSize: ViewportSize;
  width?: number;
  height?: number;
}

const DEFAULT_W = 160;
const DEFAULT_H = 100;
const PAD = 8;

export default function MiniMap({
  nodes,
  viewport,
  canvasSize,
  width = DEFAULT_W,
  height = DEFAULT_H,
}: MiniMapProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = width * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const colors = readThemeColors(cv);

    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    const bounds = nodesBounds(nodes);
    if (!bounds) return;

    const innerW = width - PAD * 2;
    const innerH = height - PAD * 2;
    const scale = Math.min(innerW / bounds.width, innerH / bounds.height);
    const offX = PAD + (innerW - bounds.width * scale) / 2 - bounds.x * scale;
    const offY = PAD + (innerH - bounds.height * scale) / 2 - bounds.y * scale;

    ctx.fillStyle = colors.inkMuted;
    for (const n of nodes) {
      if (n.hidden) continue;
      ctx.fillRect(n.x * scale + offX, n.y * scale + offY, n.width * scale, n.height * scale);
    }

    // Viewport rect: world-space window currently visible in main canvas.
    const vw = canvasSize.width / viewport.scale;
    const vh = canvasSize.height / viewport.scale;
    const vx = -viewport.x / viewport.scale;
    const vy = -viewport.y / viewport.scale;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx * scale + offX, vy * scale + offY, vw * scale, vh * scale);
  }, [nodes, viewport, canvasSize, width, height]);

  return (
    <div className="diagram-canvas__minimap" aria-hidden="true">
      <canvas ref={ref} width={width} height={height} />
    </div>
  );
}
