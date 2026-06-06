"use client";

// Workspace Metrics page — sibling of /workspace-admin/workspace-details,
// conceptually parented under the Workspace Details area. Created 2026-06-06 as
// a home for metric-based workspace options (Scrum metrics first). It is NOT
// registered in the rail2 nav (no `pages` entry); it is reached by direct URL /
// a link placed from workspace-details later.
//
// Gate: identical to workspace-details — sentinel_can("workspace.archive").
// Server-is-the-gate: the metric options that land here will write their OWN
// backend permission checks; this client redirect is defence-in-depth only.
//
// Current state: STUB. The "Scrum Metrics" panel is an intentional placeholder
// so the page exists and the slot is visible; its options are not built yet.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { useSentinel } from "@/app/sentinel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function WorkspaceMetricsPage() {
  const { sentinel_user, sentinel_can } = useSentinel();
  const canAccess = sentinel_can("workspace.archive");
  const router = useRouter();
  const { full } = usePageTitle();

  useEffect(() => {
    if (sentinel_user && !canAccess) router.replace("/workspace-admin");
  }, [sentinel_user, canAccess, router]);

  if (!sentinel_user || !canAccess) return null;

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Metric-based options for this workspace." />
      <PageDescription>
        Configure metric-based options for this workspace. Scrum metrics will be the first set of options surfaced here.
      </PageDescription>

      <Panel
        name="panel_scrum_metrics"
        title="Scrum Metrics"
        description="Placeholder — Scrum metric options will be configured here."
      >
        <p className="form__hint">
          Stub panel. This page is intentionally empty for now; Scrum metric controls will be added here.
        </p>
      </Panel>
    </PageContent>
  );
}
