"use client";

// UnsavedChangesBar — sticky footer that announces a dirty form and
// gates the actual write behind an explicit Accept (POST/PATCH) or
// Discard (revert) action. Use this for any "edit a single record"
// page where the user expects to scan many fields and confirm once
// at the end (master_record_tenant being the first consumer).
//
// Visibility is purely caller-controlled via `dirty` — when false the
// bar collapses out of layout entirely. The `saving` flag disables
// both buttons and swaps the accept label so the user gets immediate
// feedback during the network round-trip.
//
// Design choice: this is NOT a toast. Toasts are transient confirmation
// of an event that already happened; this bar is a *commit point*
// that the user must engage with. Built on the existing `.btn` family
// plus the `.unsaved-bar` block in app/globals.css.

import React from "react";

export interface UnsavedChangesBarProps {
  dirty: boolean;
  saving?: boolean;
  message?: string;
  onAccept: () => void;
  onDiscard: () => void;
  acceptLabel?: string;
  discardLabel?: string;
}

export default function UnsavedChangesBar({
  dirty,
  saving = false,
  message = "You have unsaved changes.",
  onAccept,
  onDiscard,
  acceptLabel = "Accept changes",
  discardLabel = "Discard",
}: UnsavedChangesBarProps) {
  if (!dirty) return null;
  return (
    <div
      className="unsaved-bar"
      role="region"
      aria-live="polite"
      aria-label="Unsaved changes"
    >
      <span className="unsaved-bar__msg">{message}</span>
      <div className="unsaved-bar__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onDiscard}
          disabled={saving}
        >
          {discardLabel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onAccept}
          disabled={saving}
        >
          {saving ? "Saving…" : acceptLabel}
        </button>
      </div>
    </div>
  );
}
