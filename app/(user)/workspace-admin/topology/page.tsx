"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import { useSentinel } from "@/app/sentinel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

const TopologyOverlayPage = dynamic(() => import("@/app/(overlay)/topology/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading topology…</div>,
});

export default function TopologyPage() {
  const { full } = usePageTitle();
  // PLA062 S13: identity + permission via Sentinel.
  const { sentinel_user, sentinel_can } = useSentinel();
  const canAccess = sentinel_can("workspace.archive");
  const router = useRouter();

  useEffect(() => {
    if (sentinel_user && !canAccess) router.replace("/workspace-admin");
  }, [sentinel_user, canAccess, router]);

  if (!sentinel_user || !canAccess) return null;

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage organisation topology nodes and structure." />
      <PageDescription>
        Create and manage organisation topology nodes, hierarchy, and administrative assignments.
      </PageDescription>
      <div className="topology-tab-host">
        <TopologyOverlayPage />
      </div>
    </PageContent>
  );
}
