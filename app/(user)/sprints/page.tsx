"use client";

// PLA-0027 / Story 00517+00518 — Sprint timebox management page.
// Visible to users with role 'user' or 'padmin' (page_roles in DB).
//
// Slice 6.3c of the ObjectTree refactor (2026-05-21) — swapped from the
// legacy <TimeboxManager> to <TimeboxObjectTree>, which composes V2
// primitives (DenseGridHeader, ActionBar with single + bulk, the inline
// BulkCreateSheet, ObjectTreeDetailFlyout + TimeboxInlineForm).
// TimeboxManager + useTimebox + timebox/kinds.ts are deleted in slice
// 6.5 once the release page has swapped too.

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useSentinel } from "@/app/sentinel";
import TimeboxObjectTree from "@/app/components/TimeboxObjectTree";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function SprintsPage() {
  const { full } = usePageTitle();
  const { sentinel_user: user, sentinel_focus_node: activeNodeId } = useSentinel();
  const workspaceId = user?.tenant_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage active and planned sprints for the workspace." />
      <PageDescription>
        Create and manage sprints, assign work items, and track sprint progress and velocity. Sprints are pinned to the topology node currently in focus — pick a node before creating.
      </PageDescription>
      <StrictRoute>
        {workspaceId && activeNodeId && (
          <TimeboxObjectTree
            key={activeNodeId}
            kind="sprint"
            workspaceId={workspaceId}
            orgNodeId={activeNodeId}
          />
        )}
        {workspaceId && !activeNodeId && (
          <Panel
            name="panel_sprints_no_focus_node"
            title="Pick a topology node"
            description="Sprints belong to a team / squad / value-stream node — focus one in the rail above to list its sprints or create new ones."
          />
        )}
      </StrictRoute>
    </PageContent>
  );
}
