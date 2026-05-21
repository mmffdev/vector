"use client";

// Releases page.
//
// Slice 6.4 of the ObjectTree refactor (2026-05-21) — swapped from the
// legacy <TimeboxManager> to <TimeboxObjectTree>. See the sprints page
// comment header for the design rationale.

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { useScope } from "@/app/contexts/ScopeContext";
import TimeboxObjectTree from "@/app/components/TimeboxObjectTree";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function ReleasesPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const { activeNodeId } = useScope();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Plan, track, and publish workspace releases." />
      <PageDescription>
        Plan and manage workspace releases, track progress, and coordinate delivery timelines.
      </PageDescription>
      <StrictRoute>
        {workspaceId && (
          <TimeboxObjectTree
            key={activeNodeId ?? "root"}
            kind="release"
            workspaceId={workspaceId}
            orgNodeId={activeNodeId ?? undefined}
          />
        )}
      </StrictRoute>
    </PageContent>
  );
}
