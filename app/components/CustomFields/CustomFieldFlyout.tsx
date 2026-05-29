"use client";

// CustomFieldFlyout — thin shell that wraps <CustomFieldEditForm> in the
// inline OTV2 flyout chrome (header + close button). The form owns the
// two-column layout (form on the left, TypeBindingsPicker on the right);
// this shell just hosts it.
//
// Mounted by the CustomFieldsAdapter for both row-click (edit) and the
// header create-action (create-new). The same `initial` prop drives
// edit-vs-create: WorkspaceField → edit; null → create.
//
// Plan: docs/superpowers/plans/2026-05-28-objecttree-generic-rowtype.md
// (Task 3, Step 3).

import CustomFieldEditForm from "@/app/components/CustomFields/CustomFieldEditForm";
import type { WorkspaceField } from "@/app/lib/fieldsApi";

interface Props {
  workspaceId: string;
  initial: WorkspaceField | null;
  onClose: () => void;
  onSaved: (next: WorkspaceField) => void;
}

export default function CustomFieldFlyout({
  workspaceId,
  initial,
  onClose,
  onSaved,
}: Props) {
  return (
    <div className="custom-field-flyout">
      <div className="custom-field-flyout__Header">
        <h3>{initial ? `Edit: ${initial.label}` : "Create field"}</h3>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <CustomFieldEditForm
        workspaceId={workspaceId}
        initial={initial}
        onCancel={onClose}
        onSaved={onSaved}
      />
    </div>
  );
}
