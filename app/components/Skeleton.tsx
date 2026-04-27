import type { CSSProperties, ReactNode } from 'react'

type SkeletonStyle = CSSProperties & { '--skeleton-delay'?: string }

type SkeletonProps = {
  width?: string | number
  height?: string | number
  className?: string
  /** Wave position (1–8). Each step adds 50ms animation-delay for a left-to-right ripple. */
  wave?: number
  /** Override border-radius. Defaults to --radius-sm. Pass 'var(--radius-full)' for circles. */
  radius?: string
}

export function Skeleton({ width, height, className = '', wave, radius }: SkeletonProps) {
  const style: SkeletonStyle = {}

  if (width  !== undefined) style.width  = typeof width  === 'number' ? `${width}px`  : width
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height
  if (wave   !== undefined) style['--skeleton-delay'] = `${(wave - 1) * 50}ms`
  if (radius !== undefined) style.borderRadius = radius

  return (
    <div
      className={`skeleton${className ? ` ${className}` : ''}`}
      style={style}
      aria-hidden="true"
    />
  )
}

type SkeletonFadeProps = {
  /** When true, skeleton fades out and content fades in. */
  loaded: boolean
  /** The skeleton placeholder to show while loading. */
  skeleton: ReactNode
  children: ReactNode
}

/**
 * Fades between a skeleton placeholder and real content without a layout jump.
 * Uses CSS grid stacking — both layers occupy the same grid cell simultaneously.
 */
export function SkeletonFade({ loaded, skeleton, children }: SkeletonFadeProps) {
  return (
    <div className={`skeleton-fade${loaded ? ' skeleton-fade--loaded' : ''}`}>
      <div className="skeleton-fade__skeleton">{skeleton}</div>
      <div className="skeleton-fade__content">{children}</div>
    </div>
  )
}
