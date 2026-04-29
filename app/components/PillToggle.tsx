"use client";

import { useState } from "react";

// iOS-style pill toggle. Colors come from the active theme via
// --pill-toggle-on (defaults to --accent) and --pill-toggle-off (defaults to --border-strong).
// Override per-instance via style={{ "--pill-toggle-on": "var(--good)" }}.
//
// Usage:
//   <PillToggle />                              uncontrolled
//   <PillToggle value={v} onChange={setV} />   controlled

export default function PillToggle({
  value,
  onChange,
}: {
  value?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [internal, setInternal] = useState(false);
  const checked = onChange !== undefined ? (value ?? false) : internal;

  function toggle() {
    if (onChange !== undefined) {
      onChange(!checked);
    } else {
      setInternal((v) => !v);
    }
  }

  return (
    <div
      className={`pill-toggle${checked ? " is-on" : ""}`}
      onClick={toggle}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && toggle()}
    >
      <span className="pill-toggle__label">
        <span className="pill-toggle__track">
          <span className="pill-toggle__txt" />
        </span>
        <span className="pill-toggle__thumb">|||</span>
      </span>
    </div>
  );
}
