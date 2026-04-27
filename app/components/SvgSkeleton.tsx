import type { ReactNode } from 'react'

type SvgSkeletonProps = {
  /** Unique ID — used to namespace the gradient and clipPath elements. */
  id: string
  /** SVG viewBox, e.g. "0 0 320 200". */
  viewBox: string
  /** Defaults to "100%". */
  width?: string
  /** Optional fixed height; if omitted the SVG scales proportionally. */
  height?: string
  /** Elements placed before the gradient layer — card backgrounds, borders, etc. */
  background?: ReactNode
  /** The skeleton shape rects/circles that clip the gradient sweep. */
  children: ReactNode
  className?: string
}

/**
 * Path B SVG skeleton infrastructure.
 *
 * Renders a single animated linearGradient behind a <clipPath> mask.
 * Shapes passed as children define what gets the shimmer; everything
 * outside the shapes is transparent (background shows through).
 *
 * Stop colors reference CSS custom properties so dark mode is automatic.
 */
export function SvgSkeleton({
  id,
  viewBox,
  width = '100%',
  height,
  background,
  children,
  className = '',
}: SvgSkeletonProps) {
  const vw = Number(viewBox.split(' ')[2])
  const gradId = `${id}-grad`
  const clipId = `${id}-clip`

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      aria-hidden="true"
      className={`skeleton-svg${className ? ` ${className}` : ''}`}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={vw}
          y2="0"
        >
          <stop offset="0%"   stopColor="var(--surface-sunken)" />
          <stop offset="25%"  stopColor="var(--surface-sunken)" />
          <stop offset="50%"  stopColor="var(--surface)" />
          <stop offset="75%"  stopColor="var(--surface-sunken)" />
          <stop offset="100%" stopColor="var(--surface-sunken)" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values={`${-vw} 0; ${vw} 0`}
            dur="1.4s"
            repeatCount="indefinite"
          />
        </linearGradient>
        <clipPath id={clipId}>{children}</clipPath>
      </defs>

      {background}

      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill={`url(#${gradId})`}
        clipPath={`url(#${clipId})`}
      />
    </svg>
  )
}

// ── Portfolio model card skeleton ────────────────────────────────────────────

// Measurements derived from .wizard-model-cards__card:
// padding: --space-6 (24px), gap between rows: --space-3 (12px)
const W   = 320
const PAD = 24
const GAP = 12

const Y_TITLE = PAD
const H_TITLE = 16
const Y_DESC  = Y_TITLE + H_TITLE + GAP   // 52
const H_DESC  = 60
const Y_COUNT = Y_DESC + H_DESC + GAP     // 124
const H_COUNT = 12
const Y_HIER  = Y_COUNT + H_COUNT + GAP   // 148
const H_HIER  = 28
const H_TOTAL = Y_HIER + H_HIER + PAD     // 200

/**
 * Path B showcase skeleton for the portfolio model card.
 * Pixel-accurate to .wizard-model-cards__card — title, version badge,
 * description area, layer count, and three layer hierarchy boxes.
 */
export function PortfolioModelSkeleton({ className = '' }: { className?: string }) {
  return (
    <SvgSkeleton
      id="portfolio-model"
      viewBox={`0 0 ${W} ${H_TOTAL}`}
      className={className}
      background={
        // TL+BR rounded (r=12), TR+BL square — matches asymmetric card radius
        <path
          d={`M 12.5,0.5 H ${W - 0.5} V ${H_TOTAL - 12.5} a 12,12 0 0 1 -12,12 H 0.5 V 12.5 a 12,12 0 0 1 12,-12 Z`}
          fill="var(--surface)"
          stroke="var(--border)"
          strokeWidth="1"
        />
      }
    >
      {/* Title */}
      <rect x={PAD}        y={Y_TITLE} width={Math.round(W * 0.55)} height={H_TITLE} rx="4" />
      {/* Version badge */}
      <rect x={W - PAD - 32} y={Y_TITLE - 2} width="32" height="20" rx="4" />
      {/* Description area */}
      <rect x={PAD} y={Y_DESC} width={W - PAD * 2} height={H_DESC} rx="4" />
      {/* Layer count label */}
      <rect x={PAD} y={Y_COUNT} width="60" height={H_COUNT} rx="4" />
      {/* Layer hierarchy — 3 boxes, 8px gap */}
      <rect x={PAD}       y={Y_HIER} width="72" height={H_HIER} rx="4" />
      <rect x={PAD + 80}  y={Y_HIER} width="72" height={H_HIER} rx="4" />
      <rect x={PAD + 160} y={Y_HIER} width="72" height={H_HIER} rx="4" />
    </SvgSkeleton>
  )
}
