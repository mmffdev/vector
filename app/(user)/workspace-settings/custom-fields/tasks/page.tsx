"use client";

export default function CustomFieldsTasksPage() {
  return (
    <div className="settings-panel">
      <h3 className="eyebrow">Custom fields — Tasks</h3>
      <p className="form__hint">
        Placeholder — define tenant-specific fields that attach to tasks. Editing arrives in a
        later iteration.
      </p>
      <div className="empty-state">No custom fields defined yet for Tasks.</div>
    </div>
  );
}
