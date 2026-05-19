"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function Portfolio() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Portfolio-level view of items and outcomes." />
      <PageDescription>
        View and manage portfolio items across all layers of the portfolio model.
      </PageDescription>
      <Panel
        name="panel_portfolio_header"
        className="page-panel-heading"
        title="Portfolio"
        description="View and manage portfolio items across all layers of the portfolio model."
      />
      <p className="placeholder">Portfolio view coming soon.</p>
    </PageContent>
  );
}
