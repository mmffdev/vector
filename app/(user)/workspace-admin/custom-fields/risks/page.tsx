"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function CustomFieldsRisksPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Custom fields configured for risks." />
      <Panel
        name="panel_custom_fields_risks_header"
        className="page-panel-heading"
        title="Risk Fields"
        description="Configure custom fields that appear on all risks registered in this workspace."
      />
    <div className="settings-panel">
      <h3 className="eyebrow">Custom fields — Risks</h3>
      <p className="form__hint">
        Placeholder — define tenant-specific fields that attach to risks (likelihood, impact,
        mitigation owner, etc.). Editing arrives in a later iteration.
      </p>
      <div className="empty-state">No custom fields defined yet for Risks.</div>
    </div>
    </PageContent>
  );
}
