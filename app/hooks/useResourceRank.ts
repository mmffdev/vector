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
  /**
   * Reparent capability (drop ONTO a row). The hook splits each row
   * into thirds: top 25% / middle 50% / bottom 25%. Above + below
   * stay as sibling reorder (rank); middle fires a reparent.
   *
   * - `canReparent(moverID, targetID)` runs the legality check on
   *   every dragover so the row can paint itself legal/illegal in
   *   real time. Same-parent, cycle, allowed-parent rules live in
   *   the caller — hook stays generic.
   * - `onReparent(moverID, targetID, intent)` fires on drop:
   *     • intent="onto"  → drop into the middle third. targetID IS
   *       the new parent.
   *     • intent="above" → drop above targetID, crossing a parent
   *       boundary. The caller should resolve the new parent from
   *       targetID's parent_id and PATCH there.
   *     • intent="below" → same as "above" but below targetID.
   *   The host is the only place that knows row parent_ids; the
   *   hook just passes the intent through.
   *
   * When both callbacks are omitted, the hook keeps the previous
   * above/below-only behaviour — middle drops fall back to "below".
   */
  canReparent?: (moverID: string, targetID: string) => boolean;
  onReparent?: (
    moverID: string,
    targetID: string,
    intent: "onto" | "above" | "below",
  ) => void;
  /**
   * Optional: called once on dragstart with the mover's id. Caller
   * walks its visible row set and returns every id that's a legal
   * reparent target (same rule canReparent applies — but pre-computed
   * so every candidate row can paint a "you can drop here" marker the
   * moment the drag begins, not just the hovered one).
   *
   * Lightweight: one pass over the in-memory row arrays (no fetches);
   * Set lookup at render time is O(1). Result is cached for the
   * lifetime of the drag and cleared on dragend.
   *
   * When omitted, the candidate Set stays empty — feature is opt-in
   * per consumer.
   */
  getCandidateIds?: (moverID: string) => string[];
};

export function useResourceRank(opts: UseResourceRankOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSubtree, setDraggingSubtree] = useState<Set<string>>(() => new Set());
  // pos = "onto" → drop fires reparent (allowed bit drives the class
  // so the CSS can paint legal vs illegal). Cycle / dragging-self are
  // still caught upstream in onDragOver — the allowed flag here only
  // gates the allowed-parent + same-parent rules from the caller.
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: "above" | "below" | "onto";
    allowed?: boolean;
  } | null>(null);
  // Set of row IDs eligible to receive the dragged row as a child.
  // Computed once on dragstart by the caller-supplied resolver; cleared
  // on dragend. Cheap to membership-check at render time → every row
  // can paint its "you can drop here" marker without per-row work.
  const [candidateIds, setCandidateIds] = useState<Set<string>>(() => new Set());
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
      // Candidate = pre-computed legal drop target. Only meaningful
      // while a drag is in flight (candidateIds is cleared on dragend),
      // and skipped for the mover's own row + every row in its
      // subtree to avoid suggesting illegal cycles. Paints the
      // #ccff00 ↔ transparent barber-pole over every candidate — see
      // .drag-row--drop-candidate in globals.css. No "drop-onto" or
      // "drop-onto-illegal" classes any more: the candidate field
      // tells the user where they CAN drop; everywhere else they
      // can't, no extra visual needed.
      const isCandidate = draggingId !== null && candidateIds.has(id) && !inSubtree;
      return {
        "data-rank-row-id": id,
        className: [
          inSubtree ? "drag-row--dragging" : "",
          dropTarget?.id === id && dropTarget.pos === "above" ? "drag-row--drop-above" : "",
          dropTarget?.id === id && dropTarget.pos === "below" ? "drag-row--drop-below" : "",
          isCandidate ? "drag-row--drop-candidate" : "",
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
          // Row split into thirds: 0..25% = above (reorder), 25..75% =
          // onto (reparent), 75..100% = below (reorder). The middle
          // half is intentionally generous so reparent is easy to hit;
          // reorder needs a deliberate aim near the row edges.
          // When the caller didn't wire reparent at all, fall back to
          // the legacy 50/50 above/below split.
          const offsetY = e.clientY - rect.top;
          const ratio = rect.height > 0 ? offsetY / rect.height : 0;
          let pos: "above" | "below" | "onto";
          if (!opts.onReparent) {
            pos = ratio < 0.5 ? "above" : "below";
          } else if (ratio < 0.25) {
            pos = "above";
          } else if (ratio > 0.75) {
            pos = "below";
          } else {
            pos = "onto";
          }
          if (pos === "onto") {
            const allowed = opts.canReparent
              ? opts.canReparent(draggingRef.current, id)
              : true;
            setDropTarget({ id, pos, allowed });
            // Reflect legality in the native drag cursor too. "none"
            // gives the browser's no-drop icon for illegal targets.
            e.dataTransfer.dropEffect = allowed ? "move" : "none";
          } else {
            setDropTarget({ id, pos });
          }
        },
        onDragLeave: (e: React.DragEvent) => {
          if (e.currentTarget === e.target) setDropTarget(null);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          const moverID = draggingRef.current;
          const target = dropTarget;
          // Capture candidate set BEFORE the dragend clears it so
          // the cross-parent classification below can see the field
          // that was active during the drag.
          const candidates = candidateIds;
          draggingRef.current = null;
          draggingSubtreeRef.current = new Set();
          setDraggingId(null);
          setDraggingSubtree(new Set());
          setDropTarget(null);
          setCandidateIds(new Set());
          if (!moverID || moverID === id || !target) return;
          if (target.pos === "onto") {
            // Illegal drop — silently ignore. The user got the red
            // outline + no-drop cursor as feedback.
            if (!target.allowed) return;
            opts.onReparent?.(moverID, target.id, "onto");
            return;
          }
          // Above/below: when the target row was painted as a
          // candidate (a sibling under a legal-parent row), this is
          // a cross-parent drop — hand off to onReparent so the host
          // can resolve the target's parent_id and PATCH. Otherwise
          // it's a same-parent reorder via /rank/move.
          if (candidates.has(target.id) && opts.onReparent) {
            opts.onReparent(moverID, target.id, target.pos);
            return;
          }
          const intent: RankIntent =
            target.pos === "above" ? { before: target.id } : { after: target.id };
          void move(moverID, intent);
        },
      };
    },
    [draggingId, draggingSubtree, dropTarget, candidateIds, move, opts]
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
        // Pre-compute the candidate set once. Caller walks roots +
        // expanded children, applies the same legality rule
        // canReparent uses, and returns the legal target ids. Skipped
        // when the caller hasn't wired the resolver.
        if (opts.getCandidateIds) {
          setCandidateIds(new Set(opts.getCandidateIds(id)));
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      },
      onDragEnd: () => {
        draggingRef.current = null;
        draggingSubtreeRef.current = new Set();
        setDraggingId(null);
        setDraggingSubtree(new Set());
        setDropTarget(null);
        setCandidateIds(new Set());
      },
    }),
    [opts]
  );

  return { rowProps, handleProps, draggingId, draggingSubtree, dropTarget, candidateIds, move };
}
