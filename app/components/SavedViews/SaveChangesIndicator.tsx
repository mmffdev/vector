"use client";

// SaveChangesIndicator — appears next to the dropdown when the active
// view body differs from the consumer's current state.

import React from "react";

export interface SaveChangesIndicatorProps {
  isDirty: boolean;
  hasActiveView: boolean;
  onSave: () => void;
  saving?: boolean;
}

export function SaveChangesIndicator(props: SaveChangesIndicatorProps) {
  const { isDirty, hasActiveView, onSave, saving } = props;
  if (!isDirty || !hasActiveView) return null;
  return (
    <button
      type="button"
      className="saved-views__SaveChanges"
      onClick={onSave}
      disabled={saving}
    >
      {saving ? "Saving…" : "Save Changes"}
    </button>
  );
}
