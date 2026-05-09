"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import { useRelationsData } from "@/app/hooks/useRelationsData";
import type {
  RelationsNode,
  RelationsPayload,
} from "@/app/api/v2/work-items/relations/route";
import type { RelationsFilters } from "@/app/components/WorkItemRelations";
import { RelationsToolbar } from "@/app/components/WorkItemRelations/RelationsToolbar";
import { RelationsSidebar } from "@/app/components/WorkItemRelations/RelationsSidebar";

// Three.js is heavy + WebGL-only — lazy + ssr:false.
const RelationsGraph = dynamic(
  () =>
    import("@/app/components/WorkItemRelations/RelationsGraph").then(
      (m) => m.RelationsGraph,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="placeholder__body">Loading graph engine…</div>
    ),
  },
);

const DEFAULT_FILTERS: RelationsFilters = {
  q: "",
  types: new Set(),
  maxDepth: null,
  neighbourMode: false,
  neighbourDepth: 2,
};

export type MapRelationship3DProps = {
  /** Substrate-addressable name. Must match /^[a-z0-9_]{1,64}$/.
   *  Resolved address: `<parent>._map_relationship_3d.<name>`. */
  name: string;
  /** Optional pre-fetched payload. Omit to use the built-in fetcher. */
  payload?: RelationsPayload;
  /** Show toolbar (search / type pills / depth / neighbour mode). Default true. */
  showToolbar?: boolean;
  /** Show selection sidebar. Default true. */
  showSidebar?: boolean;
};

/**
 * `<MapRelationship3D>` — generalised 3D force-graph primitive registered
 * under the addressable substrate as `kind="map_relationship_3d"`.
 *
 * One data shape (`RelationsPayload`), two presentation contexts: the
 * work-items relations tab and workspace-settings topology map both
 * mount this with a `name` of their choice. The substrate composes the
 * full address from the surrounding `<Panel>`.
 */
export function MapRelationship3D({
  name,
  payload: payloadProp,
  showToolbar = true,
  showSidebar = true,
}: MapRelationship3DProps) {
  const { Provider } = useRegisterAddressable({
    kind: "map_relationship_3d",
    name,
  });

  // Pull from the shared work-items hook unless the caller injects data.
  const fetched = useRelationsData();
  const data = payloadProp ?? fetched.data;
  const loading = payloadProp ? false : fetched.loading;
  const error = payloadProp ? null : fetched.error;
  const refetch = fetched.refetch;

  const [filters, setFilters] = useState<RelationsFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedNode: RelationsNode | null = useMemo(() => {
    if (!data || !selectedId) return null;
    return data.nodes.find((n) => n.id === selectedId) ?? null;
  }, [data, selectedId]);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  if (loading && !data) {
    return (
      <Provider>
        <div className="placeholder">
          <div className="placeholder__title">Loading map…</div>
          <div className="placeholder__body">
            Walking the relationship tree. With 50k+ nodes the first load may take a few seconds.
          </div>
        </div>
      </Provider>
    );
  }

  if (error) {
    return (
      <Provider>
        <div className="placeholder">
          <div className="placeholder__title">Couldn’t load map</div>
          <div className="placeholder__body">
            {error.message}
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void refetch()}
            >
              Retry
            </button>
          </div>
        </div>
      </Provider>
    );
  }

  if (!data) {
    return <Provider><div /></Provider>;
  }

  return (
    <Provider>
      <div className="ui-relations">
        {showToolbar && (
          <RelationsToolbar payload={data} filters={filters} onChange={setFilters} />
        )}
        <div className="ui-relations__body">
          <div className="ui-relations__canvas">
            <RelationsGraph
              payload={data}
              filters={filters}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </div>
          {showSidebar && (
            <RelationsSidebar
              node={selectedNode}
              onClose={() => handleSelect(null)}
            />
          )}
        </div>
      </div>
    </Provider>
  );
}
