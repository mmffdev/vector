"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

// N-cell variant of ToggleBtn. The accent blob floods from the active
// cell to the newly selected one using the same two-step lava-lamp
// timeline as ToggleBtn (power3.in extend → elastic.out retract), but
// generalised to N segments. The blob lives in cell-fraction space:
// each cell is `1/N` wide; the blob's left/right edges are expressed
// as percentages of the container so they overshoot end walls by 20%
// (same as ToggleBtn) when the active cell is at either end.
//
// Behaviour at the ends matches ToggleBtn exactly:
//   • Active cell 0  → left: -20%, right: (N-1)/N * 100%
//   • Active cell N-1 → left: (N-1)/N * 100%, right: -20%
// Interior cells use clean cell boundaries (no overshoot needed since
// the pill caps remain hidden by neighbour cells).

export type ToggleBtnOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
};

export default function ToggleBtnN<T extends string>({
  value,
  onChange,
  options,
  size = "default",
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<ToggleBtnOption<T>>;
  size?: "default" | "sm";
  ariaLabel?: string;
  /** Extra class on the outer pill — e.g. for an accent-coloured variant. */
  className?: string;
}) {
  const blobRef = useRef<HTMLDivElement>(null);
  const prevIdx = useRef<number | null>(null);
  const n = options.length;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    const blob = blobRef.current;
    if (!blob) return;
    const last = n - 1;
    const cellPct = 100 / n;

    // Position helpers: at the ends we overshoot 20% to hide pill caps;
    // in the interior we sit exactly on cell boundaries.
    const leftFor = (i: number) => (i === 0 ? "-20%" : `${i * cellPct}%`);
    const rightFor = (i: number) => (i === last ? "-20%" : `${(last - i) * cellPct}%`);

    if (prevIdx.current === null) {
      gsap.set(blob, { left: leftFor(idx), right: rightFor(idx) });
      prevIdx.current = idx;
      return;
    }
    if (prevIdx.current === idx) return; // strict-mode double-run guard
    const from = prevIdx.current;
    prevIdx.current = idx;

    gsap.killTweensOf(blob);
    const movingRight = idx > from;
    const tl = gsap.timeline();
    if (movingRight) {
      // Extend the trailing (right) edge to the destination first, then
      // pull the leading (left) edge across — produces a flood-then-retract.
      tl.to(blob, { right: rightFor(idx), duration: 0.2, ease: "power3.in" })
        .to(blob, { left: leftFor(idx), duration: 0.35, ease: "elastic.out(1, 0.6)" });
    } else {
      tl.to(blob, { left: leftFor(idx), duration: 0.2, ease: "power3.in" })
        .to(blob, { right: rightFor(idx), duration: 0.35, ease: "elastic.out(1, 0.6)" });
    }
  }, [idx, n]);

  return (
    <div
      className={`toggle-btn${size === "sm" ? " toggle-btn--sm" : ""}${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={ariaLabel}
      data-value={value}
    >
      <div className="toggle-btn__blob" ref={blobRef} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="toggle-btn__cell"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
