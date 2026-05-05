"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { TbDots, TbChevronDown, TbChevronUp, TbAlertTriangle } from "react-icons/tb";
import InlineEditField from "@/app/components/InlineEditField";
import {
  NODE_W,
  NODE_H,
  SELECTED_NODE_W,
  SELECTED_NODE_H,
  initialsFor,
  paletteColour,
  type OrgNodeData,
} from "./types";

export function OrgNodeCard({ id, data, selected }: NodeProps<Node<OrgNodeData>>) {
  const {
    org,
    childCount,
    archivedDescendantCount,
    collapsed,
    hasChildren,
    rankdir,
    onToggleCollapse,
    onOpenMenu,
    onOpenArchiveMap,
    onRename,
  } = data;
  const targetPos = rankdir === "LR" ? Position.Left : Position.Top;
  const sourcePos = rankdir === "LR" ? Position.Right : Position.Bottom;
  const archived = org.archived_at != null;
  // Teams count isn't on the OrgNode model yet. Render the segment only when
  // present so the dot separator stays correct ("2 children" vs "2 children
  // · 14 teams"). Wired to undefined for now.
  const teamCount: number | undefined = undefined;
  const sub = org.label_override || (org.parent_id === null ? "Root organisation" : "Department");
  const initials = initialsFor(org.name);
  const accent = org.colour || paletteColour(org.id);

  const handleKebab = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenMenu(id, e.clientX, e.clientY);
  };
  const handleChevron = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(id);
  };
  const handleArchiveMap = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenArchiveMap(id, org.name);
  };

  return (
    <div
      className={`org-node-card${selected ? " is-selected" : ""}${archived ? " is-archived" : ""}`}
      style={
        {
          // Runtime-computed sizing + accent must reach CSS somehow; the only
          // sanctioned escape (per docs/css-guide.md) is custom properties.
          // The .org-node-card rule below consumes --topo-node-w / -h /
          // --node-accent; no static layout values leak into JSX.
          ["--topo-node-w" as string]: `${selected ? SELECTED_NODE_W : NODE_W}px`,
          ["--topo-node-h" as string]: `${selected ? SELECTED_NODE_H : NODE_H}px`,
          ["--node-accent" as string]: accent,
        } as React.CSSProperties
      }
    >
      {/* Hidden handles so React Flow can draw orthogonal edges TB */}
      <Handle type="target" position={targetPos} className="org-node-card__handle" />
      <Handle type="source" position={sourcePos} className="org-node-card__handle" />

      <header className="org-node-card__header">
        <div className="org-node-card__avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="org-node-card__heading">
          {selected ? (
            <span
              className="org-node-card__name-wrap nodrag"
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <InlineEditField
                value={org.name}
                ariaLabel={`Rename ${org.name}`}
                clickToEdit
                stopPointerOnInput
                displayClassName="org-node-card__name"
                inputClassName="org-node-card__name-input"
                containerClassName="org-node-card__name-edit"
                maxLength={120}
                onCommit={(next) => {
                  // Fire-and-forget — InlineEditField only consumes sync
                  // return values; the parent reload reconciles errors.
                  void onRename(id, next);
                }}
              />
            </span>
          ) : (
            <h3 className="org-node-card__name" title={org.name}>
              {org.name}
            </h3>
          )}
          <p className="org-node-card__sub">{sub}</p>
        </div>
        <div className="org-node-card__actions">
          {archivedDescendantCount > 0 && (
            <button
              type="button"
              className="btn btn--icon btn--xs btn--ghost org-node-card__icon-btn org-node-card__icon-btn--warn nodrag"
              aria-label={`${archivedDescendantCount} archived descendant${archivedDescendantCount === 1 ? "" : "s"} — open archive map`}
              title={`${archivedDescendantCount} archived descendant${archivedDescendantCount === 1 ? "" : "s"}`}
              onClick={handleArchiveMap}
            >
              <TbAlertTriangle aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="btn btn--icon btn--xs btn--ghost org-node-card__icon-btn nodrag"
            aria-label="Open menu"
            onClick={handleKebab}
          >
            <TbDots aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="org-node-card__divider" aria-hidden="true" />

      <footer className="org-node-card__footer">
        <p className="org-node-card__meta">
          {childCount > 0 ? (
            <>
              <strong>{childCount}</strong>{" "}
              {childCount === 1 ? "child" : "children"}
            </>
          ) : (
            <span className="org-node-card__meta-empty">No children</span>
          )}
          {teamCount !== undefined && teamCount > 0 && (
            <>
              {" · "}
              <strong>{teamCount}</strong> {teamCount === 1 ? "team" : "teams"}
            </>
          )}
        </p>
        {hasChildren && (
          <button
            type="button"
            className="btn btn--icon btn--xs btn--ghost org-node-card__icon-btn nodrag"
            aria-label={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            onClick={handleChevron}
          >
            {collapsed ? (
              <TbChevronDown aria-hidden="true" />
            ) : (
              <TbChevronUp aria-hidden="true" />
            )}
          </button>
        )}
      </footer>
    </div>
  );
}
