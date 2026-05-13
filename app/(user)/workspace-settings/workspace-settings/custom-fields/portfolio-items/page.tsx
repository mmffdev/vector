"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function CustomFieldsPortfolioItemsPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Custom fields configured for portfolio items." />
      <Panel
        name="panel_custom_fields_portfolio_items_header"
        className="page-panel-heading"
        title="Portfolio Item Fields"
        description="Configure custom fields that appear on portfolio items in this workspace."
      />
    <div className="settings-panel">
      <h3 className="eyebrow">Custom fields — Portfolio Items</h3>
      <p className="form__hint">
        Placeholder — define tenant-specific fields that attach to portfolio artefacts at every
        layer of your portfolio model. Editing arrives in a later iteration.
      </p>
      <div className="empty-state">No custom fields defined yet for Portfolio Items.</div>
    </div>
    </PageContent>
  );
}
