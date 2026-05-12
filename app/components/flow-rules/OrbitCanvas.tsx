"use client";

import { useId, useMemo, useRef } from "react";
import type { FlowState } from "@/app/lib/flowStatesApi";
import { has, type RuleKey } from "./rules";

const ORBIT_NODE_R_BASE = 40;
const CENTRE_R_BASE = 52;
const ORBIT_R_BASE = 160;
const CENTRE_OFFSET = CENTRE_R_BASE;
const VIEWBOX_W = 480;
const VIEWBOX_H = 480;
const CX = VIEWBOX_W / 2;
const CY = VIEWBOX_H / 2;

export type OrbitCanvasProps = {
  focused: FlowState;
  orbiting: FlowState[];
  rules: Set<RuleKey>;
  busyKey: RuleKey | null;
  onToggle: (to: FlowState) => void;
};

export default function OrbitCanvas({ focused, orbiting, rules, busyKey, onToggle }: OrbitCanvasProps) {
  const markerId = useId();
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const { ORBIT_R, NODE_R } = useMemo(() => {
    const n = orbiting.length;
    if (n <= 8) return { ORBIT_R: ORBIT_R_BASE, NODE_R: ORBIT_NODE_R_BASE };
    const scale = Math.min(1.35, 1 + (n - 8) * 0.04);
    return {
      ORBIT_R: Math.round(ORBIT_R_BASE * scale),
      NODE_R:  Math.max(22, Math.round(ORBIT_NODE_R_BASE / Math.sqrt(scale))),
    };
  }, [orbiting.length]);

  const positions = useMemo(() => {
    return orbiting.map((s, i) => {
      const angle = (-Math.PI / 2) + (i / orbiting.length) * 2 * Math.PI;
      return {
        state: s,
        x: CX + Math.cos(angle) * ORBIT_R,
        y: CY + Math.sin(angle) * ORBIT_R,
        angle,
      };
    });
  }, [orbiting, ORBIT_R]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nodeRefs.current.get(orbiting[(idx + 1) % orbiting.length].id)?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nodeRefs.current.get(orbiting[(idx - 1 + orbiting.length) % orbiting.length].id)?.focus();
    }
  }

  // Percentage positions for HTML overlay (relative to container)
  const pctX = (x: number) => `${(x / VIEWBOX_W) * 100}%`;
  const pctY = (y: number) => `${(y / VIEWBOX_H) * 100}%`;
  // Node diameter as percentage of container width
  const nodePct = `${(NODE_R * 2 / VIEWBOX_W) * 100}%`;
  const centrePct = `${(CENTRE_R_BASE * 2 / VIEWBOX_W) * 100}%`;

  return (
    <div className="flow-rules__canvas-root" style={{ aspectRatio: `${VIEWBOX_W}/${VIEWBOX_H}` }}>
      {/* SVG layer — arrows only */}
      <svg
        className="flow-rules__canvas-svg"
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        aria-hidden
      >
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)" />
          </marker>
        </defs>
        {positions.map(({ state, x, y, angle }) => {
          if (!has(rules, focused.id, state.id)) return null;
          const sx = CX + Math.cos(angle) * CENTRE_OFFSET;
          const sy = CY + Math.sin(angle) * CENTRE_OFFSET;
          const tx = x - Math.cos(angle) * NODE_R;
          const ty = y - Math.sin(angle) * NODE_R;
          return (
            <line
              key={`arrow-${state.id}`}
              x1={sx} y1={sy} x2={tx} y2={ty}
              stroke="var(--border)"
              strokeWidth={1}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
      </svg>

      {/* HTML layer — nodes with CSS shadows */}
      {/* Centre node — always raised (it IS the source state) */}
      <div
        className="flow-rules__node flow-rules__node--raised flow-rules__node--centre"
        style={{
          left: pctX(CX),
          top:  pctY(CY),
          width: centrePct,
          paddingBottom: centrePct,
        }}
        aria-label={`Source: ${focused.name}`}
      >
        <div
          className="flow-rules__node-inner flow-rules__node--inset"
          style={{ background: focused.colour ?? "#e8eae9" }}
        />
        <div className="flow-rules__node-label">
          <span>{focused.name}</span>
        </div>
      </div>

      {/* Orbit nodes */}
      {positions.map(({ state, x, y, angle }, idx) => {
        const allowed = has(rules, focused.id, state.id);
        const loading = busyKey === `${focused.id}>${state.id}`;
        // Pick label placement by quadrant of the angle. -PI/2 = top, 0 = right, PI/2 = bottom, ±PI = left
        // Use ±PI/4 thresholds around each cardinal direction.
        const cos = Math.cos(angle), sin = Math.sin(angle);
        let labelPos: "top" | "right" | "bottom" | "left";
        if (Math.abs(cos) >= Math.abs(sin)) {
          labelPos = cos >= 0 ? "right" : "left";
        } else {
          labelPos = sin >= 0 ? "bottom" : "top";
        }
        return (
          <button
            key={state.id}
            ref={(el) => {
              if (el) nodeRefs.current.set(state.id, el);
              else nodeRefs.current.delete(state.id);
            }}
            type="button"
            aria-pressed={allowed}
            aria-label={allowed ? `Block move from ${focused.name} to ${state.name}` : `Allow move from ${focused.name} to ${state.name}`}
            aria-busy={loading || undefined}
            disabled={loading}
            className={`flow-rules__node${allowed ? " flow-rules__node--inset" : " flow-rules__node--raised"}${loading ? " is-busy" : ""}`}
            style={{
              left: pctX(x),
              top:  pctY(y),
              width: nodePct,
              paddingBottom: nodePct,
            }}
            onClick={() => onToggle(state)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            <div
              className={`flow-rules__node-inner${allowed ? " flow-rules__node--raised" : " flow-rules__node--inset"}`}
              style={{ background: state.colour ?? "#e8eae9" }}
            />
            <div className={`flow-rules__node-label flow-rules__node-label--${labelPos}`}>
              <span>{state.name}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
