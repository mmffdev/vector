"use client";

// scopeColumns — the /scope column descriptors + cell renderers for the new
// Grid primitive. Salvaged from the old p_workItems_dataGridConfig.tsx column
// set, retyped to GridColumn<ScopeNode>.
//
// KEY CHANGE: the primary (Summary) cell no longer draws SVG tree-lines or its
// own expander. The skin (Grid__Row) renders the caret in the primary cell and
// the CSS-border connector system draws ├/└ off DOM nesting. So SummaryCell is
// now just the label — the whole PrimaryCellTreeLines / PrimaryCellExpander
// import (the connector-bug surface) is gone.

import type { GridColumn } from "@/app/components/Grid/types";
import type { ScopeNode } from "./scopeTreeData";

function TypeBadge({ type }: { type: string }) {
  return <span className="grid__Cell_TypeBadge">{type}</span>;
}

function IdCell({ row }: { row: ScopeNode }) {
  return (
    <span className="grid__Cell_Id">
      <TypeBadge type={row.type} />
      <span className="grid__Cell_IdText">{row.id}</span>
    </span>
  );
}

function StatusPills({ status }: { status: string }) {
  const stages = ["T", "I", "D", "C"];
  return (
    <span className="grid__Cell_StatusPills">
      {stages.map((s) => (
        <span
          key={s}
          className={
            s === status
              ? "grid__Cell_StatusPill grid__Cell_StatusPill--active"
              : "grid__Cell_StatusPill"
          }
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function OwnerPill({ name }: { name: string }) {
  return <span className="grid__Cell_OwnerPill">{name}</span>;
}

// Column descriptors. The caret + indentation live in the skin; renderCell
// returns content only. The Summary column is the flex column (defaultWidth
// null) and is the PRIMARY column (index 0 would be ID — but the caret renders
// in the first column, so ID carries the caret). Keep ID first to match the
// old layout; the skin puts the caret in column 0 (ID) and indentation via the
// _Children padding, so the tree reads left-to-right exactly as before.
export const scopeColumns: GridColumn<ScopeNode>[] = [
  {
    id: "id",
    label: "ID",
    defaultWidth: 160,
    sortable: true,
    resizable: true,
    renderCell: (r) => <IdCell row={r} />,
  },
  {
    id: "summary",
    label: "Summary",
    defaultWidth: null, // flex
    sortable: true,
    renderCell: (r) => <span className="grid__Cell_Summary">{r.summary}</span>,
  },
  {
    id: "status",
    label: "Status",
    defaultWidth: 220,
    sortable: true,
    resizable: true,
    renderCell: (r) => <StatusPills status={r.status} />,
  },
  {
    id: "points",
    label: "Pts",
    defaultWidth: 70,
    sortable: true,
    resizable: true,
    renderCell: (r) => (r.points === null ? "—" : r.points),
  },
  {
    id: "owner",
    label: "Owner",
    defaultWidth: 130,
    sortable: true,
    resizable: true,
    renderCell: (r) => <OwnerPill name={r.owner} />,
  },
  {
    id: "parent",
    label: "Parent",
    defaultWidth: 200,
    sortable: true,
    resizable: true,
    renderCell: (r) => r.parent ?? "—",
  },
  {
    id: "sprint",
    label: "Sprint",
    defaultWidth: 140,
    sortable: true,
    resizable: true,
    renderCell: (r) => r.sprint ?? "—",
  },
  {
    id: "due",
    label: "Due",
    defaultWidth: 100,
    sortable: true,
    resizable: true,
    renderCell: (r) => r.due ?? "—",
  },
];
