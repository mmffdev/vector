"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WorkspaceSettingsRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workspace-settings/workspace-settings/workspaces");
  }, [router]);
  return null;
}
