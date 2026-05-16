"use client";

// PLA-0052 Story 13 — Risk-specific Panel header + filter chips.
//
// Risk reuses the work-items WorkItem row shape end-to-end (artefactitems
// listing endpoint returns Risk rows with the same `item_type='risk'` tag).
// What differs is the chrome:
//   - PanelHeader copy is risk-domain ("Risk register" not "Dense grid")
//   - FilterChips surface risk-specific dimensions (severity, likelihood,
//     state) instead of work-items (item_type, status, priority, owner)
//
// Columns + DnD + tree hierarchy are reused unchanged via the wizard
// sidecar's columnsComponent="buildWorkItemsColumns" reference.

import React from "react";

// ─── Filter chips ─────────────────────────────────────────────────────────
//
// Severity / likelihood / state chips. Wire to URL search params identical
// to WorkItemsFilterChips so bookmark behaviour matches. Initially this is a
// placeholder UI; chip-driven filtering against the backend is deferred until
// the /work-items API exposes ?severity= and ?likelihood= filter params.

const SEVERITY_CHIPS = [
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High" },
  { value: "medium",   label: "Medium" },
  { value: "low",      label: "Low" },
];

const LIKELIHOOD_CHIPS = [
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
];

export function RisksFilterChips() {
  return (
    <div className="filter-chips__bar" role="group" aria-label="Risk filters">
      <span className="filter-chips__label">Severity</span>
      {SEVERITY_CHIPS.map((c) => (
        <button
          key={`sev-${c.value}`}
          type="button"
          className="filter-chips__chip"
          disabled
          title="Backend ?severity= filter pending — chip is a UI placeholder"
        >
          {c.label}
        </button>
      ))}
      <span className="filter-chips__label">Likelihood</span>
      {LIKELIHOOD_CHIPS.map((c) => (
        <button
          key={`lik-${c.value}`}
          type="button"
          className="filter-chips__chip"
          disabled
          title="Backend ?likelihood= filter pending — chip is a UI placeholder"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
