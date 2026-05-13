"use client";

import PageContent from "@/app/components/PageContent";

export default function CustomFieldsDefectsPage() {
  return (
    <PageContent>
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
