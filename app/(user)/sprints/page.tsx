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
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { useScope } from "@/app/contexts/ScopeContext";
import TimeboxObjectTree from "@/app/components/TimeboxObjectTree";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function SprintsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const { activeNodeId } = useScope();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage active and planned sprints for the workspace." />
      <PageDescription>
        Create and manage sprints, assign work items, and track sprint progress and velocity.
      </PageDescription>
      <StrictRoute>
        {workspaceId && (
          <TimeboxObjectTree
            key={activeNodeId ?? "root"}
            kind="sprint"
            workspaceId={workspaceId}
            orgNodeId={activeNodeId ?? undefined}
          />
        )}
      </StrictRoute>
    </PageContent>
  );
}
