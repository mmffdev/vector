import { Skeleton } from './Skeleton'

type WaveProps = {
  /** Starting wave index (1–8). Each child element within the composition
   *  increments by 1 so they animate in left-to-right sequence. */
  wave?: number
}

/**
 * Mirrors the wizard model card layout:
 * name title + version badge / description area / layer count / layer hierarchy boxes.
 */
export function CardSkeleton({ wave = 1 }: WaveProps) {
  return (
    <div className="skeleton-card">
      <div className="skeleton-card__header">
        <Skeleton width="55%" height={14} wave={wave} />
        <Skeleton width={28} height={18} wave={wave + 1} />
      </div>
      <Skeleton width="100%" height={64} wave={wave + 2} />
      <Skeleton width={64} height={12} wave={wave + 3} />
      <div className="skeleton-card__hierarchy">
        <Skeleton width={72} height={28} wave={wave + 4} />
        <Skeleton width={72} height={28} wave={wave + 5} />
        <Skeleton width={72} height={28} wave={wave + 6} />
      </div>
    </div>
  )
}

/**
 * Generic list row: avatar circle + title/subtitle lines + trailing badge.
 * Matches the typical list item pattern across library, backlog, and search results.
 */
export function ListRowSkeleton({ wave = 1 }: WaveProps) {
  return (
    <div className="skeleton-list-row">
      <Skeleton width={32} height={32} wave={wave} radius="var(--radius-full)" />
      <div className="skeleton-list-row__meta">
        <Skeleton width="60%" height={13} wave={wave + 1} />
        <Skeleton width="40%" height={11} wave={wave + 2} />
      </div>
      <Skeleton width={56} height={22} wave={wave + 3} radius="var(--radius-full)" />
    </div>
  )
}

/**
 * Mirrors LayersTable row: drag handle icon + name cell + tag chip + description cell.
 */
export function TableRowSkeleton({ wave = 1 }: WaveProps) {
  return (
    <div className="skeleton-table-row">
      <Skeleton width={16} height={16} wave={wave} />
      <Skeleton width="35%" height={13} wave={wave + 1} />
      <Skeleton width={52} height={22} wave={wave + 2} radius="var(--radius-sm)" />
      <Skeleton width="45%" height={13} wave={wave + 3} />
    </div>
  )
}

/**
 * Mirrors .sidebar-item: 36px tall row with 16px icon placeholder + label bar.
 */
export function NavItemSkeleton({ wave = 1 }: WaveProps) {
  return (
    <div className="skeleton-nav-item" aria-hidden="true">
      <Skeleton width={16} height={16} wave={wave} />
      <Skeleton width={88} height={11} wave={wave + 1} />
    </div>
  )
}
