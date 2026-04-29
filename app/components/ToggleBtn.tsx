"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

// Two-cell animated toggle. The accent blob floods from the active cell to the
// newly selected one, overshooting the container walls so the pill caps stay
// hidden — only the interior curved edge is visible inside the frame.
//
// Usage:
//   <ToggleBtn value={enabled} onChange={setEnabled} />
//   <ToggleBtn value={v} onChange={setV} labels={["Manual", "Drag & drop"]} />
//   <ToggleBtn value={v} onChange={setV} size="sm" />

export default function ToggleBtn({
  value,
  onChange,
  labels = ["No", "Yes"] as [string, string],
  size = "default",
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  /** [falseLabel, trueLabel] — defaults to ["No", "Yes"] */
  labels?: [string, string];
  size?: "default" | "sm";
}) {
  const blobRef = useRef<HTMLDivElement>(null);
  const prevValue = useRef<boolean | null>(null);

  useEffect(() => {
    const blob = blobRef.current;
    if (!blob) return;

    if (prevValue.current === null) {
      // Mount — snap into position; overshoot walls so pill caps hide
      gsap.set(blob, value ? { left: "50%", right: "-20%" } : { left: "-20%", right: "50%" });
      prevValue.current = value;
      return;
    }

    if (prevValue.current === value) return; // strict-mode double-run guard
    prevValue.current = value;

    gsap.killTweensOf(blob);

    if (value) {
      gsap.timeline()
        .to(blob, { right: "-20%", duration: 0.2, ease: "power3.in" })
        .to(blob, { left: "50%", duration: 0.35, ease: "elastic.out(1, 0.6)" });
    } else {
      gsap.timeline()
        .to(blob, { left: "-20%", duration: 0.2, ease: "power3.in" })
        .to(blob, { right: "50%", duration: 0.35, ease: "elastic.out(1, 0.6)" });
    }
  }, [value]);

  return (
    <div className={`toggle-btn${size === "sm" ? " toggle-btn--sm" : ""}`}>
      <div className="toggle-btn__blob" ref={blobRef} />
      <button
        type="button"
        className="toggle-btn__cell"
        onClick={() => onChange(false)}
        aria-pressed={!value}
      >
        {labels[0]}
      </button>
      <button
        type="button"
        className="toggle-btn__cell"
        onClick={() => onChange(true)}
        aria-pressed={value}
      >
        {labels[1]}
      </button>
    </div>
  );
}
