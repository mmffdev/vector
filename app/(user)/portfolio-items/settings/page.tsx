"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function PortfolioItemsSettingsPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
    <PageHeading level={1} title={full} subtitle="Configure portfolio item display and behaviour settings." />
    <Panel
      name="panel_portfolio_items_settings_header"
      className="page-panel-heading"
      title="Settings"
      description="Manage display preferences, column visibility, and behaviour settings for portfolio items."
    />
    <Panel name="portfolio_items_settings" title="Portfolio items settings">
      <div className="placeholder">
        <p className="placeholder__body">Strategy layer configuration coming soon.</p>
      </div>
    </Panel>
    </PageContent>
  );
}
