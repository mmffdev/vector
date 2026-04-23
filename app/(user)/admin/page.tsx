"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";

// /admin retired as of the workspace/portfolio/account split.
// Redirect preserves old bookmarks.
// - gadmin  → /workspace-settings (user management lives there now)
// - padmin  → /portfolio-settings (closest equivalent for their remit)
// - user    → /dashboard (never had /admin access)
export default function AdminRedirect() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    if (user.role === "gadmin") router.replace("/workspace-settings");
    else if (user.role === "padmin") router.replace("/portfolio-settings");
    else router.replace("/dashboard");
  }, [user, router]);

  return null;
}
