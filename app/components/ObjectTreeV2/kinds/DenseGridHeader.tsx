"use client";

// <DenseGridHeader> — sunken header band (the "05 Dense grid · 28px rows…"
// strip in the work-items reference screenshot). Slice 3 of the
// ObjectTree refactor.
//
// Pure presentation. All content comes through props. Three slots:
//   badge       — short identifier in a square at the left (e.g. "05",
//                 "V2", "RSK", or a number)
//   subtitle    — primary heading text
//   description — secondary line under the subtitle
//
// All three are optional. When all three are null/empty, the component
// renders nothing — used to suppress the band on grids that don't need
// it (e.g. /scope harness with no subtitle).
//
// CSS classes are already in the project's catalog
// (tree_accordion-dense__panel-head*) — Slice 3 only moves the
// rendering from ObjectTree's inline JSX into this component.

import React from "react";

export interface DenseGridHeaderProps {
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
}

export function DenseGridHeader({
  badge,
  subtitle,
  description,
}: DenseGridHeaderProps) {
  if (!badge && !subtitle && !description) return null;
  return (
    <header className="tree_accordion-dense__panel-head">
      {badge && (
        <span className="tree_accordion-dense__panel-head-num">{badge}</span>
      )}
      <div className="tree_accordion-dense__panel-head-body">
        {subtitle && (
          <h3 className="tree_accordion-dense__panel-head-title">{subtitle}</h3>
        )}
        {description && (
          <p className="tree_accordion-dense__panel-head-subtitle">{description}</p>
        )}
      </div>
    </header>
  );
}
