"use client";

import PageContent from "@/app/components/PageContent";

export default function CustomFieldsRisksPage() {
  return (
    <PageContent>
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
