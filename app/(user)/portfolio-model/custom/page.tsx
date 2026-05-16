"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function PortfolioModelCustomPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const canEditModel = useHasPermission("portfolio.model.edit");
  const router = useRouter();

  useEffect(() => {
    if (user && !canEditModel) router.replace("/dashboard");
  }, [user, canEditModel, router]);

  if (!user || !canEditModel) return null;

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Create and customise portfolio model layers." />
      <Panel
        name="panel_portfolio_model_custom_header"
        className="page-panel-heading"
        title="Custom Portfolio Model"
        description="Design custom portfolio model layers, names, and hierarchy to match your organisation structure."
      />
      <div className="placeholder">
        <h3 className="placeholder__title">Custom hierarchy</h3>
        <p className="placeholder__body">Coming soon.</p>
      </div>
    </PageContent>
  );
}
