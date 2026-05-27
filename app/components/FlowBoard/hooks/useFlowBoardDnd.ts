"use client";

// useFlowBoardDnd — FB1.3.4
//
// DnD orchestrator hook: wires onDragStart / onDragEnd for the FlowBoard
// Kanban. onDragOver is handled implicitly by dnd-kit via the `disabled`
// prop on each BoardColumn droppable — no extra work needed here.
//
// Responsibilities:
//   - Track `activeCard` (the card being dragged) and `activeStateId` (the
//     source column's flow_state id). These are passed to BoardColumn so it
//     can compute its `disabled` prop during the drag.
//   - On dragEnd over a valid (non-disabled) column: signal success via the
//     `onDrop` callback. The parent (p_FlowBoard, FB1.3.7) owns the board
//     state, applies the optimistic update, calls patchArtefactFlowState,
//     and reverts on 4xx.
//   - On dragEnd over a disabled column or no column: no-op (dnd-kit will not
//     fire dragEnd with a valid `over` when the target is disabled).
//
// DndContext is NOT mounted here — it lives in p_FlowBoard (FB1.3.7).
// This hook returns the three DndContext event handlers and the current
// active-card state as a single object the parent can spread.

import { useCallback, useState } from "react";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import type { ArtefactCard } from "@/app/components/FlowBoard/hooks/useFlowBoardData";

// ── Public types ──────────────────────────────────────────────────────────────

export interface UseFlowBoardDndResult {
  /** The card currently being dragged, or null when no drag is active. */
  activeCard: ArtefactCard | null;
  /**
   * The flow_state id of the source column, or null when no drag is active.
   * Passed to BoardColumn so it can compute `disabled` via isAllowed().
   */
  activeStateId: string | null;
  /** Wire to DndContext.onDragStart */
  onDragStart: (event: DragStartEvent) => void;
  /** Wire to DndContext.onDragEnd */
  onDragEnd: (event: DragEndEvent) => void;
}

export interface UseFlowBoardDndArgs {
  /**
   * Flat list of all cards across all columns, used to look up the dragged
   * card from its id (event.active.id).
   */
  allCards: ArtefactCard[];
  /**
   * Called when a card is successfully dropped on a valid target column.
   * The parent is responsible for optimistic update + PATCH + revert on 4xx.
   *
   * @param card        The card that was dragged.
   * @param newStateId  The flow_state id of the drop target column.
   */
  onDrop: (card: ArtefactCard, newStateId: string) => void;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * useFlowBoardDnd orchestrates the FlowBoard drag session.
 *
 * Call this in p_FlowBoard (FB1.3.7) and pass the returned handlers to
 * DndContext. Pass `activeStateId` to each BoardColumn so it can gate its
 * droppable `disabled` prop.
 */
export function useFlowBoardDnd({
  allCards,
  onDrop,
}: UseFlowBoardDndArgs): UseFlowBoardDndResult {
  const [activeCard, setActiveCard] = useState<ArtefactCard | null>(null);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const card = allCards.find((c) => c.id === String(event.active.id)) ?? null;
      setActiveCard(card);
    },
    [allCards],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const card = activeCard;
      setActiveCard(null);

      if (!card || !event.over) return;

      const newStateId = String(event.over.id);

      // Guard: don't fire if the card was dropped back on its own column.
      if (newStateId === card.flowStateId) return;

      onDrop(card, newStateId);
    },
    [activeCard, onDrop],
  );

  return {
    activeCard,
    activeStateId: activeCard?.flowStateId ?? null,
    onDragStart,
    onDragEnd,
  };
}
