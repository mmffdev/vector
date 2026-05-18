"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { MapRelationship3D } from "@/app/components/MapRelationship3D";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { useTopologyRelationsPayload } from "@/app/hooks/useTopologyRelationsPayload";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function WorkspaceAdminTopologyMapPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const canAccess = useHasPermission("workspace.archive");
  const router = useRouter();

  useEffect(() => {
    if (user && !canAccess) router.replace("/workspace-admin");
  }, [user, canAccess, router]);

  if (!user || !canAccess) return null;

  const { data, loading, error, refetch } = useTopologyRelationsPayload();

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Visual map of the organisation topology structure." />
      <PageDescription>
        Explore the visual representation of the organisation topology and node relationships.
      </PageDescription>
      <Panel name="workspace_admin_topology_map" title="Topology map">
        {loading && !data ? (
          <div className="placeholder">
            <div className="placeholder__title">Loading topology…</div>
            <div className="placeholder__body">Walking the org tree.</div>
          </div>
        ) : error ? (
          <div className="placeholder">
            <div className="placeholder__title">Couldn't load topology</div>
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
    </PageContent>
  );
}
