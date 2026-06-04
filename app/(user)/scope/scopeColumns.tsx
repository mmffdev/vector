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
import { FlowStatePillRow } from "@/app/components/FlowStatePillRow";
import type { WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";
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

// IdCell — the type badge and the artefact ID both open the inline edit flyout
// for that row (onOpenForm). The ID is rendered as a link-styled button so
// keyboard and pointer users get the same affordance.
function IdCell({
  row,
  onOpenForm,
}: {
  row: ScopeNode;
  onOpenForm?: (id: string) => void;
}) {
  return (
    <span className="grid__Cell_Id">
      <button
        type="button"
        className="grid__Cell_TypeBadgeBtn"
        aria-label={`Edit ${row.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenForm?.(row.id);
        }}
      >
        <TypeBadge type={row.type} />
      </button>
      <button
        type="button"
        className="grid__Cell_IdText grid__Cell_IdText--link"
        aria-label={`Edit ${row.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenForm?.(row.id);
        }}
      >
        {row.id}
      </button>
    </span>
  );
}

function StatusCell({
  row,
  flowStatesByType,
}: {
  row: ScopeNode;
  flowStatesByType?: Map<string, WorkItemFlowState[]>;
}) {
  const states = flowStatesByType?.get(row.artefactTypeId) ?? [];
  const renderedStates =
    states.length > 0
      ? states
      : [
          {
            id: row.flowStateId,
            flow_position: 0,
            name: row.flowStateName || row.flowStateCode || "Status",
            canonical_code: row.flowStateCode || "backlog",
            artefact_type_id: row.artefactTypeId,
          },
        ];

  return (
    <FlowStatePillRow
      currentId={row.flowStateId}
      states={renderedStates}
      onCommit={() => {}}
      readOnly
    />
  );
}

function OwnerPill({ name }: { name: string }) {
  return <span className="grid__Cell_OwnerPill">{name}</span>;
}

// Column descriptors as a FACTORY so the type-badge form-trigger can close over
// the page's onOpenForm. The caret + indentation live in the skin (the primary
// cell's TreeLines SVG); renderCell returns content only. The ID column is
// primary (index 0) — it carries the caret + rails; the type badge in it is the
// OTV2 form trigger.
export function makeScopeColumns(
  onOpenForm: (id: string) => void,
  flowStatesByType: Map<string, WorkItemFlowState[]>,
): GridColumn<ScopeNode>[] {
  return [
  {
    id: "id",
    label: "ID",
    defaultWidth: 160,
    sortable: true,
    resizable: true,
    renderCell: (r) => <IdCell row={r} onOpenForm={onOpenForm} />,
  },
  {
    id: "summary",
    label: "Summary",
    defaultWidth: null, // flex
    sortable: true,
    renderCell: (r) => <span className="grid__Cell_Summary">{r.summary}</span>,
  },
  {
    // Per-artefact colour swatch — replaces the row's left-border accent.
    // Renders only when r.colour is set; otherwise the cell stays empty.
    id: "colour",
    label: "",
    defaultWidth: 67,
    sortable: false,
    resizable: false,
    renderCell: (r) =>
      r.colour ? (
        <span
          className="grid__Tree_ColourBadge"
          style={{ background: r.colour }}
          aria-hidden="true"
        />
      ) : null,
  },
  {
    id: "status",
    label: "Status",
    defaultWidth: 220,
    sortable: true,
    resizable: true,
    renderCell: (r) => (
      <StatusCell row={r} flowStatesByType={flowStatesByType} />
    ),
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
}
