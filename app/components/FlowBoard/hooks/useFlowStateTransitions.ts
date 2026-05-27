"use client";

// useFlowStateTransitions — FB1.3.4
//
// Fetches the allowed from→to transition edges for a given artefact type
// from the flows.list() endpoint (which embeds transitions in each FlowGroup),
// then exposes a fast O(1) isAllowed() predicate that the drag engine uses to
// decide whether to dim and disable a droppable column.
//
// Design decisions:
//   - transitions are embedded in FlowGroup (transitions: FlowTransition[]).
//     There is no dedicated GET /transitions?artefact_type_id=X endpoint.
//     We call flows.list() once per type, filter the FlowGroup whose type_id
//     matches, and cache the result in a Set<string>.
//   - Same-state moves (from === to) are always allowed — a card dropped back
//     into its own column is a no-op and must never be blocked.
//   - The cache key is `${fromStateId}:${toStateId}` — O(1) Set lookup.
//   - An AbortController cancels the in-flight request when artefactTypeId
//     changes or the component unmounts.
//   - On error, isAllowed() returns true (fail-open) so the user can still
//     drag; the error is surfaced via the error field for the parent to handle.

import { useCallback, useEffect, useRef, useState } from "react";
import { flows } from "@/app/lib/apiSite";

// ── Public types ──────────────────────────────────────────────────────────────

export interface UseFlowStateTransitionsResult {
  /** Returns true if a drag from fromStateId to toStateId is allowed. */
  isAllowed: (fromStateId: string, toStateId: string) => boolean;
  isLoading: boolean;
  error: Error | null;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Fetches allowed flow transitions for the given artefact type and exposes a
 * fast O(1) isAllowed(from, to) predicate for the drag engine.
 *
 * Same-state moves (from === to) always return true — dropping a card back
 * into its source column is a no-op and must not be blocked.
 *
 * isAllowed() returns true while loading (fail-open) so the drag engine
 * doesn't pre-block columns before the data arrives.
 */
export function useFlowStateTransitions(
  artefactTypeId: string,
): UseFlowStateTransitionsResult {
  // Cached allow-set: `${fromId}:${toId}` keys for O(1) lookup.
  const [allowSet, setAllowSet] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Stale-response guard.
  const genRef = useRef(0);

  useEffect(() => {
    if (!artefactTypeId) return;

    const controller = new AbortController();
    genRef.current += 1;
    const myGen = genRef.current;

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const resp = await flows.list();
        if (controller.signal.aborted || genRef.current !== myGen) return;

        // Find the FlowGroup(s) whose type_id matches the requested type.
        // There may be multiple groups per type (one per workspace flow);
        // we union all their transitions into a single allow-set.
        const allGroups = [...(resp.work ?? []), ...(resp.strategy ?? [])];
        const matched = allGroups.filter((g) => g.type_id === artefactTypeId);

        const next = new Set<string>();
        for (const group of matched) {
          for (const tx of group.transitions ?? []) {
            next.add(`${tx.from}:${tx.to}`);
          }
        }

        if (!controller.signal.aborted && genRef.current === myGen) {
          setAllowSet(next);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted || genRef.current !== myGen) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!controller.signal.aborted && genRef.current === myGen) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [artefactTypeId]);

  const isAllowed = useCallback(
    (fromStateId: string, toStateId: string): boolean => {
      // Same-state: no-op move, always allowed.
      if (fromStateId === toStateId) return true;
      // While loading: fail-open so columns are not pre-blocked.
      if (isLoading) return true;
      return allowSet.has(`${fromStateId}:${toStateId}`);
    },
    [allowSet, isLoading],
  );

  return { isAllowed, isLoading, error };
}
