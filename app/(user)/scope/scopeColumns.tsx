"use client";

// scopeColumns — the /scope column descriptors + cell renderers for the new
// Grid primitive. Salvaged from the old p_workItems_dataGridConfig.tsx column
// set, retyped to GridColumn<ScopeNode>.
//
// KEY CHANGE: the primary (Summary) cell no longer draws SVG tree-lines or its
// own expander. The skin (Grid__Tree_Row) renders the caret in the primary cell and
// the CSS-border connector system draws ├/└ off DOM nesting. So SummaryCell is
// now just the label — the whole PrimaryCellTreeLines / PrimaryCellExpander
// import (the connector-bug surface) is gone.

import type { GridColumn } from "@/app/components/Grid/types";
import type { ScopeNode } from "./scopeTreeData";

// Prefix → OTV2 gray-ramp tier. Strategic types sit at the dark end, execution
// types lighten down the ladder (Epic → Story/Defect → Task). Unknown prefixes
// fall to the mid "story" gray so a new type still reads as a badge.
const TIER_BY_PREFIX: Record<string, string> = {
  TH: "strategy-top", // Theme
  IN: "strategy-mid", // Initiative
  FE: "strategy-bottom", // Feature
  EP: "epic",
  US: "story",
  ST: "story",
  DE: "defect",
  TA: "task",
  TK: "task",
};

function TypeBadge({ type }: { type: string }) {
  const tier = TIER_BY_PREFIX[type] ?? "story";
  return (
    <span className="grid__Cell_TypeBadge" data-tier={tier}>
      {type}
    </span>
  );
}

function IdCell({ row }: { row: ScopeNode }) {
  return (
    <span className="grid__Cell_Id">
      <TypeBadge type={row.type} />
      <span className="grid__Cell_IdText">{row.id}</span>
    </span>
  );
}

// Flow-state chevron ribbon — reuses OTV2's wi-flow-row CSS verbatim (the
// clip-path chevron pills already live in globals.css). The /scope status is a
// single glyph (T/I/D/C); we render the canonical 4-stage ladder and fill the
// active one with its --code/--active modifier so the ribbon reads identically
// to the work-items grid. Non-interactive here (display only) — aria-disabled.
const FLOW_STAGES: { glyph: string; code: string; label: string }[] = [
  { glyph: "T", code: "todo", label: "To Do" },
  { glyph: "I", code: "doing", label: "In Progress" },
  { glyph: "D", code: "doing", label: "Doing" },
  { glyph: "C", code: "completed", label: "Done" },
];

function FlowRow({ status }: { status: string }) {
  return (
    <span className="wi-flow-row wi-flow-row--derived" role="group" aria-label="Status">
      {FLOW_STAGES.map((s, i) => {
        const active = s.glyph === status;
        const cls = [
          "wi-flow-row__btn",
          `wi-flow-row__btn--code-${s.code}`,
          active ? "wi-flow-row__btn--active" : "",
          active ? `wi-flow-row__btn--active-${s.code}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={`${s.glyph}-${i}`}
            type="button"
            className={cls}
            aria-pressed={active}
            aria-disabled="true"
            aria-label={s.label}
            title={s.label}
          >
            <span className="wi-flow-row__btn_Label">{s.glyph}</span>
          </button>
        );
      })}
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
    renderCell: (r) => <FlowRow status={r.status} />,
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
