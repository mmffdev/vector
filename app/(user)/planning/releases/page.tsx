"use client";

import PageShell from "@/app/components/PageShell";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";
import TimeboxManager from "@/app/components/TimeboxManager";

export default function ReleasesPage() {
  const { user } = useAuth();
  const workspaceId = user?.subscription_id ?? "";

  return (
    <StrictRoute>
      <PageShell
        title="Releases"
        subtitle="Plan and manage your release timeboxes"
      >
        {workspaceId && (
          <TimeboxManager kind="release" workspaceId={workspaceId} />
        )}
      </PageShell>
    </StrictRoute>
  );
}
