"use client";

// useFlowBoardData — FB1.3.2
//
// Composes three parallel queries into the column/card structure the
// FlowBoard renderer needs:
//
//   1. GET /work-items/flow-states?artefact_type_id={id}
//      → ordered list of flow states for the type (the columns)
//
//   2. GET /work-items?artefact_type_id={id}&scope={topologyNodeId}
//      → artefacts scoped to the node, sentinel-clamped server-side
//
//   3. GET /flowboard/wip?node_id={topologyNodeId}&artefact_type_id={id}
//      → WIP limit rows for this node × type
//
// Client-side responsibilities (defence-in-depth only — server is the gate):
//   - Filter out cards where artefactTypePrefix === 'EP'
//   - Order columns by flow_position ASC
//   - Join WIP rows onto columns by flow_state_id (missing → wipLimit null)
//   - Group cards into their column by flow_state_id
//
// An AbortController is created per fetch cycle; it cancels inflight
// requests when args (topologyNodeId, artefactTypeId) change.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSentinel } from "@/app/sentinel";
import { flowBoard, workItems } from "@/app/lib/apiSite";

// ── Public types ──────────────────────────────────────────────────────────────

export interface FlowBoardFlowState {
  id: string;
  name: string;
  /** sort key from the backend (`flow_position` wire field) */
  sort: number;
  /** Custom flow-state colour (`flow_states.colour` on the backend). Drives
   *  the 5px coloured stripe at the top of the column. null/undefined when
   *  the state has no custom colour set — the column falls back to a
   *  neutral border token. */
  colour: string | null;
}

export interface ArtefactCard {
  id: string;
  title: string;
  artefactTypeId: string;
  artefactTypePrefix: string;
  flowStateId: string;
  // Optional fields rendered on the card face
  assignee?: string | null;
  points?: number | null;
  priority?: string | null;
}

export interface FlowBoardColumn {
  flowState: FlowBoardFlowState;
  /** null when no WIP row exists for this column (= unlimited) */
  wipLimit: number | null;
  cards: ArtefactCard[];
}

export interface UseFlowBoardDataResult {
  columns: FlowBoardColumn[];
  isLoading: boolean;
  error: Error | null;
  /**
   * Re-fetch the three composed queries in place. Triggered by parent on
   * a successful drag-PATCH so the rollup-recalc'd state is reflected
   * without unmounting the board. Returns a Promise that resolves after
   * the new data lands so callers can chain (rare — fire-and-forget is
   * the common path).
   */
  refetch: () => void;
}

// ── Wire shapes returned by the backend (opaque until typed here) ─────────────

interface RawFlowState {
  id: string;
  name: string;
  /** Wire field name: `flow_position` (artefactitems service) */
  flow_position: number;
  artefact_type_id?: string;
  canonical_code?: string;
  colour?: string | null;
}

interface RawWorkItemsResponse {
  items: RawWorkItem[];
  total?: number;
}

interface RawWorkItem {
  id: string;
  title: string;
  artefact_type_id: string;
  type_prefix: string;
  flow_state_id: string;
  owner_id?: string | null;
  story_points?: number | null;
  priority?: { name?: string } | null;
}

interface RawFlowStatesResponse {
  flow_states: RawFlowState[];
  states?: RawFlowState[];
}

// ── Args ──────────────────────────────────────────────────────────────────────

export interface UseFlowBoardDataArgs {
  topologyNodeId: string;
  artefactTypeId: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

export function useFlowBoardData({
  topologyNodeId,
  artefactTypeId,
}: UseFlowBoardDataArgs): UseFlowBoardDataResult {
  const sentinel = useSentinel();

  const [columns, setColumns] = useState<FlowBoardColumn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // refetchTick — bumping this re-runs the fetch effect in place without
  // unmounting the board. Parent calls refetch() after a successful drop
  // PATCH so the rollup-recalc'd parent state lands without a visible
  // unmount/remount flash.
  const [refetchTick, setRefetchTick] = useState(0);

  // Track the latest fetch generation so stale responses are dropped.
  const genRef = useRef(0);

  const fetch = useCallback(async (signal: AbortSignal) => {
    // Bail early if sentinel hasn't resolved — prevents a premature fetch
    // with a stale/empty workspace clamp from racing the correct one.
    if (sentinel.sentinel_loading) {
      return;
    }

    genRef.current += 1;
    const myGen = genRef.current;

    setIsLoading(true);
    setError(null);

    try {
      // Three reads in parallel.
      const [flowStatesResp, workItemsResp, wipRows] = await Promise.all([
        workItems.listFlowStates(
          `artefact_type_id=${encodeURIComponent(artefactTypeId)}`
        ) as Promise<RawFlowStatesResponse>,
        workItems.list(
          `artefact_type_id=${encodeURIComponent(artefactTypeId)}&scope=${encodeURIComponent(topologyNodeId)}&limit=1000&offset=0`
        ) as Promise<RawWorkItemsResponse>,
        flowBoard.listWip(topologyNodeId, artefactTypeId),
      ]);

      // Stale-response guard: a newer fetch has started — drop ours.
      if (genRef.current !== myGen || signal.aborted) return;

      // ── 1. Build ordered flow state column stubs ──────────────────────────
      const rawStates: RawFlowState[] =
        flowStatesResp.flow_states ?? flowStatesResp.states ?? [];

      const sortedStates = [...rawStates].sort(
        (a, b) => a.flow_position - b.flow_position
      );

      // ── 2. Build WIP lookup map (flow_state_id → limit | null) ───────────
      const wipByStateId = new Map<string, number | null>();
      for (const wip of wipRows) {
        wipByStateId.set(wip.flow_state_id, wip.limit ?? null);
      }

      // ── 3. Filter cards: drop epics (defence-in-depth — server already
      //       enforces this for scoped board queries) ─────────────────────
      const rawItems: RawWorkItem[] =
        (workItemsResp as RawWorkItemsResponse).items ?? [];

      const cards: ArtefactCard[] = rawItems
        .filter((item) => item.type_prefix !== "EP")
        .map((item) => ({
          id: item.id,
          title: item.title,
          artefactTypeId: item.artefact_type_id,
          artefactTypePrefix: item.type_prefix,
          flowStateId: item.flow_state_id,
          assignee: item.owner_id ?? null,
          points: item.story_points ?? null,
          priority: item.priority?.name ?? null,
        }));

      // ── 4. Group cards by flow_state_id ──────────────────────────────────
      const cardsByStateId = new Map<string, ArtefactCard[]>();
      for (const card of cards) {
        const bucket = cardsByStateId.get(card.flowStateId);
        if (bucket) {
          bucket.push(card);
        } else {
          cardsByStateId.set(card.flowStateId, [card]);
        }
      }

      // ── 5. Assemble columns ───────────────────────────────────────────────
      const built: FlowBoardColumn[] = sortedStates.map((state) => ({
        flowState: {
          id: state.id,
          name: state.name,
          sort: state.flow_position,
          colour: state.colour ?? null,
        },
        wipLimit: wipByStateId.has(state.id)
          ? (wipByStateId.get(state.id) ?? null)
          : null,
        cards: cardsByStateId.get(state.id) ?? [],
      }));

      if (!signal.aborted) {
        setColumns(built);
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (genRef.current === myGen && !signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [
    topologyNodeId,
    artefactTypeId,
    sentinel.sentinel_loading,
    refetchTick,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetch]);

  // While sentinel is still booting, stay in loading state.
  const effectiveLoading = isLoading || sentinel.sentinel_loading;

  // refetch — bumping refetchTick re-runs the effect in place. Cheap and
  // unmount-free; replaces the FB1.3.7 boardKey-remount pattern that
  // caused a visible full-board flash on every successful drag.
  const refetch = useCallback(() => {
    setRefetchTick((t) => t + 1);
  }, []);

  return { columns, isLoading: effectiveLoading, error, refetch };
}
