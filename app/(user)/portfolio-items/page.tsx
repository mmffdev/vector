"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";

export default function PortfolioItemsPage() {
  const { user } = useAuth();
  const canView = useHasPermission("portfolio_items.view");
  const router = useRouter();

  useEffect(() => {
    if (user && !canView) router.replace("/dashboard");
  }, [user, canView, router]);

  if (!user || !canView) return null;

  return (
    <PageShell
      title="Portfolio Items"
      subtitle="Items rolled up from the active portfolio"
    >
      <div className="placeholder">
        <p>No portfolio items yet.</p>
      </div>
    </PageShell>
  );
}
