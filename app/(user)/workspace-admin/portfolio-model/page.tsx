"use client";

import dynamic from "next/dynamic";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

const PortfolioModelPage = dynamic(() => import("@/app/(user)/portfolio-model/page"), {
  ssr: false,
  loading: () => <div className="topology-tab-host__loading">Loading portfolio model…</div>,
});

export default function PortfolioModelTabPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Review and configure the portfolio model structure." />
      <Panel
        name="panel_portfolio_model_header"
        className="page-panel-heading"
        title="Portfolio Model"
        description="View and manage the portfolio layer model that structures items in this workspace."
      />
    <div className="ws-tab-embed">
      <PortfolioModelPage />
    </div>
    </PageContent>
  );
}
