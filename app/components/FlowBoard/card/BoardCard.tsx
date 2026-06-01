"use client";

// BoardCard — FB1.3.5
//
// Draggable Kanban card. Wraps an ArtefactCard in a dnd-kit useDraggable
// context and renders the per-user field set via CardFieldRenderer.
//
// Drag data attached to the draggable item:
//   { artefactId, flowStateId }
// The drop handler (FB1.3.7 p_FlowBoard) reads these to identify the source
// card and validate the flow-state transition before calling the PATCH.
//
// Click behaviour:
//   The parent (p_FlowBoard, FB1.3.7) wires the onClick prop to open the
//   existing ObjectTreeDetailFlyout for the artefact. BoardCard does not
//   mount, own, or reference the flyout — that state lives one level up.
//   Click is suppressed when a drag is in progress (isDragging) so a drop
//   does not also fire a navigation event.
//
// Inline style note:
//   The `style={{ transform: ... }}` below is the canonical dnd-kit transform
//   pattern for tracking the drag offset. It is NOT a design-style violation.
//   Per project rules, the no-inline-style rule excepts dnd-kit's computed
//   transforms because the value is dynamic and cannot be expressed in CSS.

import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { ArtefactCard } from "@/app/components/FlowBoard/hooks/useFlowBoardData";
import { CardFieldRenderer } from "@/app/components/FlowBoard/card/CardFieldRenderer";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BoardCardProps {
  /** Full artefact data row — drives field renderers. */
  artefact: ArtefactCard;
  /** Ordered list of field keys to render on this card face. */
  fields: string[];
  /**
   * Called when the card is clicked (not dragged).
   * Parent wires this to open the ObjectTreeDetailFlyout for artefact.id.
   * Optional — cards are still draggable when no click handler is provided.
   */
  onClick?: (artefactId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * BoardCard is a draggable card in the FlowBoard Kanban grid.
 *
 * Drag mechanics are provided by dnd-kit's `useDraggable`. The DndContext
 * is NOT mounted here — it lives in p_FlowBoard (FB1.3.7). BoardCard is a
 * pure leaf: receive props, call useDraggable, render.
 *
 * Field rendering is delegated to CardFieldRenderer (pure function per field).
 */
export function BoardCard({
  artefact,
  fields,
  onClick,
}: BoardCardProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: artefact.id,
      data: {
        artefactId: artefact.id,
        flowStateId: artefact.flowStateId,
      },
    });

  // Build class list imperatively — easy to read and extend.
  const classNames = ["flow-board__Card"];
  if (isDragging) classNames.push("flow-board__Card-dragging");

  const handleClick = () => {
    // Suppress click when drag is in progress — the pointer-up that ends
    // a drag should not also navigate to the detail flyout.
    if (isDragging) return;
    onClick?.(artefact.id);
  };

  return (
    <div
      ref={setNodeRef}
      className={classNames.join(" ")}
      // dnd-kit canonical transform — see @dnd-kit/core docs
      style={{ transform: CSS.Translate.toString(transform) }}
      data-artefact-id={artefact.id}
      aria-label={`Card: ${artefact.title}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      {...attributes}
      {...listeners}
    >
      {fields.map((f) => (
        <CardFieldRenderer key={f} field={f} artefact={artefact} />
      ))}
    </div>
  );
}
