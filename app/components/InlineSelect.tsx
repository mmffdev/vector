"use client";

import React, { useState } from "react";

// Click-to-open native select. Trigger renders the parent-supplied node;
// when clicked it swaps to a focused <select> that commits on change.
// Stops pointer + click propagation so a click doesn't also trigger row
// selection or drag-source pickup.
export function InlineSelect({
  value,
  options,
  onCommit,
  ariaLabel,
  trigger,
  placeholder = "—",
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (next: string) => void;
  ariaLabel: string;
  trigger: React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className="form__select form__select--sm"
        value={value}
        aria-label={ariaLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const next = e.target.value;
          setEditing(false);
          if (next !== value) onCommit(next);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  return (
    <span
      className="inline-edit-trigger"
      title="Click to edit"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {trigger}
    </span>
  );
}
