"use client";

// BoardColumn — FB1.3.4
//
// Droppable column wrapper for the FlowBoard Kanban grid.
//
// This component owns the dnd-kit `useDroppable` contract for a single
// column. The critical property is the `disabled` flag:
//
//   disabled: activeStateId !== null && !isAllowed(activeStateId, column.flowState.id)
//
// When disabled, dnd-kit's collision detection skips this droppable entirely
// so a card physically cannot be dropped here — the rejection is enforced at
// the kit level, not just visually. A dimmed CSS class (`flow-board__Column-disabled`)
// is also applied so the user sees which columns are off-limits during drag.
//
// The DndContext is NOT mounted here — it lives in p_FlowBoard (FB1.3.7).
// This component is a pure building block: receive props, call useDroppable,
// render children.

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import type { FlowBoardColumn } from "@/app/components/FlowBoard/hooks/useFlowBoardData";
import { BoardColumnHeader } from "@/app/components/FlowBoard/columns/BoardColumnHeader";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface BoardColumnProps {
  /** Column data — flow state + WIP limit + card list. */
  column: FlowBoardColumn;
  /**
   * The flow_state id of the card currently being dragged, or null when
   * no drag is in progress. Used to compute the `disabled` flag.
   */
  activeStateId: string | null;
  /**
   * Predicate that returns true when a transition from the active card's
   * state to this column's state is allowed by the flow_transitions table.
   * Sourced from `useFlowStateTransitions`.
   */
  isAllowed: (fromStateId: string, toStateId: string) => boolean;
  /** Card elements rendered inside the column body. */
  children: React.ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * BoardColumn wraps a single Kanban column with a dnd-kit droppable area.
 *
 * When `activeStateId` is set AND `isAllowed(activeStateId, column.flowState.id)`
 * returns false, the droppable is disabled — dnd-kit will not register it as a
 * valid drop target, making the rejection physical, not just cosmetic.
 *
 * Visual feedback is applied via the `flow-board__Column-disabled` CSS class so
 * the user sees the column dim during the drag. The CSS class must be defined in
 * `app/globals.css` under the `flow-board__Column` block.
 */
export function BoardColumn({
  column,
  activeStateId,
  isAllowed,
  children,
}: BoardColumnProps): React.ReactElement {
  const isDragActive = activeStateId !== null;
  const isDisabled =
    isDragActive && !isAllowed(activeStateId, column.flowState.id);

  const { setNodeRef, isOver } = useDroppable({
    id: column.flowState.id,
    disabled: isDisabled,
  });

  const cardCount = column.cards.length;

  // Build className imperatively — no template literals with conditional ternary
  // chains so the class list is easy to read and extend.
  const classNames = ["flow-board__Column"];
  if (isDisabled) classNames.push("flow-board__Column-disabled");
  if (isOver) classNames.push("flow-board__Column-over");

  return (
    <div
      ref={setNodeRef}
      className={classNames.join(" ")}
      data-flow-state-id={column.flowState.id}
      aria-label={column.flowState.name}
      aria-disabled={isDisabled}
    >
      <BoardColumnHeader
        title={column.flowState.name}
        count={cardCount}
        wipLimit={column.wipLimit}
      />
      <div className="flow-board__Column_body">
        {children}
      </div>
    </div>
  );
}

export default BoardColumn;
