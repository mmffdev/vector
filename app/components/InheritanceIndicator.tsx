"use client";

// InheritanceIndicator — small inline component showing where a field's
// value came from (workspace override / inherited from tenant / system
// default) plus the corresponding action button.
//
// PLA-0051 / Story 6. Renders next to inheritable fields on the
// workspace-details editor. Three states:
//
//   source=workspace → "Override" chip + "Revert to inherited" button
//   source=tenant    → "Inherited from Tenant" chip + "Override" button
//   source=system_default → "Default" chip + "Override" button
//
// onRevert  is called when the user clicks "Revert to inherited" on an
//           override → caller PATCHes with clear_overrides=[fieldName].
// onOverride is a hint to the parent form: the user wants to take a
//           local override on this field. The parent may just enable
//           the input for editing; no API call until the form is saved.
//
// Atoms are catalog .pill and .btn classes. The only bespoke class is
// .inheritance-indicator__Root for the inline-flex layout that holds
// the chip + button beside the field label.

import type { FieldSource } from "@/app/lib/workspaceSettingsApi";

interface Props {
  source: FieldSource | undefined;
  onRevert: () => void;
  onOverride: () => void;
  /** Disable buttons (e.g. during a save in flight). */
  busy?: boolean;
}

export default function InheritanceIndicator({ source, onRevert, onOverride, busy }: Props) {
  // Undefined source = the API didn't supply a marker. Backward-compat
  // for any consumer that gets a pre-PLA-0051 wire shape — render nothing.
  if (!source) return null;

  const isOverride = source === "workspace";
  const chipLabel =
    source === "workspace"
      ? "Override"
      : source === "tenant"
        ? "Inherited from Tenant"
        : "Default";
  const chipTone =
    source === "workspace" ? "pill--info" : source === "tenant" ? "pill--success" : "pill--neutral";

  return (
    <span className="inheritance-indicator__Root">
      <span className={`pill ${chipTone}`}>{chipLabel}</span>
      {isOverride ? (
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          onClick={onRevert}
          disabled={busy}
          title="Clear this override; the field will inherit from the tenant defaults"
        >
          Revert to inherited
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--ghost btn--xs"
          onClick={onOverride}
          disabled={busy}
          title="Set a workspace-level override for this field"
        >
          Override
        </button>
      )}
    </span>
  );
}
