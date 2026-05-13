"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function CustomFieldsTasksPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Custom fields configured for tasks." />
      <Panel
        name="panel_custom_fields_tasks_header"
        className="page-panel-heading"
        title="Task Fields"
        description="Configure custom fields that appear on all tasks created in this workspace."
      />
    <div className="settings-panel">
      <h3 className="eyebrow">Custom fields — Tasks</h3>
      <p className="form__hint">
        Placeholder — define tenant-specific fields that attach to tasks. Editing arrives in a
        later iteration.
      </p>
      <div className="empty-state">No custom fields defined yet for Tasks.</div>
    </div>
    </PageContent>
  );
}
