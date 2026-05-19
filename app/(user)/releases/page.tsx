"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import TimeboxManager from "@/app/components/TimeboxManager";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function ReleasesPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Plan, track, and publish workspace releases." />
      <PageDescription>
        Plan and manage workspace releases, track progress, and coordinate delivery timelines.
      </PageDescription>
      <Panel
        name="panel_releases_header"
        className="page-panel-heading"
        title="Releases"
        description="Plan and manage workspace releases, track progress, and coordinate delivery timelines."
      />
    <StrictRoute>
      {workspaceId && (
        <TimeboxManager kind="release" workspaceId={workspaceId} />
      )}
    </StrictRoute>
    </PageContent>
  );
}
