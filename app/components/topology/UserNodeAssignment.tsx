"use client";

// PLA-0044 / story 00544 — gadmin checkbox tree for user-to-node
// assignments. Renders the topology tree with a checkbox per row;
// host page owns the selected set and the toggle callback. Rows
// come from the shared walker (no fifth independent walk).
//
// Persistence note: this is a controlled component. The host calls
// POST /api/topology/nodes/{id}/roles to grant and
// DELETE /api/topology/roles/{grant_id} to revoke when onToggle fires.

import { memo, useMemo } from "react";
import { MdOutlineArrowForwardIos } from "react-icons/md";
import type { OrgNode } from "@/app/lib/topologyApi";
import {
  byPosition,
  walkTopology,
  type FlattenedRow,
} from "@/app/lib/shared/topology/walker";

// Geometry mirrors ScopeRail / TopologyTreeFlyout so the visual spine
// vocabulary stays consistent across surfaces.
const STEP = 20;
const ROW_H = 28;
const CARET_OFFSET = 8;

type AssignmentRow = FlattenedRow<OrgNode>;

export interface UserNodeAssignmentProps {
  tree: OrgNode[];
  selectedNodeIds: Set<string>;
  onToggle: (nodeId: string, nextSelected: boolean) => void;
  collapsed?: Set<string>;
  onToggleCollapsed?: (nodeId: string) => void;
  disabled?: boolean;
}

export default function UserNodeAssignment({
  tree,
  selectedNodeIds,
  onToggle,
  collapsed,
  onToggleCollapsed,
  disabled = false,
}: UserNodeAssignmentProps) {
  // PLA-0044: shared walker — orphan-drop + byPosition sort match every
  // other topology surface in the app.
  const rows = useMemo<AssignmentRow[]>(() => {
    return walkTopology(tree, {
      collapsed: collapsed ?? new Set<string>(),
      sort: byPosition,
      filter: (n) => n.archived_at === null,
    }).rows;
  }, [tree, collapsed]);

  return (
    <div className="user-node-assignment" role="tree" aria-label="Topology node assignment">
      {rows.map((row) => (
        <AssignmentRowView
          key={row.node.id}
          row={row}
          isSelected={selectedNodeIds.has(row.node.id)}
          isCollapsed={collapsed?.has(row.node.id) ?? false}
          onToggle={onToggle}
          onToggleCollapsed={onToggleCollapsed}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

const AssignmentRowView = memo(function AssignmentRowView({
  row,
  isSelected,
  isCollapsed,
  onToggle,
  onToggleCollapsed,
  disabled,
}: {
  row: AssignmentRow;
  isSelected: boolean;
  isCollapsed: boolean;
  onToggle: (nodeId: string, nextSelected: boolean) => void;
  onToggleCollapsed?: (nodeId: string) => void;
  disabled: boolean;
}) {
  const { node, depth, isLast, hasChildren, ancestorMoreChildren } = row;
  const isExpanded = hasChildren && !isCollapsed;
  return (
    <div
      className={
        "user-node-assignment__row" +
        (isSelected ? " is-selected" : "")
      }
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <Spine
        depth={depth}
        isLast={isLast}
        hasChildren={isExpanded}
        ancestorMoreChildren={ancestorMoreChildren}
      />
      <button
        type="button"
        className={
          "tree_accordion-dense__expander" +
          (isExpanded ? " tree_accordion-dense__expander--open" : "") +
          (!hasChildren ? " tree_accordion-dense__expander--leaf" : "")
        }
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren && onToggleCollapsed) onToggleCollapsed(node.id);
        }}
        tabIndex={hasChildren ? 0 : -1}
      >
        <MdOutlineArrowForwardIos
          size={10}
          className="tree_accordion-dense__expander-icon"
        />
      </button>
      <label className="user-node-assignment__cell">
        <input
          type="checkbox"
          className="user-node-assignment__checkbox"
          checked={isSelected}
          disabled={disabled}
          onChange={(e) => onToggle(node.id, e.target.checked)}
          aria-label={`Assign ${node.name}`}
        />
        <span className="user-node-assignment__name">{node.name}</span>
      </label>
    </div>
  );
});

// Spine — identical vocabulary to ScopeRail / TopologyTreeFlyout. Depth 0
// renders flush; depth ≥ 1 paints ancestor pass-throughs plus this row's
// own elbow / T, with an optional child stub. Elbow vs T is decided by
// "more siblings below" so an only-child still gets an elbow.
function Spine({
  depth,
  isLast,
  hasChildren,
  ancestorMoreChildren,
}: {
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}) {
  const H = ROW_H;
  const MID = H / 2;
  const STUB_GAP = 6;
  const stroke = "var(--surface-sunken)";

  if (depth === 0) return null;

  const W = depth * STEP;
  const lineX = (depth - 1) * STEP + CARET_OFFSET;
  const childLineX = depth * STEP + CARET_OFFSET;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  ancestorMoreChildren.forEach((cont, i) => {
    if (i === 0) return;
    if (cont && i < depth - 1) {
      const x = i * STEP + CARET_OFFSET;
      throughPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  if (isLast) {
    paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
  } else {
    paths.push(`M${lineX} 0 L${lineX} ${H}`);
    paths.push(`M${lineX} ${MID} L${W} ${MID}`);
  }
  if (hasChildren) {
    paths.push(`M${childLineX} ${MID + STUB_GAP} L${childLineX} ${H}`);
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="user-node-assignment__spine"
      aria-hidden="true"
    >
      {throughPaths.map((d, i) => (
        <path
          key={`t${i}`}
          d={d}
          stroke={stroke}
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {paths.map((d, i) => (
        <path
          key={`c${i}`}
          d={d}
          stroke={stroke}
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
