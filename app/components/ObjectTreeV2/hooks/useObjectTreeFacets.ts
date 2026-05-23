"use client";

// useObjectTreeFacets — small read hook owned by ObjectTreeV2 that asks
// the backend "what artefact_type_id and priority_id values exist in
// the current scope?". Used by the filter chips so the chip surface
// agrees with the grid surface (same workspace + topology clamp).
//
// PLA057 / OBJ1.2.1.
//
// Cache key = (resourceUrl, meg) — workspace is implicit via the JWT
// the backend reads on every call. `meg` is read from the same place
// apiSite() already auto-forwards from (URL query > localStorage), so
// callers don't need to thread it through.

import { useEffect, useState } from "react";

import { apiSite } from "@/app/lib/api";

export interface ObjectTreeFacets {
  typeIds: string[];
  priorityIds: string[];
  loading: boolean;
  error: string | null;
}

interface FacetsResponse {
  artefact_type_ids: string[];
  priority_ids: string[];
}

/**
 * Fetch the scope-clamped facet UUIDs for an ObjectTreeV2 resource.
 *
 * @param resourceUrl - "/work-items" or "/portfolio-items" (matches the
 *   list endpoint the grid uses). Determines the scope discriminator on
 *   the backend (work vs strategy).
 * @param scopeNodeId - the active topology node id, or null when no
 *   scope is set. Included in the cache key so a scope change refetches.
 *   apiSite() already auto-appends `?meg=` to the request URL so we don't
 *   re-pass it on the wire — this param is purely for cache invalidation.
 */
export function useObjectTreeFacets(
  resourceUrl: string,
  scopeNodeId: string | null,
): ObjectTreeFacets {
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [priorityIds, setPriorityIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiSite<FacetsResponse>(`${resourceUrl}/facets`)
      .then((res) => {
        if (cancelled) return;
        setTypeIds(res.artefact_type_ids ?? []);
        setPriorityIds(res.priority_ids ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load facets");
        setTypeIds([]);
        setPriorityIds([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // scopeNodeId is part of the cache key — when it changes, refetch.
    // resourceUrl is stable per ObjectTreeV2 mount but listed for safety.
  }, [resourceUrl, scopeNodeId]);

  return { typeIds, priorityIds, loading, error };
}
