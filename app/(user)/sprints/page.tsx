"use client";

// PLA-0027 / Story 00517+00518 — Sprint timebox management page.
// Visible to users with role 'user' or 'padmin' (page_roles in DB).

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import TimeboxManager from "@/app/components/TimeboxManager";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function SprintsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage active and planned sprints for the workspace." />
      <PageDescription>
        Create and manage sprints, assign work items, and track sprint progress and velocity.
      </PageDescription>
      <Panel
        name="panel_sprints_header"
        className="page-panel-heading"
        title="Sprints"
        description="Create and manage sprints, assign work items, and track sprint progress and velocity."
      />
    <StrictRoute>
      {workspaceId && (
        <TimeboxManager kind="sprint" workspaceId={workspaceId} />
      )}
    </StrictRoute>
    </PageContent>
  );
}
