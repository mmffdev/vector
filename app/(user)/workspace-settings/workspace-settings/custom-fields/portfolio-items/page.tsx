"use client";

import PageContent from "@/app/components/PageContent";

export default function CustomFieldsPortfolioItemsPage() {
  return (
    <PageContent>
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
