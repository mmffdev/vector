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
   * Explicit map id (from `?mid=` URL param). When null, the hook
   * auto-resolves a default map for `topologyNodeId` — uses the
   * first existing map under that node, or POSTs a new one named
   * "Default dependencies" on miss.
   */
  mapIdOverride?: string | null;
  /**
   * Topology node the focused artefact lives under. Used for
   * auto-resolution when `mapIdOverride` is absent. When null AND
   * no override, the hook is dormant (caller falls back to
   * ephemeral state — no scope to write into).
   */
  topologyNodeId: string | null;
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
  /** The resolved map id (auto-created or override). Null while resolving / dormant. */
  mapId: string | null;
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
  const { mapIdOverride = null, topologyNodeId, focusedArtefactId } = params;

  // mapId is resolved asynchronously: explicit override wins; else
  // the hook lists maps under topologyNodeId and either picks the
  // first or POSTs a new one named "Default dependencies".
  const [mapId, setMapId] = useState<string | null>(mapIdOverride ?? null);
  const [buckets, setBuckets] = useState<PersistedBuckets>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateForRef = useRef<string>("");

  // Re-sync local mapId when the override prop flips externally.
  useEffect(() => {
    if (mapIdOverride && mapIdOverride !== mapId) {
      setMapId(mapIdOverride);
    }
  }, [mapIdOverride, mapId]);

  // Auto-resolve mapId when no override is supplied.
  useEffect(() => {
    if (mapIdOverride) return; // override wins
    if (!topologyNodeId) {
      setMapId(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const existing = await dependencies.maps.list(topologyNodeId);
        if (!alive) return;
        if (existing.length > 0) {
          setMapId(existing[0].id);
          return;
        }
        // No map yet — auto-create a default. Idempotent in spirit:
        // a second concurrent open would race here but the unique-
        // index on (workspace, node, name) is not enforced today, so
        // two "Default dependencies" maps may exist. Acceptable
        // tradeoff for v1; a named map-picker UX is the next iter.
        const created = await dependencies.maps.create({
          topology_node_id: topologyNodeId,
          name: "Default dependencies",
        });
        if (!alive) return;
        setMapId(created.id);
      } catch (e) {
        if (!alive) return;
        setError(toMessage(e));
        setMapId(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mapIdOverride, topologyNodeId]);

  const isPersisted = Boolean(mapId);

  const fetchBuckets = useCallback(async () => {
    if (!mapId || !focusedArtefactId) return;
    const stateKey = `${mapId}:${focusedArtefactId}`;
    setIsLoading(true);
    setError(null);
    try {
      const payload = await dependencies.edges.list(mapId, focusedArtefactId);
      if (stateForRef.current !== stateKey) {
        stateForRef.current = stateKey;
      }
      setBuckets(projectionToBuckets(payload));
    } catch (e) {
      setError(toMessage(e));
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
    mapId,
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
