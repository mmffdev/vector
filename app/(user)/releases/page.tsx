"use client";

import PageContent from "@/app/components/PageContent";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import TimeboxManager from "@/app/components/TimeboxManager";

export default function ReleasesPage() {
  const { user } = useAuth();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <PageContent>
    <StrictRoute>
      {workspaceId && (
        <TimeboxManager kind="release" workspaceId={workspaceId} />
      )}
    </StrictRoute>
    </PageContent>
  );
}
