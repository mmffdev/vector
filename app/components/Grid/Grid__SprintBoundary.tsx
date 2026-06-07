"use client";

// Grid__SprintBoundary — POC skin: one continuous list (sprint rows, a sweep
// handle, backlog rows). Reuses the headless useTree (passed in twice — sprint
// clamp + backlog clamp), the pure Grid__Tree_Row, the Grid__Tree_Head, and
// useColumnManager. It does NOT modify Grid__Tree — it composes its parts.
//
// Membership is committed on RELEASE via the imperative useSweepSelect hook:
// pressing the handle and sweeping DOWN over backlog rows adds them to the
// sprint; sweeping UP over sprint rows removes them. The sweep toggles a DOM
// class on each crossed row (zero React renders during the drag) and, on
// release, hands the swept UUIDs + direction to commit() mapped to the
// { toSprint, toBacklog } delta. Dragging is pure UI — no network.
//
// NOTE ON WIRING (vs the POC plan's assumptions): the real useColumnManager
// returns { gridTemplateColumns, sort, getHeaderProps, headerRowRef, … } — NOT
// { sortState, onHeaderClick, primaryColumnIndex }. primaryColumnIndex is not a
// hook output; it's derived here from the column flagged treePrimary (default 0,
// matching GridTreeRow/GridTreeHead's own default). GridTreeHead consumes
// getHeaderProps + headerRowRef directly. This file adapts to those real names;
// the shared Grid primitives are untouched.

import { useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useColumnManager } from "./useColumnManager";
import { GridTreeHead } from "./Grid__Tree_Head";
import { GridTreeRow } from "./Grid__Tree_Row";
import { GridSprintBoundaryDivider } from "./Grid__SprintBoundary_Divider";
import PrefixBlockStripes from "@/app/components/PrefixBlockStripes";
import { GridTreeActionBar, type GridTreeActionBarConfig } from "./Grid__Tree_ActionBar";
import { useSweepSelect, type SweepResult } from "./useSweepSelect";
import type { GridColumn, SortState, TreeNode, UseTreeResult } from "./types";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";

/**
 * The membership PATCH set committed on sweep-release: backlog rows that ended
 * up in the sprint (toSprint) and sprint rows that ended up in the backlog
 * (toBacklog). Lives here because the sweep skin is its sole producer/consumer
 * (formerly defined on the retired useSprintBoundary hook).
 */
export interface SprintBoundaryDelta {
  toSprint: string[];
  toBacklog: string[];
}

export interface GridSprintBoundaryProps {
  sprintTree: UseTreeResult<ScopeNode>;
  backlogTree: UseTreeResult<ScopeNode>;
  columns: GridColumn<ScopeNode>[];
  /** Called on release with the rows that crossed the line (artefact UUIDs). */
  commit: (delta: SprintBoundaryDelta) => void;
  defaultSort?: SortState | null;
  /**
   * Deprecated no-op since the boundary moved to the imperative sweep (which
   * reads real row geometry, not a fixed px→index map). Kept optional so
   * existing callers don't break; ignored by the skin.
   */
  rowHeightForTest?: number;
  /** In-skin title-band heading (rendered with the FILTER prefix). Omit → no band. */
  sprintLabel?: string;
  /** In-skin title-band subtitle line. Omit → no subtitle. */
  subtitle?: string;
  /** Action-bar config (leading slot, search, filter chips). Omit → no bar. */
  actionBar?: GridTreeActionBarConfig;
  /** Custom body for the empty-sprint hint row. Omit → default copy. */
  emptySprintHint?: ReactNode;
  /**
   * Client-side, case-insensitive title filter over the LOADED rows of both
   * trees. The filter narrows the rows the sweep sees (and the render shows);
   * the sweep only ever crosses rows that survive the filter. Off-page /
   * non-title matches are NOT found — the backend
   * WorkItemQueryBody has no server-side search term (see TD-SPRINT-BOUNDARY-
   * SEARCH). Omit/empty → all rows shown.
   */
  searchTerm?: string;
}

export function GridSprintBoundary({
  sprintTree,
  backlogTree,
  columns,
  commit,
  defaultSort = null,
  sprintLabel,
  subtitle,
  actionBar,
  emptySprintHint,
  searchTerm,
}: GridSprintBoundaryProps) {
  // Client-side title filter (see searchTerm doc). Narrows the sprint/backlog
  // node arrays BEFORE they're rendered as sweep rows, so the sweep snapshot,
  // the live counter, and the commit delta all use the same filtered set. No
  // search term → every node matches → identical to the unfiltered behaviour.
  const term = (searchTerm ?? "").trim().toLowerCase();
  const matches = useCallback(
    (n: TreeNode<ScopeNode>) => {
      if (!term) return true;
      const text = (n.row.summary ?? "").toLowerCase();
      return text.includes(term);
    },
    [term],
  );
  const sprintNodes = useMemo(
    () => sprintTree.flatNodes.filter(matches),
    [sprintTree.flatNodes, matches],
  );
  // Dedupe the backlog against the sprint by uuid. The two trees clamp to
  // disjoint sprint_id sets (=<id> vs __none__) so they're normally mutually
  // exclusive — but during the commit→refetch window a just-moved row can sit
  // in BOTH for a frame (sprint tree already refetched, backlog tree still
  // stale). Without this, the same row lands in `combined` twice → duplicate
  // React keys → crash. Sprint side wins (the row was moved INTO the sprint),
  // and dropping it from the backlog keeps every downstream derivation
  // (ids, boundary counts, combined render) consistent.
  const backlogNodes = useMemo(() => {
    const inSprint = new Set(sprintNodes.map((n) => n.row.uuid));
    return backlogTree.flatNodes.filter(
      (n) => matches(n) && !inSprint.has(n.row.uuid),
    );
  }, [backlogTree.flatNodes, matches, sprintNodes]);

  // Real hook surface: gridTemplateColumns + sort + getHeaderProps + headerRowRef.
  // primaryColumnIndex is NOT a hook output — derive it from the treePrimary flag
  // (default 0, matching GridTreeRow/GridTreeHead's own fallback).
  const { gridTemplateColumns, getHeaderProps, headerRowRef } =
    useColumnManager<ScopeNode>({ columns, defaultSort });

  const primaryColumnIndex = useMemo(() => {
    const idx = columns.findIndex((c) => c.treePrimary);
    return idx >= 0 ? idx : 0;
  }, [columns]);

  // Imperative sweep: the container holds the [data-sweep-row] rows; the handle
  // (divider) spreads handlePointerProps + carries the live counter span. On
  // release the swept UUIDs are mapped to the unchanged { toSprint, toBacklog }
  // delta — sweep "add" → toSprint, "remove" → toBacklog.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const counterRef = useRef<HTMLSpanElement | null>(null);

  const onSweepCommit = useCallback(
    (r: SweepResult) => {
      commit(
        r.direction === "add"
          ? { toSprint: r.uuids, toBacklog: [] }
          : { toSprint: [], toBacklog: r.uuids },
      );
    },
    [commit],
  );

  const { dragging, handlePointerProps } = useSweepSelect({
    containerRef,
    counterRef,
    onCommit: onSweepCommit,
  });

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
      <div className="grid__SprintBoundary_Body" ref={containerRef}>
        {sprintNodes.length === 0 && !dragging && (
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
        {sprintNodes.map((n) => (
          // Key + sweep-snapshot keyed by the stable artefact uuid (not the
          // display id, which can repeat across artefacts). data-sweep-* drive
          // the imperative sweep snapshot in useSweepSelect.
          <div
            key={n.row.uuid}
            data-sweep-row
            data-sweep-uuid={n.row.uuid}
            data-sweep-section="sprint"
          >
            <GridTreeRow
              node={n}
              columns={columns}
              gridTemplateColumns={gridTemplateColumns}
              primaryColumnIndex={primaryColumnIndex}
            />
          </div>
        ))}
        {/* The handle is the sweep origin — it sits BETWEEN sprint and backlog
            rows. Sweep down over backlog → add; up over sprint → remove. */}
        <GridSprintBoundaryDivider
          dragging={dragging}
          pointerProps={handlePointerProps}
          counterRef={counterRef}
        />
        {backlogNodes.map((n) => (
          <div
            key={n.row.uuid}
            data-sweep-row
            data-sweep-uuid={n.row.uuid}
            data-sweep-section="backlog"
          >
            <GridTreeRow
              node={n}
              columns={columns}
              gridTemplateColumns={gridTemplateColumns}
              primaryColumnIndex={primaryColumnIndex}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
