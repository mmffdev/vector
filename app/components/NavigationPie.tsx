"use client";

// <NavigationPie> — multi-select filter primitive that renders option
// segments as wedges of a full circle around the chip. Click a wedge to
// toggle white ↔ filled; onChange fires immediately (no batched commit).
//
// Singleton: only one pie open at a time across the page. Click the chip
// again, ESC, a pointer that leaves the bounding circle, or rolling over
// another navigation-pie chip all close the active pie.
//
// Geometry: full 360° circle, wedge size = 2π / N. Slice angles start at
// −π/2 (12 o'clock) and rotate clockwise so the first option is at the
// top. Labels are positioned at the wedge's mid-radius along its bisector.

import React, {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface NavigationPieOption {
  value: string;
  label: string;
}

interface NavigationPieProps {
  label: string;
  icon?: ReactNode;
  options: NavigationPieOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Outer radius in px. Default 200. */
  radius?: number;
  /** Inner hub radius in px. Default 56 — wide enough to host the chip. */
  innerRadius?: number;
}

interface ChipBox { cx: number; cy: number }

// Cross-instance singleton: only one pie open at a time across the page.
// When a chip opens, it stores its close-callback here; any later open call
// invokes the previous close first. Sibling-chip pointer-rollover also
// dismisses via this hook (no cross-component refs needed).
let activeClose: ((commit: boolean) => void) | null = null;
function registerActive(close: (commit: boolean) => void) {
  if (activeClose && activeClose !== close) activeClose(true);
  activeClose = close;
}
function unregisterActive(close: (commit: boolean) => void) {
  if (activeClose === close) activeClose = null;
}

// SVG path for an annular wedge from `startAngle` to `endAngle` around
// `(cx, cy)`, between innerRadius and outerRadius. Angles are radians.
function wedgePath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
): string {
  const x0 = cx + rOuter * Math.cos(startAngle);
  const y0 = cy + rOuter * Math.sin(startAngle);
  const x1 = cx + rOuter * Math.cos(endAngle);
  const y1 = cy + rOuter * Math.sin(endAngle);
  const x2 = cx + rInner * Math.cos(endAngle);
  const y2 = cy + rInner * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(startAngle);
  const y3 = cy + rInner * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x3} ${y3}`,
    "Z",
  ].join(" ");
}

export default function NavigationPie({
  label,
  icon,
  options,
  selected,
  onChange,
  radius = 200,
  innerRadius = 56,
}: NavigationPieProps) {
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState<ChipBox | null>(null);

  useLayoutEffect(() => {
    if (!open || !chipRef.current) return;
    const r = chipRef.current.getBoundingClientRect();
    setChip({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  }, [open]);

  const closeRef = useRef<(commit: boolean) => void>(() => {});
  const close = useCallback(() => {
    setOpen(false);
    setChip(null);
    unregisterActive(closeRef.current);
  }, []);
  closeRef.current = close;

  // Pointer-leave + sibling-chip-rollover dismissal.
  useEffect(() => {
    if (!open || !chip) return;
    const exitR = radius + 24;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - chip.cx;
      const dy = e.clientY - chip.cy;
      if (Math.hypot(dx, dy) > exitR) close();
    };

    const onOver = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      const sibling = target.closest?.(".navigation-pie__Chip");
      if (sibling && sibling !== chipRef.current) close();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerover", onOver);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, chip, radius, close]);

  const toggle = useCallback(
    (value: string) => {
      const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value];
      onChange(next);
    },
    [selected, onChange],
  );

  const handleChipClick = useCallback(() => {
    if (open) close();
    else {
      registerActive(closeRef.current);
      setOpen(true);
    }
  }, [open, close]);

  const active = selected.length > 0;
  const count = selected.length;

  // Slice geometry. Start at -π/2 (12 o'clock) and rotate clockwise so the
  // first option occupies the top wedge. Label position = midpoint of
  // (rInner + rOuter)/2 along the wedge bisector.
  const slices = useMemo(() => {
    if (!chip) return [];
    const N = options.length;
    if (N === 0) return [];
    const step = (Math.PI * 2) / N;
    const start = -Math.PI / 2 - step / 2;
    const rMid = (innerRadius + radius) / 2;
    return options.map((opt, i) => {
      const a0 = start + i * step;
      const a1 = a0 + step;
      const bisector = a0 + step / 2;
      const labelX = chip.cx + rMid * Math.cos(bisector);
      const labelY = chip.cy + rMid * Math.sin(bisector);
      return {
        opt,
        path: wedgePath(chip.cx, chip.cy, innerRadius, radius, a0, a1),
        labelX,
        labelY,
        isSelected: selected.includes(opt.value),
      };
    });
  }, [options, chip, innerRadius, radius, selected]);

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={
          "navigation-pie__Chip" +
          (active ? " navigation-pie__Chip-active" : "") +
          (open ? " navigation-pie__Chip-open" : "")
        }
        onClick={handleChipClick}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon ? <span className="navigation-pie__Chip_icon">{icon}</span> : null}
        <span className="navigation-pie__Chip_label">{label}</span>
        {count >= 2 ? (
          <span className="navigation-pie__Chip_count">{count}</span>
        ) : null}
      </button>

      {open && chip ? (
        <div
          className="navigation-pie__Pop"
          role="listbox"
          aria-label={`${label} options`}
        >
          <svg
            className="navigation-pie__Pop_svg"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              pointerEvents: "none",
              zIndex: 2147483001,
              overflow: "visible",
            }}
          >
            {slices.map(({ opt, path, isSelected }) => (
              <path
                key={`seg-${opt.value}`}
                role="option"
                aria-label={opt.label}
                aria-selected={isSelected}
                className={
                  "navigation-pie__Pop_segment" +
                  (isSelected ? " navigation-pie__Pop_segment-selected" : "")
                }
                d={path}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(opt.value);
                }}
                style={{ pointerEvents: "auto", cursor: "pointer" }}
              />
            ))}
          </svg>
          {slices.map(({ opt, labelX, labelY, isSelected }) => (
            <span
              key={`label-${opt.value}`}
              className={
                "navigation-pie__Pop_label" +
                (isSelected ? " navigation-pie__Pop_label-selected" : "")
              }
              style={{
                position: "fixed",
                left: labelX,
                top: labelY,
                transform: "translate(-50%, -50%)",
                zIndex: 2147483002,
                pointerEvents: "none",
              }}
            >
              {opt.label}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
