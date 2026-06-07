"use client";

// Grid__SprintBoundary — POC skin: one continuous list (sprint rows, a
// draggable divider, backlog rows) with a movable sprint-commitment line.
// Reuses the headless useTree (passed in twice — sprint clamp + backlog clamp),
// the pure Grid__Tree_Row, the Grid__Tree_Head, and useColumnManager. It does
// NOT modify Grid__Tree — it composes its parts.
//
// Membership is committed on RELEASE: the divider's row index is diffed against
// the initial split and the crossed rows are handed to commit() as a delta of
// artefact UUIDs (toSprint / toBacklog). Dragging is pure UI — no network.
//
// NOTE ON WIRING (vs the POC plan's assumptions): the real useColumnManager
// returns { gridTemplateColumns, sort, getHeaderProps, headerRowRef, … } — NOT
// { sortState, onHeaderClick, primaryColumnIndex }. primaryColumnIndex is not a
// hook output; it's derived here from the column flagged treePrimary (default 0,
// matching GridTreeRow/GridTreeHead's own default). GridTreeHead consumes
// getHeaderProps + headerRowRef directly. This file adapts to those real names;
// the shared Grid primitives are untouched.

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useColumnManager } from "./useColumnManager";
import { GridTreeHead } from "./Grid__Tree_Head";
import { GridTreeRow } from "./Grid__Tree_Row";
import { GridSprintBoundaryDivider } from "./Grid__SprintBoundary_Divider";
import PrefixBlockStripes from "@/app/components/PrefixBlockStripes";
import { GridTreeActionBar, type GridTreeActionBarConfig } from "./Grid__Tree_ActionBar";
import {
  useSprintBoundary,
  type SprintBoundaryDelta,
} from "./useSprintBoundary";
import type { GridColumn, SortState, UseTreeResult } from "./types";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";

export interface GridSprintBoundaryProps {
  sprintTree: UseTreeResult<ScopeNode>;
  backlogTree: UseTreeResult<ScopeNode>;
  columns: GridColumn<ScopeNode>[];
  /** Called on release with the rows that crossed the line (artefact UUIDs). */
  commit: (delta: SprintBoundaryDelta) => void;
  defaultSort?: SortState | null;
  /** Test-only: fixed row height so the px→index map is deterministic. */
  rowHeightForTest?: number;
  /** In-skin title-band heading (rendered with the FILTER prefix). Omit → no band. */
  sprintLabel?: string;
  /** In-skin title-band subtitle line. Omit → no subtitle. */
  subtitle?: string;
  /** Action-bar config (leading slot, search, filter chips). Omit → no bar. */
  actionBar?: GridTreeActionBarConfig;
  /** Custom body for the empty-sprint hint row. Omit → default copy. */
  emptySprintHint?: ReactNode;
}

export function GridSprintBoundary({
  sprintTree,
  backlogTree,
  columns,
  commit,
  defaultSort = null,
  rowHeightForTest,
  sprintLabel,
  subtitle,
  actionBar,
  emptySprintHint,
}: GridSprintBoundaryProps) {
  const sprintNodes = sprintTree.flatNodes;
  const backlogNodes = backlogTree.flatNodes;

  const sprintIds = useMemo(
    () => sprintNodes.map((n) => n.row.uuid),
    [sprintNodes],
  );
  const backlogIds = useMemo(
    () => backlogNodes.map((n) => n.row.uuid),
    [backlogNodes],
  );

  const boundary = useSprintBoundary(sprintIds, backlogIds);

  // Real hook surface: gridTemplateColumns + sort + getHeaderProps + headerRowRef.
  // primaryColumnIndex is NOT a hook output — derive it from the treePrimary flag
  // (default 0, matching GridTreeRow/GridTreeHead's own fallback).
  const { gridTemplateColumns, getHeaderProps, headerRowRef } =
    useColumnManager<ScopeNode>({ columns, defaultSort });

  const primaryColumnIndex = useMemo(() => {
    const idx = columns.findIndex((c) => c.treePrimary);
    return idx >= 0 ? idx : 0;
  }, [columns]);

  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartIndex = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const rowHeight = useCallback((): number => {
    if (rowHeightForTest) return rowHeightForTest;
    const firstRow = bodyRef.current?.querySelector<HTMLElement>(
      "[data-sprintboundary-row]",
    );
    return firstRow?.getBoundingClientRect().height || 40;
  }, [rowHeightForTest]);

  const onDragStart = useCallback(
    (clientY: number) => {
      setDragging(true);
      dragStartY.current = clientY;
      dragStartIndex.current = boundary.boundaryIndex;
    },
    [boundary.boundaryIndex],
  );

  const onDragMove = useCallback(
    (clientY: number) => {
      const dy = clientY - dragStartY.current;
      const rowsMoved = Math.round(dy / rowHeight());
      boundary.setBoundaryIndex(dragStartIndex.current + rowsMoved);
    },
    [boundary.setBoundaryIndex, rowHeight],
  );

  const onDragEnd = useCallback(() => {
    setDragging(false);
    const delta = boundary.computeDelta();
    if (delta.toSprint.length || delta.toBacklog.length) commit(delta);
  }, [boundary.computeDelta, commit]);

  const combined = useMemo(
    () => [...sprintNodes, ...backlogNodes],
    [sprintNodes, backlogNodes],
  );

  return (
    <div className="grid grid__SprintBoundary">
      {(sprintLabel != null || subtitle != null) && (
        <div className="grid__Tree_Title grid__SprintBoundary_Title">
          <PrefixBlockStripes />
          <div className="grid__Tree_Title_Body">
            {sprintLabel != null && (
              <h3 className="grid__Tree_Title_Heading">
                <span className="grid__Tree_Title_Heading_Filter">FILTER</span>{" "}
                {sprintLabel}
              </h3>
            )}
            {subtitle != null && (
              <p className="grid__Tree_Title_Sub">{subtitle}</p>
            )}
          </div>
        </div>
      )}
      {actionBar && <GridTreeActionBar {...actionBar} />}
      <GridTreeHead
        columns={columns}
        gridTemplateColumns={gridTemplateColumns}
        getHeaderProps={getHeaderProps}
        headerRowRef={headerRowRef}
        primaryColumnIndex={primaryColumnIndex}
      />
      <div className="grid__SprintBoundary_Body" ref={bodyRef}>
        {sprintNodes.length === 0 && (
          <div className="grid__SprintBoundary_Empty" data-sprintboundary-empty>
            {emptySprintHint ?? (
              <>
                <strong>This sprint is empty.</strong> Drag the handle below
                downward through the backlog to commit work items
                {sprintLabel ? <> into <strong>{sprintLabel}</strong></> : null}.
                Release to save.
              </>
            )}
          </div>
        )}
        {/*
          Rows and the divider are emitted as flat siblings — the divider is a
          SINGLE element with a CONSTANT key ("__divider__") so React preserves
          its instance (and its pointer-capture / activeRef state) as it moves
          between row positions during a drag. Wrapping it in a per-row-keyed
          parent (the obvious approach) re-mounts a fresh divider every time the
          boundary crosses a row, dropping the capture and the in-flight drag —
          which is exactly the bug this layout avoids.
        */}
        {(() => {
          const children: ReactNode[] = [];
          const divider = (
            <GridSprintBoundaryDivider
              key="__divider__"
              inSprintCount={boundary.inSprintCount}
              total={boundary.total}
              dragging={dragging}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          );
          if (boundary.boundaryIndex === 0) children.push(divider);
          combined.forEach((n, i) => {
            const inSprint = i < boundary.boundaryIndex;
            children.push(
              <div
                key={n.id}
                data-sprintboundary-row
                className={
                  inSprint ? "grid__SprintBoundary_Row-inSprint" : undefined
                }
              >
                <GridTreeRow
                  node={n}
                  columns={columns}
                  gridTemplateColumns={gridTemplateColumns}
                  primaryColumnIndex={primaryColumnIndex}
                />
              </div>,
            );
            if (i + 1 === boundary.boundaryIndex) children.push(divider);
          });
          return children;
        })()}
      </div>
    </div>
  );
}
