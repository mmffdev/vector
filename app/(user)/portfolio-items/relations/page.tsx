"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function PortfolioItemRelationsPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
    <PageHeading level={1} title={full} subtitle="View and manage relationships between portfolio items." />
    <Panel
      name="panel_portfolio_items_relations_header"
      className="page-panel-heading"
      title="Relations"
      description="Explore and manage dependency and relationship links between portfolio items."
    />
    <Panel name="portfolio_items_relations" title="Relations graph">
      <div className="placeholder">
        <p className="placeholder__body">Strategy item relations graph coming soon.</p>
      </div>
    </Panel>
    </PageContent>
  );
}
