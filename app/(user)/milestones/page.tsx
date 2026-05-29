"use client";

// Milestones page — point-in-time delivery markers.
//
// Mirrors app/(user)/sprints/page.tsx with the required-topology-node
// gate. The TimeboxObjectTree component handles kind="milestone"
// branching internally (column set, bulk-config, list envelope).

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useSentinel } from "@/app/sentinel";
import TimeboxObjectTree from "@/app/components/TimeboxObjectTree";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function MilestonesPage() {
  const { full } = usePageTitle();
  const { sentinel_user: user, sentinel_focus_node: activeNodeId } = useSentinel();
  const workspaceId = user?.tenant_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Track milestones and target dates for the workspace." />
      <PageDescription>
        Create and manage milestones — point-in-time delivery markers anchored to a topology node. Pin a node in the rail above before creating.
      </PageDescription>
      <StrictRoute>
        {workspaceId && activeNodeId && (
          <TimeboxObjectTree
            key={activeNodeId}
            kind="milestone"
            workspaceId={workspaceId}
            orgNodeId={activeNodeId}
          />
        )}
        {workspaceId && !activeNodeId && (
          <Panel
            name="panel_milestones_no_focus_node"
            title="Pick a topology node"
            description="Milestones belong to a team / squad / value-stream node — focus one in the rail above to list its milestones or create new ones."
          />
        )}
      </StrictRoute>
    </PageContent>
  );
}
