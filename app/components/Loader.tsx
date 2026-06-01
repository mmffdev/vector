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
      <div className="loader__threedotsradial_Orbit" aria-hidden="true">
        {Array.from({ length: THREEDOTSRADIAL_DOTS }).map((_, i) => (
          <div
            key={i}
            className="loader__threedotsradial_Slot"
            style={{ "--loader__threedotsradial-i": String(i) } as CSSProperties}
          >
            <span className="loader__threedotsradial_Slot_Ghost" />
            <span className="loader__threedotsradial_Slot_Dot" />
          </div>
        ))}
      </div>
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
