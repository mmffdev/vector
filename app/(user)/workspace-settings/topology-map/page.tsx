"use client";

import Panel from "@/app/components/Panel";
import { MapRelationship3D } from "@/app/components/MapRelationship3D";
import { useTopologyRelationsPayload } from "@/app/hooks/useTopologyRelationsPayload";

export default function WorkspaceSettingsTopologyMapPage() {
  const { data, loading, error, refetch } = useTopologyRelationsPayload();

  return (
    <Panel name="workspace_settings_topology_map" title="Topology map">
      {loading && !data ? (
        <div className="placeholder">
          <div className="placeholder__title">Loading topology…</div>
          <div className="placeholder__body">
            Walking the org tree.
          </div>
        </div>
      ) : error ? (
        <div className="placeholder">
          <div className="placeholder__title">Couldn’t load topology</div>
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
      ) : data ? (
        <MapRelationship3D name="workspace_topology_map" payload={data} />
      ) : null}
    </Panel>
  );
}
