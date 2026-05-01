"use client";

/**
 * useOptimisticReorder — pair this with useResourceRank to apply a
 * drag-and-drop reorder to local state immediately, then reconcile
 * with the server's authoritative position once /api/rank/move
 * returns. Last-write-wins on the server may produce a different
 * final ordering than the dropped one (a concurrent move from
 * another client can re-shuffle), so we always trust the server's
 * `new_position` over the optimistic guess.
 *
 *   const items = [...]                 // ordered list from API
 *   const reorder = useOptimisticReorder({ items, setItems })
 *
 *   const rank = useResourceRank({
 *     resourceType: "work_item",
 *     onMoved: reorder.reconcile,
 *     onError: reorder.rollback,
 *   })
 *
 *   reorder.applyDrop(moverID, "above" | "below", targetID)
 *
 * The hook is deliberately list-shape agnostic: caller passes any
 * array whose items have `{ id }` and the matching setter. Trees
 * should flatten to a visible-row list before reordering and let
 * the parent-of-each-row stay implicit (the rank service moves
 * subtrees with their parent on the server side).
 */

import { useCallback, useRef } from "react";
import type { MoveResult } from "@/app/hooks/useResourceRank";
import type { ApiError } from "@/app/lib/api";

export type ReorderItem = { id: string };

type Snapshot<T> = T[];

export type UseOptimisticReorderOptions<T extends ReorderItem> = {
  items: T[];
  setItems: (next: T[]) => void;
};

export function useOptimisticReorder<T extends ReorderItem>(
  opts: UseOptimisticReorderOptions<T>
) {
  // Snapshot taken just before each optimistic mutation, used to roll
  // back if the server rejects the move.
  const snapshotRef = useRef<Snapshot<T> | null>(null);

  const applyDrop = useCallback(
    (moverID: string, pos: "above" | "below", targetID: string) => {
      if (moverID === targetID) return;
      const list = opts.items;
      const fromIdx = list.findIndex((r) => r.id === moverID);
      const toIdx = list.findIndex((r) => r.id === targetID);
      if (fromIdx < 0 || toIdx < 0) return;

      snapshotRef.current = list.slice();

      const next = list.slice();
      const [moved] = next.splice(fromIdx, 1);
      // Index shifts after removal when fromIdx < toIdx.
      const adjustedTargetIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
      const insertAt = pos === "above" ? adjustedTargetIdx : adjustedTargetIdx + 1;
      next.splice(insertAt, 0, moved);
      opts.setItems(next);
    },
    [opts]
  );

  const reconcile = useCallback(
    (_result: MoveResult) => {
      // The server may have moved the row to a different absolute
      // position because of concurrent writes. We don't have the
      // full ordered list in the response (intentional — that would
      // be a much bigger payload), so the source of truth here is
      // a follow-up subscription push (see useRealtimeSubscription)
      // which will trigger a refetch. We just clear the snapshot.
      snapshotRef.current = null;
    },
    []
  );

  const rollback = useCallback(
    (_err: ApiError) => {
      const snap = snapshotRef.current;
      if (snap) {
        opts.setItems(snap);
        snapshotRef.current = null;
      }
    },
    [opts]
  );

  return { applyDrop, reconcile, rollback };
}
