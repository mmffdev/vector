"use client";

// PLA-0027 / Story 00517+00518 — Sprint timebox management page.
// Visible to users with role 'user' or 'padmin' (page_roles in DB).

import PageContent from "@/app/components/PageContent";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import TimeboxManager from "@/app/components/TimeboxManager";

export default function SprintsPage() {
  const { user } = useAuth();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <PageContent>
    <StrictRoute>
      {workspaceId && (
        <TimeboxManager kind="sprint" workspaceId={workspaceId} />
      )}
    </StrictRoute>
    </PageContent>
  );
}
