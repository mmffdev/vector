"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import type { RelationsNode, RelationsPayload, RelationsFilters } from "@/app/components/MapRelationship3D/types";
import { DEFAULT_RELATIONS_FILTERS } from "@/app/components/MapRelationship3D/types";
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

export type MapRelationship3DProps = {
  /** Substrate-addressable name. Must match /^[a-z0-9_]{1,64}$/.
   *  Resolved address: `<parent>._map_relationship_3d.<name>`. */
  name: string;
  /** Pre-fetched payload. The component is data-driven by design — the caller
   *  owns fetching (typically via useTopologyRelationsPayload, which goes
   *  through apiSite). The previous "omit to use the built-in fetcher" mode
   *  pointed at a broken Next.js shadow handler and was removed 2026-05-19. */
  payload: RelationsPayload;
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
  payload: data,
  showToolbar = true,
  showSidebar = true,
}: MapRelationship3DProps) {
  const { Provider } = useRegisterAddressable({
    kind: "map_relationship_3d",
    name,
  });

  const [filters, setFilters] = useState<RelationsFilters>(DEFAULT_RELATIONS_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedNode: RelationsNode | null = useMemo(() => {
    if (!selectedId) return null;
    return data.nodes.find((n) => n.id === selectedId) ?? null;
  }, [data, selectedId]);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

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
