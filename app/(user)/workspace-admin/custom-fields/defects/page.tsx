"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function CustomFieldsDefectsPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Custom fields configured for defects." />
      <Panel
        name="panel_custom_fields_defects_header"
        className="page-panel-heading"
        title="Defect Fields"
        description="Configure custom fields that appear on all defects logged in this workspace."
      />
    <div className="settings-panel">
      <h3 className="eyebrow">Custom fields — Defects</h3>
      <p className="form__hint">
        Placeholder — define tenant-specific fields that attach to defects (severity, root cause,
        component, environment, etc.). Editing arrives in a later iteration.
      </p>
      <div className="empty-state">No custom fields defined yet for Defects.</div>
    </div>
    </PageContent>
  );
}
