/**
 * usePersistedDependencyMap — the persistence hook for the
 * artefact-dependency composer (B23.2.4 / PLA074).
 *
 * Replaces the composer's ephemeral React-only bucket state with a
 * round-trip to the backend dependencies service:
 *
 *   - On mount/`mapId` change, GETs the three-bucket projection for
 *     (mapId, focusedArtefactId) and hydrates the three buckets from
 *     the wire payload. No ephemeral seed.
 *   - `addToBucket(candidate, bucket)` POSTs a new edge with the
 *     right kind + direction for the bucket, optimistically updates
 *     state, reverts + surfaces error on failure.
 *   - `removeFromBucket(edgeId)` POSTs to the edge's archive route,
 *     optimistically removes the row from local state, reverts on
 *     failure.
 *   - The persisted rows are returned alongside an `edgeId` so the
 *     archive call can target the row directly without a re-lookup.
 *
 * The composer uses this when a `mapId` is in scope; when the user
 * is in "free-floating preview" mode (no map selected), the existing
 * ephemeral bucket state remains the source of truth and this hook
 * is not invoked. Map-picker UX is deferred — see
 * Vector_Scope.md / B23.2.4 strikethrough note.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  dependencies,
  type DependencyBucketEdge,
  type DependencyBucketProjection,
  type DependencyEdgeKind,
} from "@/app/lib/apiSite";

export type DependencyBucketKey = "requires" | "parallel" | "unlocks";

/**
 * A persisted bucket row carries enough wire-level state for the
 * composer to render AND to archive. The composer hydrates the
 * remaining display fields (artefact title, type, etc.) from
 * /work-items/{id} as needed — the persistence hook is concerned
 * only with edges, not artefact metadata.
 */
export interface PersistedBucketRow extends DependencyBucketEdge {}

interface PersistedBuckets {
  requires: PersistedBucketRow[];
  parallel: PersistedBucketRow[];
  unlocks: PersistedBucketRow[];
}

const EMPTY: PersistedBuckets = { requires: [], parallel: [], unlocks: [] };

interface UsePersistedDependencyMapParams {
  /**
   * The dependency-map UUID the user is composing into. When null
   * the hook is dormant — caller falls back to ephemeral state.
   */
  mapId: string | null;
  /** UUID of the artefact the canvas is focused on. */
  focusedArtefactId: string;
}

interface UsePersistedDependencyMapResult {
  /** True when a mapId is in scope and the hook is driving state. */
  isPersisted: boolean;
  /** True while a fetch / mutation is in flight. */
  isLoading: boolean;
  /** Most recent error message; cleared on the next successful op. */
  error: string | null;
  /** Hydrated buckets — populated after the initial fetch. */
  buckets: PersistedBuckets;
  /**
   * Persist a new edge into one of the three buckets. The hook
   * derives the kind + direction from the bucket key:
   *   requires → (related → focused, finish_to_start)
   *   unlocks  → (focused → related, finish_to_start)
   *   parallel → (focused, related, parallel)
   */
  addToBucket: (
    relatedArtefactId: string,
    bucket: DependencyBucketKey,
  ) => Promise<void>;
  /** Archive one persisted edge by its edge_id. */
  removeFromBucket: (
    edgeId: string,
    bucket: DependencyBucketKey,
  ) => Promise<void>;
  /** Force a re-read from the backend (after a 409, or for refresh). */
  reload: () => Promise<void>;
}

/**
 * deriveInsert maps a bucket key + (focused, related) to the wire
 * shape the backend's POST /dependencies/edges expects.
 *
 * Requires First (focused viewpoint) stores the edge
 * `related → focused` so that when viewed from `related`, the same
 * row appears as "Unlocks Next: focused". Single source of truth
 * for both perspectives (RES058 §4).
 */
function deriveInsert(
  bucket: DependencyBucketKey,
  focusedArtefactId: string,
  relatedArtefactId: string,
): {
  from_artefact_id: string;
  to_artefact_id: string;
  kind: DependencyEdgeKind;
} {
  switch (bucket) {
    case "requires":
      return {
        from_artefact_id: relatedArtefactId,
        to_artefact_id: focusedArtefactId,
        kind: "finish_to_start",
      };
    case "unlocks":
      return {
        from_artefact_id: focusedArtefactId,
        to_artefact_id: relatedArtefactId,
        kind: "finish_to_start",
      };
    case "parallel":
      return {
        from_artefact_id: focusedArtefactId,
        to_artefact_id: relatedArtefactId,
        kind: "parallel",
      };
  }
}

function projectionToBuckets(p: DependencyBucketProjection): PersistedBuckets {
  return {
    requires: p.requires,
    parallel: p.parallel,
    unlocks: p.unlocks,
  };
}

export function usePersistedDependencyMap(
  params: UsePersistedDependencyMapParams,
): UsePersistedDependencyMapResult {
  const { mapId, focusedArtefactId } = params;
  const isPersisted = Boolean(mapId);

  const [buckets, setBuckets] = useState<PersistedBuckets>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the most recent (mapId, focusedArtefactId) the buckets
  // belong to so stale fetches don't overwrite a newer hydration.
  const stateForRef = useRef<string>("");

  const fetchBuckets = useCallback(async () => {
    if (!mapId || !focusedArtefactId) return;
    const stateKey = `${mapId}:${focusedArtefactId}`;
    setIsLoading(true);
    setError(null);
    try {
      const payload = await dependencies.edges.list(mapId, focusedArtefactId);
      // Drop stale results if the inputs changed mid-flight.
      if (stateForRef.current !== stateKey) {
        stateForRef.current = stateKey;
      }
      setBuckets(projectionToBuckets(payload));
    } catch (e) {
      setError(toMessage(e));
      // On hydration failure, fall back to empty buckets rather than
      // stale ones — the composer should never display data from a
      // previous (focused, map) pair after a failed reload.
      setBuckets(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [mapId, focusedArtefactId]);

  useEffect(() => {
    if (!isPersisted) {
      setBuckets(EMPTY);
      stateForRef.current = "";
      return;
    }
    // Fire and forget — `fetchBuckets` swallows its own errors into
    // the `error` state field.
    void fetchBuckets();
  }, [isPersisted, fetchBuckets]);

  const addToBucket = useCallback(
    async (relatedArtefactId: string, bucket: DependencyBucketKey) => {
      if (!mapId) {
        // Defensive: hook should not be called when not persisted.
        setError("No map selected");
        return;
      }
      const wire = deriveInsert(bucket, focusedArtefactId, relatedArtefactId);
      // Optimistic placeholder — uses a temporary edge_id sentinel
      // ("optimistic:<random>") that the reload below replaces with
      // the real one. The composer's archive handler ignores
      // optimistic ids (they can't be archived until persisted).
      const tempId = `optimistic:${
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }`;
      const optimisticRow: PersistedBucketRow = {
        edge_id: tempId,
        artefact_id: relatedArtefactId,
        kind: wire.kind,
      };
      setBuckets((prev) => ({
        ...prev,
        [bucket]: [...prev[bucket], optimisticRow],
      }));
      setIsLoading(true);
      setError(null);
      try {
        await dependencies.edges.create({
          map_id: mapId,
          from_artefact_id: wire.from_artefact_id,
          to_artefact_id: wire.to_artefact_id,
          kind: wire.kind,
        });
        // Re-read from the backend so the canonical edge_id replaces
        // the optimistic placeholder. Cheaper than diffing.
        await fetchBuckets();
      } catch (e) {
        setError(toMessage(e));
        // Revert the optimistic insert.
        setBuckets((prev) => ({
          ...prev,
          [bucket]: prev[bucket].filter((row) => row.edge_id !== tempId),
        }));
      } finally {
        setIsLoading(false);
      }
    },
    [mapId, focusedArtefactId, fetchBuckets],
  );

  const removeFromBucket = useCallback(
    async (edgeId: string, bucket: DependencyBucketKey) => {
      if (!mapId) return;
      if (edgeId.startsWith("optimistic:")) {
        // Pure local-only row — drop without a network call.
        setBuckets((prev) => ({
          ...prev,
          [bucket]: prev[bucket].filter((row) => row.edge_id !== edgeId),
        }));
        return;
      }
      // Optimistic removal — restore on failure.
      let snapshot: PersistedBucketRow[] = [];
      setBuckets((prev) => {
        snapshot = prev[bucket];
        return {
          ...prev,
          [bucket]: prev[bucket].filter((row) => row.edge_id !== edgeId),
        };
      });
      setIsLoading(true);
      setError(null);
      try {
        await dependencies.edges.archive(edgeId);
      } catch (e) {
        setError(toMessage(e));
        // Revert.
        setBuckets((prev) => ({
          ...prev,
          [bucket]: snapshot,
        }));
      } finally {
        setIsLoading(false);
      }
    },
    [mapId],
  );

  return {
    isPersisted,
    isLoading,
    error,
    buckets,
    addToBucket,
    removeFromBucket,
    reload: fetchBuckets,
  };
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown error";
}
