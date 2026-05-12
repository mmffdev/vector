"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
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
    <PageContent>
      <div className="placeholder">
        <h3 className="placeholder__title">Custom hierarchy</h3>
        <p className="placeholder__body">Coming soon.</p>
      </div>
    </PageContent>
  );
}
