"use client";

import type { CSSProperties } from "react";

export type LoaderType = "helix" | "threedotsradial";

type LoaderProps = {
  type: LoaderType;
  label?: string;
  size?: number;
  className?: string;
};

const HELIX_RUNGS = 12;
const THREEDOTSRADIAL_DOTS = 3;

function HelixLoader({ label, size }: { label: string; size: number }) {
  const style: CSSProperties & Record<string, string> = {
    "--loader__helix-size": `${size}px`,
  };

  return (
    <div
      className="loader__helix"
      style={style}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="loader__helix_Stage" aria-hidden="true">
        {Array.from({ length: HELIX_RUNGS }).map((_, i) => (
          <div
            key={i}
            className="loader__helix_Rung"
            style={{ "--loader__helix-i": String(i) } as CSSProperties}
          >
            <span className="loader__helix_Rung_NodeL" />
            <span className="loader__helix_Rung_BarL" />
            <span className="loader__helix_Rung_BarR" />
            <span className="loader__helix_Rung_NodeR" />
          </div>
        ))}
      </div>
      <span className="loader__helix_SrLabel">{label}</span>
    </div>
  );
}

function ThreeDotsRadialLoader({ label, size }: { label: string; size: number }) {
  // Geometry — SVG viewBox is 100×100 abstract units so the geometry
  // numbers below stay readable. CSS scales the rendered size.
  const VB = 100;
  const CENTRE = VB / 2;
  const ORBIT_R = 38; // arc radius inside the viewBox
  const STROKE = 7;   // dot/trail thickness
  const CIRC = 2 * Math.PI * ORBIT_R;
  const ARC_LEN = CIRC * 0.18; // ~65° trailing arc per dot
  const GAP = CIRC - ARC_LEN;
  const style: CSSProperties & Record<string, string> = {
    "--loader__threedotsradial-size": `${size}px`,
  };

  return (
    <div
      className="loader__threedotsradial"
      style={style}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <svg
        className="loader__threedotsradial_Svg"
        viewBox={`0 0 ${VB} ${VB}`}
        aria-hidden="true"
      >
        <g className="loader__threedotsradial_Svg_Orbit">
          {Array.from({ length: THREEDOTSRADIAL_DOTS }).map((_, i) => (
            <circle
              key={i}
              className="loader__threedotsradial_Svg_Trail"
              cx={CENTRE}
              cy={CENTRE}
              r={ORBIT_R}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${ARC_LEN} ${GAP}`}
              style={
                {
                  "--loader__threedotsradial-i": String(i),
                  transform: `rotate(${i * 120}deg)`,
                } as CSSProperties
              }
            />
          ))}
        </g>
      </svg>
      <span className="loader__threedotsradial_SrLabel">{label}</span>
    </div>
  );
}

export function Loader({
  type,
  label = "Loading…",
  size = 96,
  className,
}: LoaderProps) {
  const wrapperClass = `loader${className ? ` ${className}` : ""}`;

  switch (type) {
    case "helix":
      return (
        <div className={wrapperClass}>
          <HelixLoader label={label} size={size} />
        </div>
      );
    case "threedotsradial":
      return (
        <div className={wrapperClass}>
          <ThreeDotsRadialLoader
            label={label}
            size={size === 96 ? 30 : size}
          />
        </div>
      );
    default: {
      const exhaustive: never = type;
      void exhaustive;
      return null;
    }
  }
}

export default Loader;
