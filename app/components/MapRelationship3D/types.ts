// Wire types for the relations / topology-map 3D force graph.
//
// History: these types previously lived in app/api/v2/work-items/relations/route.ts
// — a Next.js shadow handler that queried Postgres directly. The handler was
// broken after RF1.4.2's column-prefix rename (queried `artefact_types` etc.
// which no longer exist) and no caller had noticed because the topology-map
// page passes its own `payload` prop (sourced from the apiSite-backed
// useTopologyRelationsPayload hook). Shadow handler and the dead consumers
// (useRelationsData, WorkItemRelations wrapper) were retired 2026-05-19.
//
// The types stayed alive because RelationsToolbar / RelationsSidebar /
// RelationsGraph still consume them as the data contract between the
// fetcher and the renderer. They live here now so future fetchers
// (e.g. a Go-backed /_site endpoint) can target the same shape without
// the audit flagging the deleted shadow path.

export type RelationsNode = {
  id: string;
  number: number;
  prefix: string;            // "EP" | "US" | "DE" | "TA" | tenant prefix
  type_name: string;         // "Epic" | "Story" | …
  title: string;
  state_name: string | null;
  state_kind: string | null; // "todo" | "doing" | "done" | "blocked" | …
  parent_id: string | null;
  depth: number;             // 0 = root, 1 = child of a root, …
  descendant_count: number;  // total descendants — drives hub size
};

export type RelationsEdgeKind = "parent" | "blocks" | "duplicates" | "relates_to";

export type RelationsEdge = {
  source: string;            // node id
  target: string;            // node id
  kind: RelationsEdgeKind;
};

export type RelationsMeta = {
  subscription_id: string;
  generated_at: string;      // ISO-8601
  node_count: number;
  edge_count: number;
  edge_kinds: RelationsEdgeKind[];   // which kinds appear in this payload
  truncated: boolean;        // true if a hard cap was hit
  cap: number;               // the hard cap that would have triggered truncation
};

export type RelationsPayload = {
  nodes: RelationsNode[];
  edges: RelationsEdge[];
  meta: RelationsMeta;
};

// Filter state shared by RelationsToolbar (writes), RelationsGraph (reads),
// and MapRelationship3D (owns the state).
export type RelationsFilters = {
  /** Free-text search over number, prefix, and title. */
  q: string;
  /** Type-name set (e.g. "Epic","Story"). Empty = show all. */
  types: Set<string>;
  /** Hard depth cap from any root. null = unlimited. */
  maxDepth: number | null;
  /** Neighbour-mode: when a node is selected, show only its k-hop neighbourhood. */
  neighbourMode: boolean;
  neighbourDepth: number;
};

export const DEFAULT_RELATIONS_FILTERS: RelationsFilters = {
  q: "",
  types: new Set(),
  maxDepth: null,
  neighbourMode: false,
  neighbourDepth: 2,
};
