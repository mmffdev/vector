/**
 * dependencies — typed client for the artefact-dependency-map surface.
 *
 * Backend: backend/internal/dependencies/handler.go mounted under
 *   /_site/dependencies (B23.1.4 + handlers)
 *   /_site/work-items/{id}/dependency-impact (B23.1.8)
 *
 * Every read enforces Sentinel server-side (workspace + topology
 * subtree clamp); the client just calls and renders. `?meg=` scope
 * hint is handled by the apiSite middleware (no per-call wiring
 * needed) per the project HARD RULE — the URL clamp is cosmetic,
 * not the authority.
 *
 * Wire shapes mirror backend/internal/dependencies/types.go so the
 * frontend and backend agree on the contract; the file:line
 * references in JSDoc are how a reviewer keeps the two in sync.
 */

import { apiSite } from "@/app/lib/api";
import type { ID } from "@/app/lib/apiSite";

// ─── Wire shapes ─────────────────────────────────────────────────

/** Dependency map row — mirrors dependencies.Map (types.go). */
export interface DependencyMap {
  id: ID;
  subscription_id: ID;
  workspace_id: ID;
  topology_node_id: ID;
  root_artefact_id: ID | null;
  name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  created_by: ID | null;
  /** Populated only by GET /maps/{id} (the detail endpoint). */
  edge_count?: number;
}

/** Edge kind enum — mirrors dependencies.EdgeKind. */
export type DependencyEdgeKind = "finish_to_start" | "parallel";

/** Edge row — mirrors dependencies.Edge. */
export interface DependencyEdge {
  id: ID;
  map_id: ID;
  from_artefact_id: ID;
  to_artefact_id: ID;
  kind: DependencyEdgeKind;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  created_by: ID | null;
}

/** One entry inside the three-bucket projection — { edge_id, artefact_id, kind }. */
export interface DependencyBucketEdge {
  edge_id: ID;
  artefact_id: ID;
  kind: DependencyEdgeKind;
}

/** Three-bucket projection returned by GET /dependencies/edges. */
export interface DependencyBucketProjection {
  requires: DependencyBucketEdge[];
  parallel: DependencyBucketEdge[];
  unlocks: DependencyBucketEdge[];
}

/** Search-result row from GET /dependencies/candidates. */
export interface DependencyCandidate {
  id: ID;
  artefact_type_id: ID;
  topology_node_id: ID;
  title: string;
  key_num: number;
}

/** Dependency-impact preflight wire shape (B23.1.8). */
export interface DependencyImpactReport {
  impacted_maps: Array<{
    map_id: ID;
    map_name: string;
    edges: number;
  }>;
  total_edges: number;
}

/** 409 body returned by DELETE /work-items/{id} when a map blocks archive. */
export interface DependencyImpactConflict {
  code: "dependency_impact";
  impacted_maps: Array<{
    map_id: ID;
    map_name: string;
    edges: number;
  }>;
  total_edges: number;
}

/** One node in a reachability chain (B23.3.1). */
export interface DependencyReachableNode {
  artefact_id: ID;
  depth: number;
}

/** Wire shape returned by GET /dependencies/{id}/transitive-impact. */
export interface DependencyTransitiveImpactReport {
  downstream: DependencyReachableNode[];
  upstream: DependencyReachableNode[];
  /**
   * Total number of nodes (across both chains) the caller is not
   * Sentinel-cleared to see. The frontend renders this as a "+ N
   * more outside your scope" hint without leaking ids.
   */
  redacted_count: number;
}

// ─── Client surface ──────────────────────────────────────────────

export const dependencies = {
  maps: {
    /**
     * GET /_site/dependencies/maps?topology_node_id={id}
     * Workspace-clamped server-side. topology_node_id is an optional
     * filter — omit to list every map the caller can see in the
     * workspace.
     */
    list: (topologyNodeId?: ID) =>
      apiSite<DependencyMap[]>(
        topologyNodeId
          ? `/dependencies/maps?topology_node_id=${encodeURIComponent(topologyNodeId)}`
          : "/dependencies/maps"
      ),

    /** GET /_site/dependencies/maps/{id} — Map + live edge_count. */
    get: (mapId: ID) =>
      apiSite<DependencyMap>(
        `/dependencies/maps/${encodeURIComponent(mapId)}`
      ),

    /** POST /_site/dependencies/maps — create a new dependency map. */
    create: (body: {
      topology_node_id: ID;
      root_artefact_id?: ID | null;
      name: string;
    }) =>
      apiSite<DependencyMap>("/dependencies/maps", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    /** PATCH /_site/dependencies/maps/{id} — rename. */
    rename: (mapId: ID, body: { name: string }) =>
      apiSite<DependencyMap>(
        `/dependencies/maps/${encodeURIComponent(mapId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      ),

    /** POST /_site/dependencies/maps/{id}/archive — idempotent. */
    archive: (mapId: ID) =>
      apiSite<DependencyMap>(
        `/dependencies/maps/${encodeURIComponent(mapId)}/archive`,
        { method: "POST" }
      ),
  },

  edges: {
    /**
     * GET /_site/dependencies/edges?map_id={id}&focused_artefact_id={id}
     * Returns the three-bucket projection (requires / parallel /
     * unlocks) shaped for direct composer consumption.
     */
    list: (mapId: ID, focusedArtefactId: ID) =>
      apiSite<DependencyBucketProjection>(
        `/dependencies/edges?map_id=${encodeURIComponent(mapId)}&focused_artefact_id=${encodeURIComponent(focusedArtefactId)}`
      ),

    /**
     * POST /_site/dependencies/edges — insert with cycle guard.
     * Backend rejects 422 self-loop, 422 cycle, 409 duplicate,
     * 403 endpoint out-of-scope.
     */
    create: (body: {
      map_id: ID;
      from_artefact_id: ID;
      to_artefact_id: ID;
      kind: DependencyEdgeKind;
    }) =>
      apiSite<DependencyEdge>("/dependencies/edges", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    /** POST /_site/dependencies/edges/{id}/archive — idempotent. */
    archive: (edgeId: ID) =>
      apiSite<DependencyEdge>(
        `/dependencies/edges/${encodeURIComponent(edgeId)}/archive`,
        { method: "POST" }
      ),
  },

  candidates: {
    /**
     * GET /_site/dependencies/candidates?map_id&focused_artefact_id&q&limit
     *
     * Server-side filters artefacts in scope AND excludes any that
     * are already linked to focused_artefact_id in this map across
     * ANY bucket — the canonical defence-in-depth for the
     * multi-state-add loophole (per B23.2.2 AC). The composer's
     * React dedup is a UX nicety, not the authority.
     */
    search: (params: {
      map_id: ID;
      focused_artefact_id: ID;
      q?: string;
      limit?: number;
    }) => {
      const search = new URLSearchParams({
        map_id: params.map_id,
        focused_artefact_id: params.focused_artefact_id,
      });
      if (params.q) search.set("q", params.q);
      if (params.limit) search.set("limit", String(params.limit));
      return apiSite<DependencyCandidate[]>(
        `/dependencies/candidates?${search.toString()}`
      );
    },
  },

  impact: {
    /**
     * GET /_site/work-items/{id}/dependency-impact
     *
     * Used pre-archive to warn the user that deleting an artefact
     * would break N edges across M maps. The Archive call itself
     * also runs this check server-side and returns 409 with the
     * same payload if the user proceeds — see types
     * DependencyImpactConflict above.
     */
    get: (artefactId: ID) =>
      apiSite<DependencyImpactReport>(
        `/work-items/${encodeURIComponent(artefactId)}/dependency-impact`
      ),
  },

  reachability: {
    /**
     * GET /_site/dependencies/{artefact_id}/transitive-impact
     *
     * The CPM-shaped value we can deliver without duration
     * semantics (B23.3.1). Returns visible downstream + upstream
     * chains plus a redacted_count of nodes outside the caller's
     * Sentinel clamp. Used by the composer's "if this slips…" hint.
     */
    get: (artefactId: ID) =>
      apiSite<DependencyTransitiveImpactReport>(
        `/dependencies/${encodeURIComponent(artefactId)}/transitive-impact`
      ),
  },
};
