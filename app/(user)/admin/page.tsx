"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSentinel } from "@/app/sentinel";

// /admin retired as of the workspace/portfolio/account split.
// Redirect preserves old bookmarks. Permission-driven so any future
// role layout reaches the same landing surfaces without code churn.
//   workspace.archive       → gadmin lands at /workspace-settings
//   portfolio.model.edit    → padmin lands at /portfolio-settings
//   neither                 → /dashboard (never had /admin access)
export default function AdminRedirect() {
  const { sentinel_user: user, sentinel_can } = useSentinel();
  const canAdminWorkspace = sentinel_can("workspace.archive");
  const canEditPortfolioModel = sentinel_can("portfolio.model.edit");
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    if (canAdminWorkspace) router.replace("/workspace-admin");
    else if (canEditPortfolioModel) router.replace("/portfolio-settings");
    else router.replace("/dashboard");
  }, [user, canAdminWorkspace, canEditPortfolioModel, router]);

  return null;
}
