// PLA-0006/00332 — shared types, constants, and helpers for the
// extracted topology components. Pure module: no React, no DOM.

import type { OrgNode } from "@/app/lib/topologyApi";

// ── geometry ────────────────────────────────────────────────────────
export const NODE_W = 336;
export const NODE_H = 139;
// Selected node renders 40% larger so the focused card stands out from
// its siblings. Layout reserves the bigger box (so neighbours shift) and
// the card itself paints into the bigger wrapper.
export const SELECTED_NODE_SCALE = 1.4;
export const SELECTED_NODE_W = Math.round(NODE_W * SELECTED_NODE_SCALE);
export const SELECTED_NODE_H = Math.round(NODE_H * SELECTED_NODE_SCALE);
export const RANK_SEP = 80; // vertical gap between rows
export const NODE_SEP = 40; // horizontal gap between siblings

// User-toggleable view modes (toolbar buttons in TopologyPage).
export type RankDir = "TB" | "LR";
// React Flow built-in edge types: "default" = parabolic Bezier curves,
// "step" = orthogonal right-angles, "straight" = direct diagonals.
// `smoothstep` is rounded right-angles, NOT parabolic — don't use it here.
export type EdgeKind = "default" | "step" | "straight";
// Authoring mode: "sandbox" = scratchpad for laying out / experimenting
// before committing; "live" = the canonical persisted topology that
// drives the rest of the app.
export type CanvasMode = "sandbox" | "live";

// Two-letter monogram: first letter of the first two whitespace-split tokens,
// uppercased. Strips bracketed segments and non-letter chars first so
// "Retail (copy)" → "RE", not "R(". "ACME Bank" → "AB"; "Sales" → "SA"; empty → "?".
export function initialsFor(name: string): string {
  const cleaned = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\s]/gu, " ");
  const tokens = cleaned.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[1][0]).toUpperCase();
}

export const COLOUR_PALETTE = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#06b6d4", // cyan
  "#6366f1", // indigo
];

// Hash a string to a stable colour from the palette so a node without
// an explicit colour still gets a consistent band.
export function paletteColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLOUR_PALETTE[Math.abs(h) % COLOUR_PALETTE.length];
}

// Data the custom node component receives via Node.data
export type OrgNodeData = {
  org: OrgNode;
  childCount: number;
  archivedDescendantCount: number;
  collapsed: boolean;
  hasChildren: boolean;
  rankdir: RankDir;
  onToggleCollapse: (id: string) => void;
  onOpenMenu: (id: string, screenX: number, screenY: number) => void;
  onOpenArchiveMap: (id: string, name: string) => void;
  onRename: (id: string, name: string) => Promise<boolean> | boolean;
};
