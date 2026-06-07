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

import { MdOutlineWarningAmber } from "react-icons/md";
import type { GridColumn } from "@/app/components/Grid/types";
import { FlowStatePillRow } from "@/app/components/FlowStatePillRow";
import { ColourBlockPicker } from "@/app/components/ColourBlockPicker";
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

// Prefixes that are leaf-by-design — a childless Task or Risk is normal, never
// a warning. Everything else (Epic → Story → Defect, and the whole strategic
// ladder PRW → PR → BO → TH → ST → FE) is a container type, so having no
// children is a "should-have-children but doesn't" signal worth flagging.
const LEAF_BY_DESIGN_PREFIXES = new Set(["TA", "TK", "RSK"]);

// childless = this row is a container type (not Task/Risk) with zero children.
// Drives both the red badge fill AND the red row left-border (data-childless) so
// empty containers stand out across the whole exec→strat hierarchy. The set
// above is the only exemption. Exported so every Grid page (work-items, scope,
// portfolio-items, sprint-review) feeds the SAME rule into <GridTree
// rowChildless>, keeping the badge and the row rail in lockstep.
export function isFlaggedChildless(row: ScopeNode): boolean {
  return row.childrenCount === 0 && !LEAF_BY_DESIGN_PREFIXES.has(row.type);
}

function TypeBadge({ type }: { type: string }) {
  const tier = TIER_BY_PREFIX[type] ?? "story";
  return (
    <span className="grid__Cell_TypeBadge" data-tier={tier}>
      {type}
    </span>
  );
}

// IdCell — the type badge that opens the inline edit flyout for that row
// (onOpenForm). Lives in the primary cell so it sits next to the caret +
// tree-lines. The artefact ID text used to live here too, but has been moved
// into its own dedicated lead track (Grid__Tree's rowIdText prop) so badge and
// ID are visually separated.
function IdCell({
  row,
  onOpenForm,
}: {
  row: ScopeNode;
  onOpenForm?: (id: string) => void;
}) {
  const childless = isFlaggedChildless(row);
  return (
    <button
      type="button"
      className="grid__Cell_TypeBadgeBtn"
      data-childless={childless ? "true" : undefined}
      aria-label={`Edit ${row.id}${childless ? " (no children)" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpenForm?.(row.id);
      }}
    >
      <TypeBadge type={row.type} />
    </button>
  );
}

function StatusCell({
  row,
  flowStatesByType,
  onStatusCommit,
}: {
  row: ScopeNode;
  flowStatesByType?: Map<string, WorkItemFlowState[]>;
  // When provided, the pill row is INTERACTIVE: picking a state fires
  // onStatusCommit(uuid, flowStateId). /scope omits it → read-only pills.
  // /value-sprint-review supplies it so the sprint board can drive state
  // (matching the old ObjectTreeV2 behaviour).
  onStatusCommit?: (uuid: string, flowStateId: string) => void;
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

  // Derived-state lock: a row with live children has its flow state DERIVED
  // from those children (work flows up), so manual edits are rejected
  // backend-side with ErrParentFlowStateDerived (409). The EXCEPTION is once
  // the cascade has landed the parent at a TERMINAL state (completed/accepted)
  // — then the user takes control again (e.g. to accept it). Same rule as the
  // backend's PatchWorkItem guard and the legacy work-items-tree-config. When
  // derived, FlowStatePillRow renders locked + non-interactive so a click
  // never fires a doomed PATCH. Only relevant when the pills are interactive
  // (onStatusCommit present); /scope passes readOnly and never reaches this.
  const atTerminal =
    row.flowStateCode === "completed" || row.flowStateCode === "accepted";
  const isDerived = row.childrenCount > 0 && !atTerminal;

  return (
    <FlowStatePillRow
      currentId={row.flowStateId}
      states={renderedStates}
      onCommit={(next) => {
        if (isDerived) return; // belt-and-suspenders; pills are locked anyway
        onStatusCommit?.(row.uuid, next);
      }}
      derived={!!onStatusCommit && isDerived}
      readOnly={!onStatusCommit}
    />
  );
}

// SummaryCell — the row title. On a childless container (same rule as the red
// badge + rail) it is prefixed with an "Add Child" button and a red warning
// icon. The icon carries a title tooltip ("This artefact has no children").
function SummaryCell({ row }: { row: ScopeNode }) {
  const childless = isFlaggedChildless(row);
  return (
    <span className="grid__Cell_Summary">
      {childless ? (
        <>
          {/* STUB — no handler wired yet. Click is swallowed so it does not
              trigger the row's open-detail. Wire to an add-child create flow. */}
          <button
            type="button"
            className="grid__Cell_AddChildBtn"
            onClick={(e) => e.stopPropagation()}
          >
            Add Child
          </button>
          <MdOutlineWarningAmber
            className="grid__Cell_Summary_Warn"
            title="This artefact has no children"
            aria-label="No children"
            role="img"
          />
        </>
      ) : null}
      {row.summary}
    </span>
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
  onPatchColour: (uuid: string, hex: string | null) => void,
  // Optional — when supplied, the Status pill row becomes interactive and
  // commits via this callback (/value-sprint-review). Omitted on /scope, where
  // pills stay read-only.
  onStatusCommit?: (uuid: string, flowStateId: string) => void,
  // Optional column trim — listed column ids are filtered OUT of the returned
  // set. Default [] keeps the full work-items/scope/sprint-review column set
  // unchanged; /portfolio-items passes { omit: ["points", "sprint"] } for the
  // strategy trim (ID, Summary, Status, Colour, Owner, Parent, Due).
  opts?: { omit?: string[] },
): GridColumn<ScopeNode>[] {
  const omit = opts?.omit ?? [];
  const cols: GridColumn<ScopeNode>[] = [
  {
    // Primary cell — hosts the caret + tree-lines indent + type badge. The
    // artefact ID text lives in its own lead track now (Grid__Tree rowIdText),
    // so this column only needs room for the badge; Grid__Tree grows the
    // primary column by maxDepth × TREE_STEP on top of defaultWidth.
    // Prio (dense 1..N rank) is also a lead track now — see Grid__Tree
    // rowPrio — so it sits right after the drag handle, not here.
    id: "id",
    label: "ID",
    defaultWidth: 64,
    treePrimary: true,
    sortable: true,
    resizable: true,
    renderCell: (r) => <IdCell row={r} onOpenForm={onOpenForm} />,
  },
  {
    id: "summary",
    label: "Summary",
    defaultWidth: null, // flex
    sortable: true,
    renderCell: (r) => <SummaryCell row={r} />,
  },
  {
    // Per-artefact colour. Click the block to open the shared ColourPickerPanel
    // (palette + custom hex + clear) in a portal popover; the picked hex is
    // PATCHed to the artefact via onPatchColour. Renders even when r.colour is
    // null so a colour can be assigned from an empty cell.
    id: "colour",
    label: "",
    defaultWidth: 67,
    sortable: false,
    resizable: false,
    renderCell: (r) => (
      <ColourBlockPicker
        value={r.colour}
        onChange={(hex) => onPatchColour(r.uuid, hex)}
      />
    ),
  },
  {
    id: "status",
    label: "Status",
    defaultWidth: 220,
    sortable: true,
    resizable: true,
    renderCell: (r) => (
      <StatusCell
        row={r}
        flowStatesByType={flowStatesByType}
        onStatusCommit={onStatusCommit}
      />
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
  return cols.filter((c) => !omit.includes(c.id));
}
