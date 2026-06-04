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
import { useRouter } from "next/navigation";

export interface NavigationPieOption {
  value: string;
  label: string;
  /**
   * Optional URL. When present, clicking the wedge navigates to `url`
   * (via `next/navigation` router.push) instead of toggling the value in
   * `selected`. Lets the same pie serve as a filter chip (no url) OR a
   * radial nav menu (url per wedge). Absolute paths or full URLs both OK;
   * full URLs fall through to `window.location.assign`.
   */
  url?: string;
  /**
   * Optional wedge colour (any CSS colour string — hex, var(), oklch…).
   * Rendered as a 10px coloured band hugging the inner edge of the
   * wedge (Arma-radial style legend ring around the hub). The wedge body
   * stays black so on/off contrast is driven by opacity, not hue. Used
   * by the artefact-type picker where each type carries its own brand
   * colour. Omit to render no band.
   */
  color?: string;
}

interface NavigationPieProps {
  label: string;
  icon?: ReactNode;
  options: NavigationPieOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Extra class for the trigger chip. Keeps callers on the shared pie
   *  geometry while letting an existing action bar own its button slot. */
  chipClassName?: string;
  /** Pick-one callers such as create actions close after the wedge click;
   *  filter chips omit this so users can multi-select several wedges. */
  closeOnPick?: boolean;
  /** Multi-select by default. Single-select callers replace the selected
   *  value with the picked wedge and do not toggle it off. */
  selectionMode?: "multi" | "single";
  /** Outer radius in px. Default 90. */
  radius?: number;
  /** Inner hub radius in px. Default 26 — kept proportional to the
   *  outer radius (was 56 when outer was 200). */
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

// SVG path for a wedge whose two side edges are STRAIGHT CHORDS
// perpendicular to the gap lines between this wedge and its neighbours.
// Result: the empty space between adjacent wedges is a constant-width
// rectangular slot (Arma-radial style); each wedge's side edges run
// PARALLEL to its neighbours' facing edges across the gap.
//
// `bisector` is the wedge's centre angle (radians). `step` is the full
// angular span the wedge would occupy if there were no gap (2π / N).
// `gapPx` is the perpendicular pixel distance separating adjacent
// wedges. The two gap lines are at angles bisector ± step/2.
function wedgePath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  bisector: number,
  step: number,
  gapPx: number,
): string {
  const halfGap = gapPx / 2;
  const gapAngleCCW = bisector - step / 2;
  const gapAngleCW = bisector + step / 2;

  // For each gap line at angle θ, the line direction is (cos θ, sin θ).
  // We need the wedge edge OFFSET perpendicular to this line by halfGap,
  // on the side of the wedge bisector. The perpendicular component
  // pointing toward the bisector = sign(cross(gapDir, bisectorDir)) * 90°
  // rotation of gapDir. For the CCW gap (angle < bisector), the wedge
  // is at MORE positive angle → 90° CCW rotation of gapDir.
  // For the CW gap (angle > bisector), the wedge is at LESS positive
  // angle → 90° CW rotation. 90° CCW rotation of (x,y) = (-y, x).
  function edgePoint(gapAngle: number, rotateCCW: boolean, r: number) {
    const dx = Math.cos(gapAngle);
    const dy = Math.sin(gapAngle);
    // Perpendicular toward the bisector.
    const px = rotateCCW ? -dy : dy;
    const py = rotateCCW ? dx : -dx;
    // Edge line passes through (cx + halfGap*px, cy + halfGap*py) in
    // direction (dx, dy). Intersection with circle radius r is at
    // signed parameter t where (halfGap*px + t*dx)² + (halfGap*py + t*dy)² = r².
    // Since (px,py)⊥(dx,dy) and both are unit vectors, this simplifies to
    //   halfGap² + t² = r²  →  t = ±sqrt(r² - halfGap²)
    // We take the outward (+) root.
    const t = Math.sqrt(Math.max(0, r * r - halfGap * halfGap));
    return {
      x: cx + halfGap * px + t * dx,
      y: cy + halfGap * py + t * dy,
    };
  }

  const innerCCW = edgePoint(gapAngleCCW, true, rInner);
  const outerCCW = edgePoint(gapAngleCCW, true, rOuter);
  const innerCW = edgePoint(gapAngleCW, false, rInner);
  const outerCW = edgePoint(gapAngleCW, false, rOuter);

  const largeArc = step > Math.PI ? 1 : 0;

  return [
    `M ${innerCCW.x} ${innerCCW.y}`,
    `L ${outerCCW.x} ${outerCCW.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerCW.x} ${outerCW.y}`,
    `L ${innerCW.x} ${innerCW.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerCCW.x} ${innerCCW.y}`,
    "Z",
  ].join(" ");
}

export default function NavigationPie({
  label,
  icon,
  options,
  selected,
  onChange,
  chipClassName,
  closeOnPick = false,
  selectionMode = "multi",
  radius = 90,
  innerRadius = 26,
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
      const sibling = target.closest?.("[data-nav-pie-chip]");
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
      if (selectionMode === "single") {
        onChange([value]);
        return;
      }
      const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value];
      onChange(next);
    },
    [selectionMode, selected, onChange],
  );

  // Lazy router. Only acquired when the user clicks a wedge that carries
  // a `url` — keeps the pie renderable outside an App Router boundary
  // (e.g. unit tests, static-storybook contexts) when no caller uses urls.
  const routerRef = useRef<ReturnType<typeof useRouter> | null>(null);
  const hasUrl = useMemo(() => options.some((o) => !!o.url), [options]);

  const pickWedge = useCallback(
    (opt: NavigationPieOption) => {
      if (opt.url) {
        close();
        if (/^https?:\/\//i.test(opt.url)) {
          window.location.assign(opt.url);
        } else if (routerRef.current) {
          routerRef.current.push(opt.url);
        } else {
          window.location.assign(opt.url);
        }
        return;
      }
      toggle(opt.value);
      if (closeOnPick) close();
    },
    [toggle, close, closeOnPick],
  );

  const handleChipClick = useCallback(() => {
    if (open) close();
    // Don't open with an empty options list — the chip would hide itself
    // (inline style visibility:hidden when open) and the pie would
    // render zero wedges, leaving an invisible no-op trigger. Stay closed
    // so the user sees the chip and can tell nothing's available yet.
    else if (options.length > 0) {
      registerActive(closeRef.current);
      setOpen(true);
    }
  }, [open, close, options.length]);

  const active = selected.length > 0;
  const count = selected.length;

  // Slice geometry. Start at -π/2 (12 o'clock) and rotate clockwise so the
  // first option occupies the top wedge. Wedges are bounded by GAP LINES
  // — straight strips of fixed pixel width sitting between adjacent
  // wedges. Each wedge's two side edges are perpendicular to its two
  // bounding gaps, so adjacent wedges' facing edges are PARALLEL across
  // the gap (matches the Arma-radial reference where gaps look like
  // ruler-cut slots rather than radial slivers).
  //
  // A second path (BAND_PX wide on the inner edge) carries the option's
  // custom colour, acting as a legend ring around the hub.
  const slices = useMemo(() => {
    if (!chip) return [];
    const N = options.length;
    if (N === 0) return [];
    const GAP_PX = 4;                  // perpendicular pixel gap between wedges
    const BAND_PX = 10;                // thickness of the inner colour band
    const step = (Math.PI * 2) / N;
    const rMid = (innerRadius + radius) / 2;
    const rBandOuter = innerRadius + BAND_PX;
    // For N wedges starting at top, wedge i has bisector at
    //   bisector_i = -π/2 + i*step
    // The gap BETWEEN wedge i-1 and i sits at the midpoint:
    //   gap_i = bisector_i - step/2 = -π/2 + (i - 0.5)*step
    // So wedge i is bounded by gap_i (CCW side) and gap_{i+1} (CW side).
    return options.map((opt, i) => {
      const bisector = -Math.PI / 2 + i * step;
      const labelX = chip.cx + rMid * Math.cos(bisector);
      const labelY = chip.cy + rMid * Math.sin(bisector);
      return {
        opt,
        path: wedgePath(
          chip.cx, chip.cy, innerRadius, radius, bisector, step, GAP_PX,
        ),
        bandPath: wedgePath(
          chip.cx, chip.cy, innerRadius, rBandOuter, bisector, step, GAP_PX,
        ),
        labelX,
        labelY,
        isSelected: selected.includes(opt.value),
      };
    });
  }, [options, chip, innerRadius, radius, selected]);

  return (
    <>
      {hasUrl ? <RouterCapture targetRef={routerRef} /> : null}
      <button
        ref={chipRef}
        type="button"
        data-nav-pie-chip=""
        className={
          "btn btn--primary" +
          (chipClassName ? ` ${chipClassName}` : "") +
          (active ? " is-active" : "")
        }
        style={open ? { visibility: "hidden" } : undefined}
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
            {slices.map(({ opt, path, bandPath, isSelected }) => (
              <React.Fragment key={`seg-${opt.value}`}>
                <path
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
                    pickWedge(opt);
                  }}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                />
                {opt.color ? (
                  <path
                    className="navigation-pie__Pop_band"
                    d={bandPath}
                    style={{ fill: opt.color, pointerEvents: "none" }}
                  />
                ) : null}
              </React.Fragment>
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

// Mounted only when at least one option carries a `url`. Grabs the App
// Router and parks it on the parent's ref. Keeps `useRouter` out of the
// pie's main render path, so url-free callers don't need a router
// context (matters for tests + isolated previews).
function RouterCapture({
  targetRef,
}: {
  targetRef: React.MutableRefObject<ReturnType<typeof useRouter> | null>;
}) {
  const router = useRouter();
  targetRef.current = router;
  return null;
}
