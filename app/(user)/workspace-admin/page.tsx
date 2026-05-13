"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WorkspaceAdminRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workspace-admin/workspaces");
  }, [router]);
  return null;
}
