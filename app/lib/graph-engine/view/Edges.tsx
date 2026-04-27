"use client";

// Edge overlay — single SVG sized to the laid-out canvas, painted on top
// of the absolutely-positioned node divs. SVG paint order is document
// order, and this overlay sits AFTER the node layer in the DOM, so edges
// always render above nodes (matches the prior accordion behaviour).
//
// Arrowheads are locked vertical via orient="0" — the path may bend but
// the head still points up into the parent's bottom edge.

import type { LaidOutEdge } from "../types";

interface EdgesProps {
  width: number;
  height: number;
  edges: LaidOutEdge[];
}

export default function Edges({ width, height, edges }: EdgesProps) {
  return (
    <svg
      className="ge-edges"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="ge-arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="2"
          markerWidth="8"
          markerHeight="8"
          orient="0"
        >
          <path d="M0,8 L5,0 L10,8 Z" fill="currentColor" />
        </marker>
        <marker
          id="ge-arrow-story"
          viewBox="0 0 10 10"
          refX="5"
          refY="2"
          markerWidth="8"
          markerHeight="8"
          orient="0"
        >
          {/* Story 00110: arrowhead matches .ge-edge--story stroke (--danger). */}
          <path d="M0,8 L5,0 L10,8 Z" fill="var(--danger)" />
        </marker>
      </defs>
      {edges.map((e) => {
        const isStory = e.data?.kind === "story";
        return (
          <path
            key={e.id}
            className={"ge-edge" + (isStory ? " ge-edge--story" : "")}
            d={e.path}
            fill="none"
            markerEnd={isStory ? "url(#ge-arrow-story)" : "url(#ge-arrow)"}
          />
        );
      })}
    </svg>
  );
}
