// BoardColumnHeader — FB1.3.3
//
// Renders the WIP header for a single FlowBoard column in one of 5 states:
//
//   under    count=3,  wipLimit=10  → "Doing (3/10)"
//   at       count=10, wipLimit=10  → "Doing (10/10)"           no badge, no red
//   over     count=11, wipLimit=10  → "Doing (11/10)" + "+1"    + red state class
//   unlimited count=11, wipLimit=null → "Doing (11)"            no slash, no badge
//   empty    count=0,  wipLimit=null → "Doing (0)"
//            count=0,  wipLimit=10  → "Doing (0/10)"
//
// Spec: docs/superpowers/specs/2026-05-27-flowboard-design.md §7.3
// CSS:  app/globals.css (flow-board__ColumnHeader block)
// No "use client" pragma — pure presentational, no hooks.

import React from "react";

export interface BoardColumnHeaderProps {
  /** The flow_state name, e.g. "Doing" */
  title: string;
  /** Current artefact count in this column */
  count: number;
  /** null = unlimited (no WIP row in DB) */
  wipLimit: number | null;
}

/**
 * BoardColumnHeader renders the Kanban column title + WIP count badge.
 *
 * Over-limit state adds a "+N" overage badge AND a red modifier class on the
 * outer container so the entire column header signals the breach.
 */
export function BoardColumnHeader({
  title,
  count,
  wipLimit,
}: BoardColumnHeaderProps): React.ReactElement {
  const isOver = wipLimit !== null && count > wipLimit;
  const overage = isOver ? count - wipLimit! : 0;

  // Build the "(count)" or "(count/limit)" label portion.
  const countLabel = wipLimit !== null ? `${count}/${wipLimit}` : `${count}`;

  return (
    <div
      className={
        isOver
          ? "flow-board__ColumnHeader flow-board__ColumnHeader-over"
          : "flow-board__ColumnHeader"
      }
    >
      <span className="flow-board__ColumnHeader_title">
        {title}
      </span>
      <span className="flow-board__ColumnHeader_countLabel">
        ({countLabel})
      </span>
      {isOver && (
        <span
          className="flow-board__ColumnHeader_badge-overage"
          aria-label={`${overage} over WIP limit`}
        >
          +{overage}
        </span>
      )}
    </div>
  );
}
