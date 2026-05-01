"use client";

/**
 * Shared drag-handle cell. Renders the six-dot grip icon inside a
 * <td> sized for the catalog's drag-handle column. Use as the first
 * cell of any row that participates in client-side drag-and-drop
 * reordering — the parent row owns the drag listeners (see
 * useResourceRank); this component only paints the affordance.
 *
 * Catalog classes only — no inline styles, no bespoke CSS in callers.
 */
import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLTableCellElement> & {
  draggable?: boolean;
};

export default function DragHandleColumn({
  className = "",
  draggable = true,
  ...rest
}: Props) {
  const cls = ["drag-handle-cell", className].filter(Boolean).join(" ");
  return (
    <td className={cls} aria-label="Drag to reorder" draggable={draggable} {...rest}>
      <span className="drag-handle" aria-hidden="true">
        ⋮⋮
      </span>
    </td>
  );
}
