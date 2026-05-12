"use client";

// Flow States v2 — Orbit PoC.
// Client-only proof of concept: nodes sit on a ring, a `+` slot lives between
// every neighbouring pair. Clicking a slot inserts a new node at that exact
// angle; existing nodes animate to the new evenly-spaced angles. No backend.

import { useMemo, useRef, useState } from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";

interface OrbitNode {
  id: string;
  label: string;
  colour: string;
}

// Anchor model:
//   - Most nodes get angle = -π/2 + (i / N) * 2π (even spacing, top = 0).
//   - A node whose `id` matches `anchorId` keeps its `anchorAngle` instead.
//   - Remaining nodes are redistributed around the circle, *skipping* the
//     anchor's slot, so the anchor visually stays where the user clicked.
const SEED: OrbitNode[] = [
  { id: "n-backlog",   label: "Backlog",   colour: "#ef4444" },
  { id: "n-todo",      label: "To Do",     colour: "#f97316" },
  { id: "n-doing",     label: "Doing",     colour: "#eab308" },
  { id: "n-completed", label: "Completed", colour: "#3b82f6" },
  { id: "n-accepted",  label: "Accepted",  colour: "#94a3b8" },
];

const PALETTE = [
  "#10b981", "#14b8a6", "#06b6d4", "#6366f1",
  "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e",
  "#84cc16", "#22c55e", "#0ea5e9", "#d946ef",
];

const VIEWBOX = 480;
const CX = VIEWBOX / 2;
const CY = VIEWBOX / 2;
const ORBIT_R = 160;
const NODE_R = 40;
const PLUS_R = 14;
// Inner endpoint of the start/stop boundary line — sits 40% of the outer ring
// in from the centre, so the dash visually lives in the gap between the
// hollow middle and the wrap `+` slots.
// Flow-direction arc sits inside the ring of states so the arrowhead never
// sweeps through outer labels as it rotates with the boundary.
const FLOW_ARC_R = ORBIT_R * 0.4 + 35;
// Outer flow arc sits just past the wrap `+` slots.
const OUTER_ARC_R = ORBIT_R + PLUS_R + 47;
const OUTER_ARC_DEG = 16;
// Red boundary wedge: filled triangle with apex at the canvas centre, opening
// outward across this many degrees to the outer boundary radius.
const BOUNDARY_WEDGE_DEG = 10;

function polar(angle: number, r: number) {
  return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
}

// Sequence-order layout.
// State 0 sits at 12 o'clock; states walk clockwise. The wrap gap (between the
// last and first state) is sized 2× a normal inner gap, leaving room for the
// two extra `+` slots (insert-before-first, insert-after-last).
//
// With N states there are (N-1) inner gaps + 1 wrap gap = N+1 gap-units total.
//   innerGap = 2π / (N + 1)
//   wrapGap  = 2 * innerGap
// State i angle = -π/2 + i * innerGap.
function layoutAngles(count: number): { stateAngles: number[]; innerGap: number; wrapGap: number } {
  if (count === 0) return { stateAngles: [], innerGap: 0, wrapGap: 0 };
  if (count === 1) {
    // Degenerate: one state pinned at top, full 2π is "wrap gap" — two `+`s
    // sit symmetrically below.
    return { stateAngles: [-Math.PI / 2], innerGap: 0, wrapGap: 2 * Math.PI };
  }
  const innerGap = (2 * Math.PI) / (count + 1);
  const wrapGap  = 2 * innerGap;
  const stateAngles: number[] = [];
  for (let i = 0; i < count; i++) stateAngles.push(-Math.PI / 2 + i * innerGap);
  return { stateAngles, innerGap, wrapGap };
}

function pct(v: number): string {
  return `${(v / VIEWBOX) * 100}%`;
}

export default function FlowStatesV2OrbitPocPage() {
  const [nodes, setNodes] = useState<OrbitNode[]>(SEED);
  const [counter, setCounter] = useState(0);
  // The most-recently-inserted node sticks to the clicked slot's angle so the
  // user's eye stays anchored on it. Cleared on reset; replaced on each insert.
  const [anchor, setAnchor] = useState<{ id: string; angle: number } | null>(null);
  // Continuous (unwrapped) boundary angle so CSS rotates the short way and
  // never spins the long way around when the raw angle wraps past 360°.
  const lastBoundaryRef = useRef<number | null>(null);

  // Resolve final angle for every node, then for `+` slots.
  // Algorithm:
  //   1. Compute the unanchored layout (state 0 at top, inner gaps + wrap gap).
  //   2. If an anchor exists, rotate every angle so the anchor lands on its
  //      captured click-angle — preserves screen position of the new node.
  const { positions, slots, crosses, boundaryAngleDeg } = useMemo(() => {
    const N = nodes.length;
    if (N === 0) return { positions: [], slots: [], crosses: [], boundaryAngleDeg: null };

    const { stateAngles, innerGap, wrapGap } = layoutAngles(N);

    // Build the slot list at the same time, in sequence order:
    //   - Between state i and state i+1: one `+` at midpoint.
    //   - Between state N-1 and state 0 (wrap): two `+`s at thirds.
    type SlotSpec = { insertAt: number; angle: number; key: string };
    const rawSlots: SlotSpec[] = [];

    for (let i = 0; i < N - 1; i++) {
      const mid = stateAngles[i] + innerGap / 2;
      rawSlots.push({ insertAt: i + 1, angle: mid, key: `inner-${i}` });
    }
    if (N >= 1) {
      const lastAngle = stateAngles[N - 1];
      // Wrap span starts after last state, runs `wrapGap` to first state's
      // angle + 2π. Two slots divide this span into thirds.
      const afterLast  = lastAngle + wrapGap / 3;
      const beforeFirst = lastAngle + (2 * wrapGap) / 3;
      rawSlots.push({ insertAt: N,     angle: afterLast,   key: "wrap-after-last" });
      rawSlots.push({ insertAt: 0,     angle: beforeFirst, key: "wrap-before-first" });
    }

    // Apply anchor rotation: shift all angles by (anchor.angle - currentAnchorAngle).
    let rotation = 0;
    if (anchor) {
      const anchorIdx = nodes.findIndex((n) => n.id === anchor.id);
      if (anchorIdx !== -1) rotation = anchor.angle - stateAngles[anchorIdx];
    }

    const rotated = (a: number) => a + rotation;

    const positions = nodes.map((n, i) => {
      const a = rotated(stateAngles[i]);
      const { x, y } = polar(a, ORBIT_R);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      let labelPos: "top" | "right" | "bottom" | "left";
      if (Math.abs(cos) >= Math.abs(sin)) labelPos = cos >= 0 ? "right" : "left";
      else labelPos = sin >= 0 ? "bottom" : "top";
      return { node: n, x, y, angle: a, labelPos };
    });

    const slots = rawSlots.map((s) => {
      const a = rotated(s.angle);
      const { x, y } = polar(a, ORBIT_R);
      return { insertAt: s.insertAt, key: s.key, x, y, angle: a };
    });

    // Decorative crosses on the outer boundary — one between every adjacent
    // pair of states (skips the wrap gap). Each cross sits on OUTER_ARC_R
    // (the outer boundary path, same radius as the red flow arrow's track)
    // and is rotated so its "outward" arm points radially away from centre.
    const crosses: { key: string; x: number; y: number; rotDeg: number }[] = [];
    for (let i = 0; i < N - 1; i++) {
      const mid = rotated(stateAngles[i] + innerGap / 2);
      const { x, y } = polar(mid, OUTER_ARC_R);
      // Polar angle `mid` measures from +X axis. We want the cross rotated so
      // the "up" arm of the glyph points away from the centre — that's the
      // direction (cos(mid), sin(mid)). Convert to a CSS rotate angle: +90°
      // so a 0° rotation faces "up" by default, then add the polar angle in
      // degrees.
      const rotDeg = (mid * 180) / Math.PI + 90;
      crosses.push({ key: `cross-${i}`, x, y, rotDeg });
    }

    // Start/stop boundary marker: sits exactly between the two wrap `+` slots
    // (i.e. the midpoint of the wrap gap). We emit the angle as degrees and
    // let CSS transform-rotate handle animation — SVG geometry attrs (x1/y1)
    // are not reliably CSS-transitionable in all browsers.
    let boundaryAngleDeg: number | null = null;
    if (N >= 1) {
      const a = rotated(stateAngles[N - 1]) + wrapGap / 2;
      // Convert to degrees, then add 90° so 0° points up (polar convention
      // used elsewhere: -π/2 = top → after +90° → 0°).
      const raw = (a * 180) / Math.PI + 90;
      // Unwrap relative to the previously rendered angle so CSS animates the
      // short way around (no 358° backward spin when crossing 0°/360°).
      const prev = lastBoundaryRef.current;
      if (prev === null) {
        boundaryAngleDeg = raw;
      } else {
        let delta = ((raw - prev) % 360 + 540) % 360 - 180; // (-180, 180]
        boundaryAngleDeg = prev + delta;
      }
    }

    return { positions, slots, crosses, boundaryAngleDeg };
  }, [nodes, anchor]);

  // Cache the resolved angle for the next render's unwrap.
  if (boundaryAngleDeg !== null) lastBoundaryRef.current = boundaryAngleDeg;

  function insertAt(idx: number, clickAngle: number) {
    const n = counter + 1;
    setCounter(n);
    const colour = PALETTE[(nodes.length + n) % PALETTE.length];
    const newNode: OrbitNode = {
      id: `n-new-${n}`,
      label: `New ${n}`,
      colour,
    };
    setNodes((prev) => {
      const next = [...prev];
      next.splice(idx, 0, newNode);
      return next;
    });
    // Pin the new node at the clicked slot's angle so it lands where the user
    // clicked; the others rebalance around it.
    setAnchor({ id: newNode.id, angle: clickAngle });
  }

  function removeNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    // If we removed the anchor, drop it so future inserts default to even spacing.
    setAnchor((a) => (a && a.id === id ? null : a));
  }

  function reset() {
    setNodes(SEED);
    setCounter(0);
    setAnchor(null);
  }

  return (
    <PageContent>
      <div className="settings-panel settings-panel--wide">
        <Panel name="orbit_poc" title="Orbit PoC — Add / Remove States" helpable={false}>
          <p className="form__hint" style={{ marginBottom: "var(--space-4)" }}>
            Click any <strong>+</strong> between two states to insert a new state at that
            angle. The other states animate to their new evenly-spaced positions. Click a
            state node to remove it. Two <strong>+</strong> slots sit between the last and
            first state so you can insert before the first or after the last.
          </p>

          <div className="orbit-poc__toolbar">
            <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>
              Reset to seed ({SEED.length} states)
            </button>
            <span className="orbit-poc__count">
              {nodes.length} state{nodes.length === 1 ? "" : "s"} on orbit
            </span>
          </div>

          {/* Layout mirrors transition-rules: 220px rail + canvas + 1fr */}
          <div className="flow-rules__body">
            <div className="flow-rules__rail" role="group" aria-label="Flow states list">
              <p className="flow-rules__eyebrow">SOURCE STATE</p>
              <ul className="flow-rules__rail-list">
                {nodes.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="flow-rules__rail-row"
                      onClick={() => removeNode(s.id)}
                      title={`Remove ${s.label}`}
                    >
                      <span className="flow-rules__rail-dot" style={{ background: s.colour }} aria-hidden />
                      <span className="flow-rules__rail-name">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flow-rules__rail-footer">
                <button type="button" className="btn btn--sm btn--ghost" onClick={reset}>
                  Reset
                </button>
              </div>
            </div>

            <div className="flow-rules__canvas-wrap">
              <p className="flow-rules__eyebrow">TRANSITION SELECTOR</p>

              <div className="flow-rules__canvas-root"
                /* HTML overlay over a 480x480 coord space — same as transition-rules */
              >
            {/* Background SVG layer: start/stop boundary line + flow-direction
                  arc. Rotated via CSS transform so they animate smoothly with
                  the wrap-gap angle. */}
            <svg
              className="orbit-poc__svg"
              viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
              aria-hidden
            >
              <defs>
                <marker
                  id="orbit-poc-arrow-cw-inner"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
                </marker>
                <marker
                  id="orbit-poc-arrow-cw-outer"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                </marker>
                {/* Diagonal stripe fill for the boundary wedge.
                      Two 10px-wide bands at 45°: #584400 and transparent. */}
                <pattern
                  id="orbit-poc-wedge-stripes"
                  patternUnits="userSpaceOnUse"
                  width="20"
                  height="20"
                  patternTransform="rotate(45)"
                >
                  <rect x="0" y="0" width="10" height="20" fill="#584400" />
                  <rect x="10" y="0" width="10" height="20" fill="transparent" />
                </pattern>
              </defs>
              {/* Static guide rings for the two flow arrows — the arrows
                    visually slide along these as the boundary rotates. Same
                    hollow style as state nodes (1px var(--border) stroke). */}
              <circle
                className="orbit-poc__arc-track orbit-poc__arc-track--outer"
                cx={CX}
                cy={CY}
                r={OUTER_ARC_R}
              />
              <circle
                className="orbit-poc__arc-track"
                cx={CX}
                cy={CY}
                r={FLOW_ARC_R}
              />
              {boundaryAngleDeg !== null && (
                <g
                  className="orbit-poc__boundary-group"
                  style={{
                    transform: `rotate(${boundaryAngleDeg}deg)`,
                    transformOrigin: `${CX}px ${CY}px`,
                  }}
                >
                  {/* Boundary wedge — annular trapezium spanning
                        BOUNDARY_WEDGE_DEG (half each side of the boundary
                        line). Inner edge arcs along FLOW_ARC_R (where the
                        green inner arrow sits); outer edge arcs along
                        OUTER_ARC_R (where the red outer arrow sits). */}
                  <path
                    className="orbit-poc__boundary-wedge"
                    d={(() => {
                      const halfRad = (BOUNDARY_WEDGE_DEG / 2 * Math.PI) / 180;
                      const sinH = Math.sin(halfRad);
                      const cosH = Math.cos(halfRad);
                      const ilx = CX - sinH * FLOW_ARC_R;
                      const ily = CY - cosH * FLOW_ARC_R;
                      const irx = CX + sinH * FLOW_ARC_R;
                      const iry = CY - cosH * FLOW_ARC_R;
                      const olx = CX - sinH * OUTER_ARC_R;
                      const oly = CY - cosH * OUTER_ARC_R;
                      const orx = CX + sinH * OUTER_ARC_R;
                      const ory = CY - cosH * OUTER_ARC_R;
                      // Start at inner-left → straight out to outer-left → arc
                      // clockwise along outer radius to outer-right → straight
                      // back to inner-right → arc counter-clockwise back along
                      // inner radius to inner-left → close.
                      return (
                        `M ${ilx} ${ily} ` +
                        `L ${olx} ${oly} ` +
                        `A ${OUTER_ARC_R} ${OUTER_ARC_R} 0 0 1 ${orx} ${ory} ` +
                        `L ${irx} ${iry} ` +
                        `A ${FLOW_ARC_R} ${FLOW_ARC_R} 0 0 0 ${ilx} ${ily} ` +
                        `Z`
                      );
                    })()}
                  />
                  {/* Inner 30° clockwise arc at FLOW_ARC_R. Pre-rotation,
                        starts at 12 o'clock and sweeps 30° clockwise. */}
                  <path
                    className="orbit-poc__flow-arc orbit-poc__flow-arc--inner"
                    d={`M ${CX} ${CY - FLOW_ARC_R} A ${FLOW_ARC_R} ${FLOW_ARC_R} 0 0 1 ${
                      CX + Math.sin((30 * Math.PI) / 180) * FLOW_ARC_R
                    } ${
                      CY - Math.cos((30 * Math.PI) / 180) * FLOW_ARC_R
                    }`}
                    markerEnd="url(#orbit-poc-arrow-cw-inner)"
                  />
                  {/* Outer 30° clockwise arc that curves *into* the wedge's
                        outer-left corner. Same radius as OUTER_ARC_R, starts
                        30° counter-clockwise of 12 o'clock and ends at the
                        12 o'clock position — arrowhead meets the wedge edge. */}
                  <path
                    className="orbit-poc__flow-arc orbit-poc__flow-arc--outer"
                    d={`M ${
                      CX - Math.sin((OUTER_ARC_DEG * Math.PI) / 180) * OUTER_ARC_R
                    } ${
                      CY - Math.cos((OUTER_ARC_DEG * Math.PI) / 180) * OUTER_ARC_R
                    } A ${OUTER_ARC_R} ${OUTER_ARC_R} 0 0 1 ${CX} ${CY - OUTER_ARC_R}`}
                    markerEnd="url(#orbit-poc-arrow-cw-outer)"
                  />
                </g>
              )}
              {/* Decorative outward-facing crosses on the outer boundary —
                    one between every adjacent state (wrap gap skipped).
                    Each cross is rotated so its "up" arm points radially
                    away from the orbit centre. Stroke matches the state
                    circle border so they read as part of the same chrome. */}
              {crosses.map(({ key, x, y, rotDeg }) => (
                <g
                  key={key}
                  className="orbit-poc__cross"
                  style={{
                    transform: `translate(${x}px, ${y}px) rotate(${rotDeg}deg)`,
                    transformOrigin: `0 0`,
                    transformBox: "view-box",
                  }}
                >
                  <line x1="0" y1="-7" x2="0" y2="7" />
                  <line x1="-7" y1="0" x2="7" y2="0" />
                </g>
              ))}
            </svg>

            {/* Orbit nodes */}
            {positions.map(({ node, x, y, labelPos }) => (
              <button
                key={node.id}
                type="button"
                className="orbit-poc__node orbit-poc__node--orbit"
                title={`Click to remove ${node.label}`}
                aria-label={`Remove ${node.label}`}
                style={{
                  left: pct(x),
                  top:  pct(y),
                  width: pct(NODE_R * 2),
                }}
                onClick={() => removeNode(node.id)}
              >
                <div className={`orbit-poc__node-label orbit-poc__node-label--${labelPos}`}>
                  {node.label}
                </div>
              </button>
            ))}

            {/* + slots: one between adjacent states, two across the wrap gap */}
            {slots.map(({ insertAt: idx, key, x, y, angle }) => (
              <button
                key={key}
                type="button"
                className="orbit-poc__plus"
                title="Insert state here"
                aria-label="Insert state here"
                style={{
                  left: pct(x),
                  top:  pct(y),
                  width: pct(PLUS_R * 2),
                }}
                onClick={() => insertAt(idx, angle)}
              >
                <span className="orbit-poc__plus-glyph">+</span>
              </button>
            ))}

              </div>
            </div>
          </div>
        </Panel>
      </div>

      <style jsx>{`
        /* PoC-only: rail sets the row height; the orbit canvas is sized to
           fit within that height (rail min-height − wrap padding − eyebrow)
           so the canvas-wrap doesn't push the row taller than the rail.
           Scoped via :global so transition-rules keeps its original size. */
        :global(.flow-rules__rail) {
          min-height: 590px;
        }
        :global(.flow-rules__canvas-root) {
          width: 520px;
          height: 520px;
        }
        .orbit-poc__toolbar {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
        }
        .orbit-poc__count {
          font-size: 0.85rem;
          color: var(--ink-muted);
        }
        .orbit-poc__svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          overflow: visible;
        }
        .orbit-poc__boundary-group {
          transition: transform 360ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .orbit-poc__flow-arc {
          fill: none;
          stroke: #ffffff;
          stroke-width: 2;
          stroke-linecap: round;
          /* TEMP: arrows hidden — remove this line to restore. */
          display: none;
        }
        .orbit-poc__flow-arc--inner { stroke: #22c55e; }
        .orbit-poc__flow-arc--outer { stroke: #ef4444; }
        .orbit-poc__boundary-wedge {
          fill: url(#orbit-poc-wedge-stripes);
          stroke: var(--border);
          stroke-width: 1;
        }
        .orbit-poc__arc-track {
          /* Same hollow ring as state nodes — 1px var(--border) outline.
             TEMP: hidden — drop the display:none line to restore the inner
             and outer guide rings under each flow arrow. */
          fill: none;
          stroke: var(--border);
          stroke-width: 1;
          display: none;
        }
        /* Outer boundary track — visible and dashed (20px on / 10px off). */
        .orbit-poc__arc-track--outer {
          display: block;
          stroke-dasharray: 20 10;
        }
        .orbit-poc__cross {
          transition: transform 360ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        .orbit-poc__cross line {
          stroke: var(--border);
          stroke-width: 1.5;
          stroke-linecap: round;
        }
        .orbit-poc__node {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 0;
          border: 1px solid var(--border);
          background: transparent;
          border-radius: 50%;
          aspect-ratio: 1 / 1;
          height: auto;
          cursor: pointer;
          transition: left 360ms cubic-bezier(0.4, 0, 0.2, 1),
                      top  360ms cubic-bezier(0.4, 0, 0.2, 1),
                      width 360ms ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .orbit-poc__node-label {
          position: absolute;
          font-size: 0.95rem;
          color: var(--ink);
          white-space: nowrap;
          pointer-events: none;
        }
        .orbit-poc__node-label--top    { bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); }
        .orbit-poc__node-label--bottom { top:    calc(100% + 6px); left: 50%; transform: translateX(-50%); }
        .orbit-poc__node-label--left   { right:  calc(100% + 8px); top: 50%;  transform: translateY(-50%); }
        .orbit-poc__node-label--right  { left:   calc(100% + 8px); top: 50%;  transform: translateY(-50%); }

        .orbit-poc__plus {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 0;
          border: 1px dashed var(--border);
          background: var(--surface-raised, rgba(255,255,255,0.04));
          color: var(--ink-muted);
          border-radius: 50%;
          aspect-ratio: 1 / 1;
          height: auto;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: left 360ms cubic-bezier(0.4, 0, 0.2, 1),
                      top  360ms cubic-bezier(0.4, 0, 0.2, 1),
                      background 160ms ease,
                      color 160ms ease,
                      border-color 160ms ease,
                      transform 160ms ease;
        }
        .orbit-poc__plus:hover {
          background: var(--accent, #3b82f6);
          color: white;
          border-color: var(--accent, #3b82f6);
          transform: translate(-50%, -50%) scale(1.15);
        }
        .orbit-poc__plus-glyph {
          font-size: 1rem;
          line-height: 1;
          font-weight: 500;
        }
      `}</style>
    </PageContent>
  );
}
