"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";

export default function PortfolioModelCustomPage() {
  const { user } = useAuth();
  const canEditModel = useHasPermission("portfolio.model.edit");
  const router = useRouter();

  useEffect(() => {
    if (user && !canEditModel) router.replace("/dashboard");
  }, [user, canEditModel, router]);

  if (!user || !canEditModel) return null;

  return (
    <PageShell
      title="Portfolio Model"
      subtitle="Custom hierarchy"
    >
      <div className="placeholder">
        <h3 className="placeholder__title">Custom hierarchy</h3>
        <p className="placeholder__body">Coming soon.</p>
      </div>
    </PageShell>
  );
}
