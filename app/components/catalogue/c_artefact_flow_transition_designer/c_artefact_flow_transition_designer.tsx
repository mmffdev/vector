"use client";

// Artefact Flow Transition Designer
// -----------------------------------------------------------------------------
// Standalone, reusable sub-panel for designing a cyclical sequence of items.
//
// Layout (matches the v2 PoC the component was extracted from):
//   [ SOURCE STATE rail ] [ TRANSITION SELECTOR canvas ]
//
// Rail:   one row per item; clicking a row removes that item.
// Canvas: items sit on a ring in declared order; a `+` slot lives between
//         every neighbouring pair, plus two extra slots across the wrap gap
//         (insert-before-first / insert-after-last). Clicking a slot inserts
//         at that angle and pins the new item to the clicked angle so the
//         user's eye stays anchored; the rest rebalance evenly.
//
// Controlled or uncontrolled:
//   - Pass `items` + `onInsert` + `onRemove` to drive externally.
//   - Pass `defaultItems` only to use the built-in local state (PoC / demo).
//
// Decoration (boundary wedge + flow arrows + outer-boundary crosses) is opt-in
// via `showFlowDecoration`. The geometry primitive is decoration-agnostic.

import { useMemo, useRef, useState, useCallback, type ReactNode } from "react";

export interface OrbitItem {
  id: string;
  label: string;
  colour: string;
}

export interface ArtefactFlowTransitionDesignerProps {
  // Controlled mode
  items?: OrbitItem[];
  onInsert?: (index: number, angle: number) => void;
  onRemove?: (id: string) => void;

  // Uncontrolled mode (local state). Ignored when `items` is provided.
  defaultItems?: OrbitItem[];
  paletteForNewItems?: string[];
  newItemLabel?: (n: number) => string;

  // Layout / chrome
  showRail?: boolean;
  railEyebrow?: string;
  canvasEyebrow?: string;
  railFooter?: ReactNode;
  onResetToDefaults?: () => void;

  // Geometry (all optional with sensible defaults)
  viewbox?: number;
  orbitRadius?: number;
  nodeRadius?: number;
  plusRadius?: number;

  // Decoration
  showFlowDecoration?: boolean;

  // Animation
  transitionMs?: number;
}

const DEFAULT_PALETTE = [
  "#10b981", "#14b8a6", "#06b6d4", "#6366f1",
  "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e",
  "#84cc16", "#22c55e", "#0ea5e9", "#d946ef",
];

const DEFAULT_SEED: OrbitItem[] = [
  { id: "n-backlog",   label: "Backlog",   colour: "#ef4444" },
  { id: "n-todo",      label: "To Do",     colour: "#f97316" },
  { id: "n-doing",     label: "Doing",     colour: "#eab308" },
  { id: "n-completed", label: "Completed", colour: "#3b82f6" },
  { id: "n-accepted",  label: "Accepted",  colour: "#94a3b8" },
];

function layoutAngles(count: number): { stateAngles: number[]; innerGap: number; wrapGap: number } {
  if (count === 0) return { stateAngles: [], innerGap: 0, wrapGap: 0 };
  if (count === 1) {
    return { stateAngles: [-Math.PI / 2], innerGap: 0, wrapGap: 2 * Math.PI };
  }
  const innerGap = (2 * Math.PI) / (count + 1);
  const wrapGap  = 2 * innerGap;
  const stateAngles: number[] = [];
  for (let i = 0; i < count; i++) stateAngles.push(-Math.PI / 2 + i * innerGap);
  return { stateAngles, innerGap, wrapGap };
}

export default function ArtefactFlowTransitionDesigner({
  items: controlledItems,
  onInsert: controlledInsert,
  onRemove: controlledRemove,
  defaultItems = DEFAULT_SEED,
  paletteForNewItems = DEFAULT_PALETTE,
  newItemLabel = (n) => `New ${n}`,
  showRail = true,
  railEyebrow = "SOURCE STATE",
  canvasEyebrow = "TRANSITION SELECTOR",
  railFooter,
  onResetToDefaults,
  viewbox = 480,
  orbitRadius = 160,
  nodeRadius = 40,
  plusRadius = 14,
  showFlowDecoration = true,
  transitionMs = 360,
}: ArtefactFlowTransitionDesignerProps) {
  const isControlled = controlledItems !== undefined;
  const [localItems, setLocalItems] = useState<OrbitItem[]>(defaultItems);
  const [counter, setCounter] = useState(0);
  const items = isControlled ? controlledItems! : localItems;

  // Anchor sticks the most-recently-inserted item to the clicked angle.
  const [anchor, setAnchor] = useState<{ id: string; angle: number } | null>(null);
  const lastBoundaryRef = useRef<number | null>(null);

  const CX = viewbox / 2;
  const CY = viewbox / 2;
  const FLOW_ARC_R = orbitRadius * 0.4 + 35;
  const OUTER_ARC_R = orbitRadius + plusRadius + 47;
  const OUTER_ARC_DEG = 16;
  const BOUNDARY_WEDGE_DEG = 10;

  const polar = useCallback(
    (angle: number, r: number) => ({ x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r }),
    [CX, CY],
  );
  const pct = useCallback((v: number) => `${(v / viewbox) * 100}%`, [viewbox]);

  const { positions, slots, crosses, boundaryAngleDeg } = useMemo(() => {
    const N = items.length;
    if (N === 0) return { positions: [], slots: [], crosses: [], boundaryAngleDeg: null as number | null };

    const { stateAngles, innerGap, wrapGap } = layoutAngles(N);

    type SlotSpec = { insertAt: number; angle: number; key: string };
    const rawSlots: SlotSpec[] = [];
    for (let i = 0; i < N - 1; i++) {
      rawSlots.push({ insertAt: i + 1, angle: stateAngles[i] + innerGap / 2, key: `inner-${i}` });
    }
    if (N >= 1) {
      const lastAngle = stateAngles[N - 1];
      rawSlots.push({ insertAt: N, angle: lastAngle + wrapGap / 3,       key: "wrap-after-last" });
      rawSlots.push({ insertAt: 0, angle: lastAngle + (2 * wrapGap) / 3, key: "wrap-before-first" });
    }

    let rotation = 0;
    if (anchor) {
      const anchorIdx = items.findIndex((n) => n.id === anchor.id);
      if (anchorIdx !== -1) rotation = anchor.angle - stateAngles[anchorIdx];
    }
    const rotated = (a: number) => a + rotation;

    const positions = items.map((n, i) => {
      const a = rotated(stateAngles[i]);
      const { x, y } = polar(a, orbitRadius);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      let labelPos: "top" | "right" | "bottom" | "left";
      if (Math.abs(cos) >= Math.abs(sin)) labelPos = cos >= 0 ? "right" : "left";
      else labelPos = sin >= 0 ? "bottom" : "top";
      return { item: n, x, y, angle: a, labelPos };
    });

    const slots = rawSlots.map((s) => {
      const a = rotated(s.angle);
      const { x, y } = polar(a, orbitRadius);
      return { insertAt: s.insertAt, key: s.key, x, y, angle: a };
    });

    const crosses: { key: string; x: number; y: number; rotDeg: number }[] = [];
    for (let i = 0; i < N - 1; i++) {
      const mid = rotated(stateAngles[i] + innerGap / 2);
      const { x, y } = polar(mid, OUTER_ARC_R);
      const rotDeg = (mid * 180) / Math.PI + 90;
      crosses.push({ key: `cross-${i}`, x, y, rotDeg });
    }

    let boundaryAngleDeg: number | null = null;
    if (N >= 1) {
      const a = rotated(stateAngles[N - 1]) + wrapGap / 2;
      const raw = (a * 180) / Math.PI + 90;
      const prev = lastBoundaryRef.current;
      if (prev === null) boundaryAngleDeg = raw;
      else {
        const delta = ((raw - prev) % 360 + 540) % 360 - 180;
        boundaryAngleDeg = prev + delta;
      }
    }

    return { positions, slots, crosses, boundaryAngleDeg };
  }, [items, anchor, orbitRadius, OUTER_ARC_R, polar]);

  if (boundaryAngleDeg !== null) lastBoundaryRef.current = boundaryAngleDeg;

  // Callbacks fire in BOTH modes so the page can observe inserts/removes for
  // toolbar counts etc. In controlled mode that's the only effect — the parent
  // must update `items`. In uncontrolled mode we also mutate local state.
  const handleInsert = useCallback((idx: number, clickAngle: number) => {
    controlledInsert?.(idx, clickAngle);
    if (isControlled) return;
    const n = counter + 1;
    setCounter(n);
    const colour = paletteForNewItems[(items.length + n) % paletteForNewItems.length];
    const newItem: OrbitItem = { id: `n-new-${n}`, label: newItemLabel(n), colour };
    setLocalItems((prev) => {
      const next = [...prev];
      next.splice(idx, 0, newItem);
      return next;
    });
    setAnchor({ id: newItem.id, angle: clickAngle });
  }, [isControlled, controlledInsert, counter, items.length, paletteForNewItems, newItemLabel]);

  const handleRemove = useCallback((id: string) => {
    controlledRemove?.(id);
    if (isControlled) return;
    setLocalItems((prev) => prev.filter((n) => n.id !== id));
    setAnchor((a) => (a && a.id === id ? null : a));
  }, [isControlled, controlledRemove]);

  const handleReset = useCallback(() => {
    if (onResetToDefaults) {
      onResetToDefaults();
      return;
    }
    if (isControlled) return;
    setLocalItems(defaultItems);
    setCounter(0);
    setAnchor(null);
  }, [onResetToDefaults, isControlled, defaultItems]);

  return (
    <div className="flow-rules__body aftd__body">
      {showRail && (
        <div className="flow-rules__rail aftd__rail" role="group" aria-label="Item list">
          <p className="flow-rules__eyebrow">{railEyebrow}</p>
          <ul className="flow-rules__rail-list">
            {items.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flow-rules__rail-row"
                  onClick={() => handleRemove(s.id)}
                  title={`Remove ${s.label}`}
                >
                  <span className="flow-rules__rail-dot" style={{ background: s.colour }} aria-hidden />
                  <span className="flow-rules__rail-name">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flow-rules__rail-footer">
            {railFooter ?? (
              <button type="button" className="btn btn--sm btn--ghost" onClick={handleReset}>
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flow-rules__canvas-wrap">
        <p className="flow-rules__eyebrow">{canvasEyebrow}</p>

        <div className="flow-rules__canvas-root aftd__canvas-root">
          <svg
            className="aftd__svg"
            viewBox={`0 0 ${viewbox} ${viewbox}`}
            aria-hidden
          >
            <defs>
              <marker id="aftd-arrow-inner" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
              </marker>
              <marker id="aftd-arrow-outer" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
              </marker>
              <pattern id="aftd-wedge-stripes" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(45)">
                <rect x="0" y="0" width="10" height="20" fill="#584400" />
                <rect x="10" y="0" width="10" height="20" fill="transparent" />
              </pattern>
            </defs>

            {showFlowDecoration && (
              <>
                <circle className="aftd__arc-track aftd__arc-track--outer" cx={CX} cy={CY} r={OUTER_ARC_R} />
                <circle className="aftd__arc-track" cx={CX} cy={CY} r={FLOW_ARC_R} />
              </>
            )}

            {showFlowDecoration && boundaryAngleDeg !== null && (
              <g
                className="aftd__boundary-group"
                style={{
                  transform: `rotate(${boundaryAngleDeg}deg)`,
                  transformOrigin: `${CX}px ${CY}px`,
                  transition: `transform ${transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                }}
              >
                <path
                  className="aftd__boundary-wedge"
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
                <path
                  className="aftd__flow-arc aftd__flow-arc--inner"
                  d={`M ${CX} ${CY - FLOW_ARC_R} A ${FLOW_ARC_R} ${FLOW_ARC_R} 0 0 1 ${
                    CX + Math.sin((30 * Math.PI) / 180) * FLOW_ARC_R
                  } ${
                    CY - Math.cos((30 * Math.PI) / 180) * FLOW_ARC_R
                  }`}
                  markerEnd="url(#aftd-arrow-inner)"
                />
                <path
                  className="aftd__flow-arc aftd__flow-arc--outer"
                  d={`M ${
                    CX - Math.sin((OUTER_ARC_DEG * Math.PI) / 180) * OUTER_ARC_R
                  } ${
                    CY - Math.cos((OUTER_ARC_DEG * Math.PI) / 180) * OUTER_ARC_R
                  } A ${OUTER_ARC_R} ${OUTER_ARC_R} 0 0 1 ${CX} ${CY - OUTER_ARC_R}`}
                  markerEnd="url(#aftd-arrow-outer)"
                />
              </g>
            )}

            {showFlowDecoration && crosses.map(({ key, x, y, rotDeg }) => (
              <g
                key={key}
                className="aftd__cross"
                style={{
                  transform: `translate(${x}px, ${y}px) rotate(${rotDeg}deg)`,
                  transformOrigin: `0 0`,
                  transformBox: "view-box",
                  transition: `transform ${transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                }}
              >
                <line x1="0" y1="-7" x2="0" y2="7" />
                <line x1="-7" y1="0" x2="7" y2="0" />
              </g>
            ))}
          </svg>

          {positions.map(({ item, x, y, labelPos }) => (
            <button
              key={item.id}
              type="button"
              className="aftd__node"
              title={`Click to remove ${item.label}`}
              aria-label={`Remove ${item.label}`}
              style={{
                left: pct(x),
                top:  pct(y),
                width: pct(nodeRadius * 2),
                transition: `left ${transitionMs}ms cubic-bezier(0.4,0,0.2,1), top ${transitionMs}ms cubic-bezier(0.4,0,0.2,1), width ${transitionMs}ms ease`,
              }}
              onClick={() => handleRemove(item.id)}
            >
              <div className={`aftd__node-label aftd__node-label--${labelPos}`}>
                {item.label}
              </div>
            </button>
          ))}

          {slots.map(({ insertAt: idx, key, x, y, angle }) => (
            <button
              key={key}
              type="button"
              className="aftd__plus"
              title="Insert here"
              aria-label="Insert here"
              style={{
                left: pct(x),
                top:  pct(y),
                width: pct(plusRadius * 2),
                transition: `left ${transitionMs}ms cubic-bezier(0.4,0,0.2,1), top ${transitionMs}ms cubic-bezier(0.4,0,0.2,1), background 160ms ease, color 160ms ease, border-color 160ms ease, transform 160ms ease`,
              }}
              onClick={() => handleInsert(idx, angle)}
            >
              <span className="aftd__plus-glyph">+</span>
            </button>
          ))}
        </div>
      </div>

      <style jsx>{`
        /* The PoC sets a min-height on the rail so the canvas-wrap doesn't
           push the row taller. Scoped to this component only via the
           aftd__body wrapper. */
        .aftd__body :global(.flow-rules__rail) {
          min-height: 590px;
        }
        .aftd__body :global(.flow-rules__canvas-root) {
          width: 520px;
          height: 520px;
        }
        .aftd__svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          overflow: visible;
        }
        .aftd__flow-arc {
          fill: none;
          stroke: #ffffff;
          stroke-width: 2;
          stroke-linecap: round;
          display: none;
        }
        .aftd__flow-arc--inner { stroke: #22c55e; }
        .aftd__flow-arc--outer { stroke: #ef4444; }
        .aftd__boundary-wedge {
          fill: url(#aftd-wedge-stripes);
          stroke: var(--border);
          stroke-width: 1;
        }
        .aftd__arc-track {
          fill: none;
          stroke: var(--border);
          stroke-width: 1;
          display: none;
        }
        .aftd__arc-track--outer {
          display: block;
          stroke-dasharray: 20 10;
        }
        .aftd__cross line {
          stroke: var(--border);
          stroke-width: 1.5;
          stroke-linecap: round;
        }
        .aftd__node {
          position: absolute;
          transform: translate(-50%, -50%);
          padding: 0;
          border: 1px solid var(--border);
          background: transparent;
          border-radius: 50%;
          aspect-ratio: 1 / 1;
          height: auto;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .aftd__node-label {
          position: absolute;
          font-size: 0.95rem;
          color: var(--ink);
          white-space: nowrap;
          pointer-events: none;
        }
        .aftd__node-label--top    { bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); }
        .aftd__node-label--bottom { top:    calc(100% + 6px); left: 50%; transform: translateX(-50%); }
        .aftd__node-label--left   { right:  calc(100% + 8px); top: 50%;  transform: translateY(-50%); }
        .aftd__node-label--right  { left:   calc(100% + 8px); top: 50%;  transform: translateY(-50%); }

        .aftd__plus {
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
        }
        .aftd__plus:hover {
          background: var(--accent, #3b82f6);
          color: white;
          border-color: var(--accent, #3b82f6);
          transform: translate(-50%, -50%) scale(1.15);
        }
        .aftd__plus-glyph {
          font-size: 1rem;
          line-height: 1;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
