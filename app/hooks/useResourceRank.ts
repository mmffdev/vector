"use client";

/**
 * useResourceRank — shared HTML5 drag-and-drop wiring for any
 * orderable resource (work items, defects, portfolio levels, library
 * items, …). The hook returns three sets of props:
 *
 *   rowProps(id)     — spread on every draggable row
 *   handleProps(id)  — spread on the drag-handle <td>
 *   ghost            — the row id currently being dragged, for ghost preview
 *
 * It does NOT own the optimistic-UI reorder; callers compose
 * useResourceRank with their own state setter (see useOptimisticReorder
 * in 00216). On drop it POSTs `/samantha/v2/rank/move` and surfaces the final
 * server position via the `onMoved` callback so the caller can
 * reconcile any drift (last-write-wins).
 */

import { useCallback, useRef, useState } from "react";
import { apiSite, ApiError } from "@/app/lib/api";

export type RankIntent =
  | { before: string }
  | { after: string }
  | { toTop: true }
  | { toBottom: true };

export type MoveResult = {
  row_id: string;
  scope: "backlog" | "sprint";
  new_position: number;
};

export type UseResourceRankOptions = {
  resourceType: string; // e.g. "work_item"
  /**
   * Called after the server confirms the move. Use this to reconcile
   * optimistic UI with the server's final position (last-write-wins
   * may have produced a different ordering than the dropped one).
   */
  onMoved?: (result: MoveResult) => void;
  /**
   * Called on a server-side rejection (404 / 403 / 409). Caller
   * typically rolls back the optimistic reorder here.
   */
  onError?: (err: ApiError) => void;
  /**
   * For hierarchical resources (e.g. work items): return the IDs of
   * every descendant row of `id`. The hook uses this to paint the
   * whole subtree with the dragging style so the user sees that
   * children move with their parent. Backend doesn't need the list —
   * descendants follow their parent's position automatically.
   */
  getDescendants?: (id: string) => string[];
};

export function useResourceRank(opts: UseResourceRankOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSubtree, setDraggingSubtree] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: "above" | "below" } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const draggingSubtreeRef = useRef<Set<string>>(new Set());

  const move = useCallback(
    async (rowID: string, intent: RankIntent) => {
      const body: Record<string, unknown> = { resource_type: opts.resourceType, row_id: rowID };
      if ("before" in intent) body.before = intent.before;
      else if ("after" in intent) body.after = intent.after;
      else if ("toTop" in intent) body.to_top = true;
      else body.to_bottom = true;

      try {
        const result = await apiSite<MoveResult>("/rank/move", {
          method: "POST",
          body: JSON.stringify(body),
        });
        opts.onMoved?.(result);
        return result;
      } catch (err) {
        if (err instanceof ApiError) {
          opts.onError?.(err);
        }
        throw err;
      }
    },
    [opts]
  );

  const rowProps = useCallback(
    (id: string) => {
      const inSubtree = draggingId !== null && (draggingId === id || draggingSubtree.has(id));
      return {
        "data-rank-row-id": id,
        className: [
          inSubtree ? "drag-row--dragging" : "",
          dropTarget?.id === id && dropTarget.pos === "above" ? "drag-row--drop-above" : "",
          dropTarget?.id === id && dropTarget.pos === "below" ? "drag-row--drop-below" : "",
        ]
          .filter(Boolean)
          .join(" "),
        onDragOver: (e: React.DragEvent) => {
          // Block dropping a parent into its own subtree.
          if (
            !draggingRef.current ||
            draggingRef.current === id ||
            draggingSubtreeRef.current.has(id)
          ) {
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const pos = e.clientY - rect.top < rect.height / 2 ? "above" : "below";
          setDropTarget({ id, pos });
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget === e.target) setDropTarget(null);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          const moverID = draggingRef.current;
          const target = dropTarget;
          draggingRef.current = null;
          draggingSubtreeRef.current = new Set();
          setDraggingId(null);
          setDraggingSubtree(new Set());
          setDropTarget(null);
          if (!moverID || moverID === id || !target) return;
          const intent: RankIntent =
            target.pos === "above" ? { before: target.id } : { after: target.id };
          void move(moverID, intent);
        },
      };
    },
    [draggingId, draggingSubtree, dropTarget, move]
  );

  const handleProps = useCallback(
    (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        const subtree = new Set(opts.getDescendants?.(id) ?? []);
        draggingRef.current = id;
        draggingSubtreeRef.current = subtree;
        setDraggingId(id);
        setDraggingSubtree(subtree);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      },
      onDragEnd: () => {
        draggingRef.current = null;
        draggingSubtreeRef.current = new Set();
        setDraggingId(null);
        setDraggingSubtree(new Set());
        setDropTarget(null);
      },
    }),
    [opts]
  );

  return { rowProps, handleProps, draggingId, draggingSubtree, dropTarget, move };
}
