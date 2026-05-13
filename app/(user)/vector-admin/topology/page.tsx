"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import PageContent from "@/app/components/PageContent";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";

const TopologyOverlayPage = dynamic(() => import("@/app/(overlay)/topology/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading topology…</div>,
});

export default function TopologyPage() {
  const { user } = useAuth();
  const canAccess = useHasPermission("workspace.archive");
  const router = useRouter();

  useEffect(() => {
    if (user && !canAccess) router.replace("/workspace-settings");
  }, [user, canAccess, router]);

  if (!user || !canAccess) return null;

  return (
    <PageContent>
    <div className="topology-tab-host">
      <TopologyOverlayPage />
    </div>
    </PageContent>
  );
}
