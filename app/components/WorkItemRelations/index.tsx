"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRelationsData } from "@/app/hooks/useRelationsData";
import type {
  RelationsNode,
  RelationsPayload,
} from "@/app/api/v2/work-items/relations/route";
import type { FlyToFn } from "./RelationsGraph";
import { RelationsToolbar } from "./RelationsToolbar";
import { RelationsSidebar } from "./RelationsSidebar";

// Three.js is a heavy client-only bundle; lazy-load it so the rest of
// the work-items area stays light. ssr:false is required — the canvas
// touches WebGL during mount.
const RelationsGraph = dynamic(
  () => import("./RelationsGraph").then((m) => m.RelationsGraph),
  { ssr: false, loading: () => <div className="placeholder__body">Loading graph engine…</div> },
);

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

const DEFAULT_FILTERS: RelationsFilters = {
  q: "",
  types: new Set(),
  maxDepth: null,
  neighbourMode: false,
  neighbourDepth: 2,
};

export function WorkItemRelations() {
  const { data, loading, error, refetch } = useRelationsData();

  const [filters, setFilters] = useState<RelationsFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flyToRef = useRef<FlyToFn | null>(null);

  const selectedNode: RelationsNode | null = useMemo(() => {
    if (!data || !selectedId) return null;
    return data.nodes.find((n) => n.id === selectedId) ?? null;
  }, [data, selectedId]);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  // When the search query narrows to exactly one visible node, fly to it.
  useEffect(() => {
    if (!data || !flyToRef.current) return;
    const q = filters.q.trim().toLowerCase();
    if (!q) return;
    const matches = data.nodes.filter((n) => {
      const haystack = `${n.prefix}-${n.number} ${n.title}`.toLowerCase();
      return haystack.includes(q);
    });
    if (matches.length === 1) {
      flyToRef.current(matches[0].id);
    }
  }, [filters.q, data]);

  if (loading && !data) {
    return (
      <div className="placeholder">
        <div className="placeholder__title">Loading relations…</div>
        <div className="placeholder__body">
          Walking the work-item tree. With 50k+ items this may take a few seconds on first load.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="placeholder">
        <div className="placeholder__title">Couldn’t load relations</div>
        <div className="placeholder__body">
          {error.message}
          <button type="button" className="btn btn--secondary" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="ui-relations">
      <RelationsToolbar payload={data} filters={filters} onChange={setFilters} />
      <div className="ui-relations__body">
        <div className="ui-relations__canvas">
          <RelationsGraph
            payload={data}
            filters={filters}
            selectedId={selectedId}
            onSelect={handleSelect}
            onFlyToReady={(fn) => { flyToRef.current = fn; }}
          />
        </div>
        <RelationsSidebar node={selectedNode} onClose={() => handleSelect(null)} />
      </div>
    </div>
  );
}

export type { RelationsPayload };
