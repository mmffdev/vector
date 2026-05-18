"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

const TopologyOverlayPage = dynamic(() => import("@/app/(overlay)/topology/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading topology…</div>,
});

export default function TopologyPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const canAccess = useHasPermission("workspace.archive");
  const router = useRouter();

  useEffect(() => {
    if (user && !canAccess) router.replace("/workspace-admin");
  }, [user, canAccess, router]);

  if (!user || !canAccess) return null;

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
