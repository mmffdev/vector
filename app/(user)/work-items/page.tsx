"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import PageShell from "@/app/components/PageShell";
import Panel from "@/app/components/Panel";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { api, ApiError } from "@/app/lib/api";
import WorkItemDetailPanel from "./WorkItemDetailPanel";
import Example2Tree from "./Example2Tree";
import DragHandleColumn from "@/app/components/DragHandleColumn";
import { useResourceRank, type MoveResult } from "@/app/hooks/useResourceRank";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useAuth } from "@/app/contexts/AuthContext";
import { MdOutlineCreateNewFolder, MdOutlineFolder, MdChecklist, MdOutlineBugReport, MdOutlineArrowForwardIos } from "react-icons/md";
import InlineEditField from "@/app/components/InlineEditField";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { InlineSelect } from "./InlineSelect";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkItem {
  id: string;
  key_num: number;
  item_type: string;
  title: string;
  status: string;
  priority: string | null;
  story_points: number | null;
  rollup_points: number | null;
  sprint_id: string | null;
  parent_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  children_count: number;
}

// effectivePoints picks the value the UI shows. The backend sets
// rollup_points whenever an item has at least one non-archived child;
// when set, it shadows the manual story_points (which is preserved in
// the DB so the original number returns if all children are archived).
function effectivePoints(item: WorkItem): number | null {
  return item.rollup_points ?? item.story_points;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const PRIORITY_PILL: Record<string, string> = {
  critical: "pill--danger",
  high: "pill--warning",
  medium: "pill--info",
  low: "pill--neutral",
};

const STATUS_PILL: Record<string, string> = {
  open: "pill--neutral",
  in_progress: "pill--info",
  done: "pill--success",
  cancelled: "pill--neutral",
};

const TYPE_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  epic:   MdOutlineCreateNewFolder,
  story:  MdOutlineFolder,
  task:   MdChecklist,
  defect: MdOutlineBugReport,
};

const TYPE_PREFIX: Record<string, string> = {
  epic: "EP",
  story: "US",
  defect: "DE",
  task: "TA",
};

const STATUS_OPTIONS_TREE = ["open", "in_progress", "done", "cancelled"];
const PRIORITY_OPTIONS_TREE = ["critical", "high", "medium", "low"];

// Tasks (and any other bottom-layer item type) cannot have manual points;
// every other type can. Mirrors the backend gate; duplicated in the panel.
function canHaveManualPointsRow(itemType: string): boolean {
  return itemType !== "task";
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface FilterState {
  search: string;
  status: string;
  priority: string;
  sprint_id: string;
  item_type: string;
}

function WorkItemsFilterBar({
  filters,
  sprints,
  onChange,
  onNew,
}: {
  filters: FilterState;
  sprints: Sprint[];
  onChange: (patch: Partial<FilterState>) => void;
  onNew: () => void;
}) {
  return (
    <div className="backlog-filter" role="search">
      <ul className="backlog-filter__pills" aria-label="Status filters">
        {STATUS_FILTERS.map((f) => (
          <li key={f.key}>
            <button
              type="button"
              className={"pill " + (filters.status === f.key ? "pill--info" : "pill--neutral")}
              aria-pressed={filters.status === f.key}
              onClick={() => onChange({ status: f.key })}
            >
              {f.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="backlog-filter__controls">
        {sprints.length > 0 && (
          <select
            className="btn btn--ghost"
            value={filters.sprint_id}
            onChange={(e) => onChange({ sprint_id: e.target.value })}
            aria-label="Filter by sprint"
          >
            <option value="">All sprints</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="btn btn--ghost"
          value={filters.item_type}
          onChange={(e) => onChange({ item_type: e.target.value })}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="epic">Epics</option>
          <option value="story">Stories</option>
          <option value="task">Tasks</option>
          <option value="defect">Defects</option>
        </select>
        <button type="button" className="btn btn--primary" onClick={onNew}>
          New item
        </button>
      </div>
    </div>
  );
}

// ─── Inline Select ────────────────────────────────────────────────────────────

// ─── Tree Row ─────────────────────────────────────────────────────────────────

// continuations[i] = true means ancestor at level i+1 still has siblings below
// this row, so we need a full-height vertical pass-through line at that indent level.
function WorkItemRow({
  item,
  depth,
  expanded,
  hasChildren,
  onToggle,
  onSelect,
  onPatch,
  selected,
  animIndex,
  isFirst,
  isLast,
  continuations,
  hasVisibleChildren,
  rowProps,
  handleProps,
}: {
  item: WorkItem;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  selected: boolean;
  animIndex?: number;
  isFirst?: boolean;
  isLast?: boolean;
  continuations?: boolean[];
  hasVisibleChildren?: boolean;
  rowProps: React.HTMLAttributes<HTMLTableRowElement> & { "data-rank-row-id"?: string };
  handleProps: React.HTMLAttributes<HTMLTableCellElement> & { draggable?: boolean };
}) {
  const TypeIcon = TYPE_ICON[item.item_type] ?? null;
  const { className: rankClass = "", ...restRowProps } = rowProps;
  return (
    <tr
      {...restRowProps}
      className={
        "table__row work-items-tree__row" +
        (selected ? " table__row--selected" : "") +
        (animIndex !== undefined ? " work-items-tree__row--child" : "") +
        (rankClass ? " " + rankClass : "")
      }
      style={animIndex !== undefined ? { animationDelay: `${animIndex * 30}ms` } : undefined}
      onClick={onSelect}
    >
      <DragHandleColumn {...handleProps} onClick={(e) => e.stopPropagation()} />
      {/* Toggle cell — no depth indent, always centred */}
      <td className="table__cell work-items-tree__toggle-cell">
        <span className="work-items-tree__toggle-inner">
          {hasChildren ? (
            <button
              type="button"
              className="btn btn--icon btn--row-expander"
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
              <MdOutlineArrowForwardIos
                size={12}
                className={"work-items-tree__expander-icon" + (expanded ? " work-items-tree__expander-icon--open" : "")}
              />
            </button>
          ) : (
            <span className="btn btn--icon btn--row-expander" aria-hidden="true" />
          )}
        </span>
      </td>
      {/* Tag cell — SVG tree lines + icon + key */}
      <td className="table__cell work-items-tree__tag-cell">
        <div className="work-items-tree__tag-inner">
          {depth === 0 && (() => {
            // Top-level spine. Real-width SVG (1px) sits in flex flow so the
            // icon doesn't shift, but overflow:visible lets paths paint outside
            // its box. X=12 matches children's lineX (STEP/2) so the spine flows
            // straight into the depth-1 verticals below.
            const H = 48;
            const MID = H / 2;
            const X = 12;
            const STUB_GAP = 10;
            const paths: string[] = [];
            if (!isFirst) paths.push(`M${X} 0 L${X} ${MID - STUB_GAP}`);
            if (!isLast || hasVisibleChildren) paths.push(`M${X} ${MID + STUB_GAP} L${X} ${H}`);
            if (paths.length === 0) return null;
            return (
              <svg
                width={1}
                height={H}
                viewBox={`0 0 1 ${H}`}
                className="work-items-tree__svg work-items-tree__svg--root-spine"
                aria-hidden="true"
              >
                {paths.map((d, i) => (
                  <path key={`r${i}`} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                ))}
              </svg>
            );
          })()}
          {depth > 0 && (() => {
            // STEP: width per depth level. SVG is exactly depth*STEP wide.
            // Vertical line for own depth sits at x = (depth-1)*STEP + STEP/2.
            // Horizontal arm runs from that x to SVG right edge (depth*STEP).
            // Tag icon sits immediately after SVG with no padding, so arm ends at icon left edge.
            const STEP = 24;
            const H = 48;
            const MID = H / 2;
            const W = depth * STEP;
            const lineX = (depth - 1) * STEP + STEP / 2;
            // Stub exits bottom of icon at child's connector x (one slot right of own lineX).
            // Drawn with overflow:visible so it doesn't widen the SVG or push the icon over.
            const childLineX = depth * STEP + STEP / 2;

            const throughPaths: string[] = [];
            const paths: string[] = [];

            // Pass-through verticals: ancestor levels (excluding immediate parent)
            // continuing past this subtree. The last entry in `continuations` represents
            // the immediate parent, whose vertical is already drawn by its own row's
            // connector — so we slice it off to avoid overlapping our own lineX.
            const ancestors = (continuations ?? []).slice(0, -1);
            ancestors.forEach((cont, i) => {
              if (cont) {
                const x = i * STEP + STEP / 2;
                throughPaths.push(`M${x} 0 L${x} ${H}`);
              }
            });

            // Own connector. A last-sibling that has visible children renders as ├
            // (not └) so the parent's vertical continues through this row down into the
            // children below — visually anchoring the subtree to its grandparent.
            const renderAsLast = isLast && !hasVisibleChildren;
            if (renderAsLast) {
              paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
            } else {
              paths.push(`M${lineX} 0 L${lineX} ${H}`);
              paths.push(`M${lineX} ${MID} L${W} ${MID}`);
              if (hasVisibleChildren) {
                paths.push(`M${childLineX} ${MID + 10} L${childLineX} ${H}`);
              }
            }

            return (
              <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                className="work-items-tree__svg"
                aria-hidden="true"
              >
                {throughPaths.map((d, i) => (
                  <path key={`t${i}`} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                ))}
                {paths.map((d, i) => (
                  <path key={`c${i}`} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                ))}
              </svg>
            );
          })()}
          <span className="work-items-tree__tag">
            {TypeIcon && <TypeIcon size={14} className="work-items-tree__type-icon" />}
            {TYPE_PREFIX[item.item_type] ?? item.item_type}-{item.key_num}
          </span>
        </div>
      </td>
      <td className="table__cell" onClick={(e) => e.stopPropagation()}>
        <InlineEditField
          value={item.title}
          onCommit={(next) => onPatch(item.id, { title: next })}
          ariaLabel="Work item title"
          inputClassName="form__input form__input--sm"
          displayClassName="inline-edit-trigger"
          clickToEdit
          stopPointerOnInput
          maxLength={200}
        />
      </td>
      <td className="table__cell">
        <InlineSelect
          value={item.status}
          options={STATUS_OPTIONS_TREE.map((s) => ({ value: s, label: s.replace("_", " ") }))}
          onCommit={(next) => onPatch(item.id, { status: next })}
          ariaLabel="Work item status"
          trigger={
            <span className={"pill pill--sm " + (STATUS_PILL[item.status] ?? "pill--neutral")}>
              {item.status.replace("_", " ")}
            </span>
          }
        />
      </td>
      <td className="table__cell">
        <InlineSelect
          value={item.priority ?? ""}
          options={PRIORITY_OPTIONS_TREE.map((p) => ({ value: p, label: p }))}
          onCommit={(next) => onPatch(item.id, { priority: next === "" ? null : next })}
          ariaLabel="Work item priority"
          placeholder="None"
          trigger={
            item.priority ? (
              <span className={"pill pill--sm " + (PRIORITY_PILL[item.priority] ?? "pill--neutral")}>
                {item.priority}
              </span>
            ) : (
              <span className="inline-edit-trigger--empty">—</span>
            )
          }
        />
      </td>
      <td className="table__cell table__cell--numeric" onClick={(e) => e.stopPropagation()}>
        {!canHaveManualPointsRow(item.item_type) ? (
          <span className="inline-edit-trigger--empty">—</span>
        ) : item.rollup_points != null ? (
          // Rollup wins — read-only on the row. Edit the manual value via the
          // detail panel; tooltip explains that the manual value is shadowed.
          <span
            className="work-items-tree__rollup"
            title={`Rolled up from children. Manual: ${item.story_points ?? "—"}`}
          >
            {item.rollup_points}
          </span>
        ) : (
          <InlineEditField
            value={item.story_points != null ? String(item.story_points) : ""}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed === "") return onPatch(item.id, { story_points: null });
              const parsed = parseInt(trimmed, 10);
              if (Number.isNaN(parsed) || parsed < 0) return false;
              return onPatch(item.id, { story_points: parsed });
            }}
            ariaLabel="Story points"
            inputClassName="form__input form__input--sm form__input--numeric"
            displayClassName="inline-edit-trigger"
            clickToEdit
            stopPointerOnInput
            allowEmpty
            emptyDisplay="—"
            maxLength={6}
          />
        )}
      </td>
    </tr>
  );
}

// ─── Sort types ───────────────────────────────────────────────────────────────

type SortKey = "tag" | "title" | "status" | "priority" | "pts";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, done: 2, cancelled: 3 };

function sortItems(items: WorkItem[], key: SortKey, dir: SortDir): WorkItem[] {
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "tag":
        cmp = a.key_num - b.key_num;
        break;
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
      case "status":
        cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        break;
      case "priority":
        cmp = (PRIORITY_ORDER[a.priority ?? ""] ?? 99) - (PRIORITY_ORDER[b.priority ?? ""] ?? 99);
        break;
      case "pts":
        cmp = (effectivePoints(a) ?? -1) - (effectivePoints(b) ?? -1);
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

// ─── Sort header cell ─────────────────────────────────────────────────────────

function SortTh({
  label,
  sortKey,
  current,
  dir,
  onSort,
  numeric,
  onResizeStart,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey | null;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  numeric?: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className={"table__cell work-items-tree__th" + (numeric ? " table__cell--numeric" : "")}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={"work-items-tree__sort-btn" + (active ? " work-items-tree__sort-btn--active" : "")}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <span className="work-items-tree__sort-icon" aria-hidden="true">
          {active ? (dir === "asc" ? "↑" : "↓") : "⇅"}
        </span>
      </button>
      <span
        className="work-items-tree__resize-handle"
        onMouseDown={onResizeStart}
        aria-hidden="true"
      />
    </th>
  );
}

// ─── Tree Grid ────────────────────────────────────────────────────────────────

const DEFAULT_COL_WIDTHS = { drag: 32, toggle: 40, tag: 120, title: 0, status: 120, priority: 100, pts: 60 };

// Imperative handle exposed by WorkItemsTree so the parent page can apply
// a server-confirmed work-item update (from the detail panel) to whichever
// list the row lives in (roots or a child array) AND recompute rollup
// points up the visible ancestor chain. Mirrors the backend's recursive-CTE
// rollup so the table reflects edits before the next refetch.
type WorkItemsTreeHandle = {
  applyItemUpdate: (updated: WorkItem) => void;
  patch: (id: string, body: Record<string, unknown>) => void;
};

function WorkItemsTree({
  items,
  setItems,
  selectedId,
  onSelect,
  onItemSync,
  treeRef,
}: {
  items: WorkItem[];
  setItems: (next: WorkItem[]) => void;
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onItemSync?: (item: WorkItem) => void;
  treeRef?: React.MutableRefObject<WorkItemsTreeHandle | null>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [childMap, setChildMap] = useState<Record<string, WorkItem[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: SortDir }>({ key: null, dir: "asc" });
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  const resizeRef = useRef<{ col: keyof typeof DEFAULT_COL_WIDTHS; startX: number; startW: number } | null>(null);

  // Generic ranking + tree-aware optimistic reorder. The hook owns drag state
  // and the /api/rank/move POST; here we apply the local mutation against
  // either the roots list (`items`) or the parent's child array
  // (`childMap[parentId]`) depending on where the moved row lives. Backend
  // orders children among their siblings only, so a child drag must reorder
  // the parent's own child array — not the flat roots list.
  const reorderSnapshot = useRef<
    | { kind: "roots"; prev: WorkItem[] }
    | { kind: "child"; parentId: string; prev: WorkItem[] }
    | null
  >(null);
  const applyDrop = useCallback(
    (moverID: string, pos: "above" | "below", targetID: string) => {
      if (moverID === targetID) return;
      const reorderList = (list: WorkItem[]): WorkItem[] | null => {
        const fromIdx = list.findIndex((r) => r.id === moverID);
        const toIdx = list.findIndex((r) => r.id === targetID);
        if (fromIdx < 0 || toIdx < 0) return null;
        const next = list.slice();
        const [moved] = next.splice(fromIdx, 1);
        const adjustedTargetIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
        const insertAt = pos === "above" ? adjustedTargetIdx : adjustedTargetIdx + 1;
        next.splice(insertAt, 0, moved);
        return next;
      };
      // Roots first.
      const rootsNext = reorderList(items);
      if (rootsNext) {
        reorderSnapshot.current = { kind: "roots", prev: items };
        setItems(rootsNext);
        return;
      }
      // Otherwise find the parent whose child array contains both rows.
      for (const [parentId, kids] of Object.entries(childMap)) {
        const next = reorderList(kids);
        if (next) {
          reorderSnapshot.current = { kind: "child", parentId, prev: kids };
          setChildMap((prev) => ({ ...prev, [parentId]: next }));
          return;
        }
      }
    },
    [items, childMap]
  );
  const reconcile = useCallback((_r: MoveResult) => {
    reorderSnapshot.current = null;
  }, []);
  const rollback = useCallback((_e: ApiError) => {
    const snap = reorderSnapshot.current;
    if (!snap) return;
    if (snap.kind === "roots") setItems(snap.prev);
    else setChildMap((prev) => ({ ...prev, [snap.parentId]: snap.prev }));
    reorderSnapshot.current = null;
  }, []);
  const getDescendants = useCallback(
    (id: string): string[] => {
      const out: string[] = [];
      const walk = (parentId: string) => {
        const kids = childMap[parentId] ?? [];
        for (const k of kids) {
          out.push(k.id);
          walk(k.id);
        }
      };
      walk(id);
      return out;
    },
    [childMap]
  );
  const rank = useResourceRank({
    resourceType: "work_item",
    onMoved: reconcile,
    onError: rollback,
    getDescendants,
  });

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  }, []);

  const startResize = useCallback((col: keyof typeof DEFAULT_COL_WIDTHS, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[col];
    resizeRef.current = { col, startX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(40, resizeRef.current.startW + delta);
      setColWidths((prev) => ({ ...prev, [resizeRef.current!.col]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  const expandAll = useCallback(async () => {
    // Iteratively fetch every level until no unfetched expandable items remain.
    let currentMap = { ...childMap };
    const allExpandable = new Set<string>();

    const collectUnfetched = (rows: WorkItem[]): WorkItem[] => {
      const unfetched: WorkItem[] = [];
      for (const item of rows) {
        if (item.children_count > 0 || (currentMap[item.id] ?? []).length > 0) {
          allExpandable.add(item.id);
          if (!currentMap[item.id]) {
            unfetched.push(item);
          } else {
            // Already fetched — recurse into children to find deeper unfetched levels.
            const deeper = collectUnfetched(currentMap[item.id]);
            unfetched.push(...deeper);
          }
        }
      }
      return unfetched;
    };

    let toFetch = collectUnfetched(items);

    while (toFetch.length > 0) {
      const results = await Promise.all(
        toFetch.map((item) =>
          api<{ items: WorkItem[] }>(`/api/work-items/${item.id}/children`).then((res) => ({
            id: item.id,
            children: res.items,
          }))
        )
      );
      for (const { id, children } of results) {
        currentMap[id] = children;
        for (const child of children) {
          if (child.children_count > 0) allExpandable.add(child.id);
        }
      }
      // Find next level of unfetched items from the newly loaded children.
      toFetch = results.flatMap(({ children }) =>
        children.filter((c) => c.children_count > 0 && !currentMap[c.id])
      );
    }

    setChildMap(currentMap);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of allExpandable) next.add(id);
      return next;
    });
  }, [items, childMap]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    setAllExpanded(false);
  }, []);

  // When the roots list changes (filter switch or realtime-push refetch),
  // also refresh the children of every currently-expanded parent so child
  // reorders from other tabs/users become visible without requiring the
  // user to collapse + re-expand. Skips on initial mount when nothing is
  // expanded yet.
  const itemsRef = useRef(items);
  useEffect(() => {
    if (itemsRef.current === items) return;
    itemsRef.current = items;
    if (expanded.size === 0) return;
    const ids = Array.from(expanded);
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        api<{ items: WorkItem[] }>(`/api/work-items/${id}/children`)
          .then((res) => ({ id, items: res.items }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setChildMap((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r.id] = r.items;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [items, expanded]);

  const toggle = useCallback(async (item: WorkItem) => {
    const id = item.id;
    if (expanded.has(id)) {
      setExpanded((prev) => { const s = new Set(prev); s.delete(id); return s; });
      return;
    }
    if (!childMap[id]) {
      setLoadingId(id);
      try {
        const res = await api<{ items: WorkItem[] }>(`/api/work-items/${id}/children`);
        setChildMap((prev) => ({ ...prev, [id]: res.items }));
      } finally {
        setLoadingId(null);
      }
    }
    setExpanded((prev) => new Set(prev).add(id));
  }, [expanded, childMap]);

  // Apply a server-confirmed update to the local tree and recompute
  // ancestor rollups so the table reflects a points edit immediately.
  // The backend rollup is SUM(story_points) over non-archived descendants;
  // we mirror that here using the rows we already have loaded. Ancestors
  // that aren't yet expanded simply aren't in childMap — their rollup will
  // refresh on next fetch, which is fine since they're not visible.
  const applyItemUpdate = useCallback((updated: WorkItem) => {
    // Build a unified map of every loaded row keyed by id, plus a parent
    // index so we can walk from the edited row up to its visible roots.
    const allRows = new Map<string, WorkItem>();
    for (const r of items) allRows.set(r.id, r);
    for (const kids of Object.values(childMap)) {
      for (const r of kids) allRows.set(r.id, r);
    }
    // Replace the edited row with the server's version.
    allRows.set(updated.id, updated);

    // Recompute rollup_points for ancestor chain. Walk parent_id links;
    // at each ancestor sum story_points of every descendant we know about.
    // If the ancestor has no children loaded yet, leave its rollup alone.
    const childrenByParent = new Map<string, WorkItem[]>();
    for (const r of allRows.values()) {
      if (r.parent_id) {
        const arr = childrenByParent.get(r.parent_id) ?? [];
        arr.push(r);
        childrenByParent.set(r.parent_id, arr);
      }
    }
    const sumDescendants = (parentId: string): number | null => {
      const kids = childrenByParent.get(parentId);
      if (!kids || kids.length === 0) return null;
      let total = 0;
      for (const k of kids) {
        const sub = sumDescendants(k.id);
        total += sub ?? k.story_points ?? 0;
      }
      return total;
    };
    let cursorId: string | null = updated.parent_id ?? null;
    while (cursorId) {
      const ancestor = allRows.get(cursorId);
      if (!ancestor) break;
      const newRollup = sumDescendants(cursorId);
      if (newRollup !== ancestor.rollup_points) {
        allRows.set(cursorId, { ...ancestor, rollup_points: newRollup });
      }
      cursorId = ancestor.parent_id ?? null;
    }

    // Push back into the two stores. Roots get the freshened versions
    // from allRows; childMap arrays get rebuilt the same way so any
    // ancestor whose rollup changed reflects it.
    setItems(items.map((r) => allRows.get(r.id) ?? r));
    setChildMap((prev) => {
      const next: Record<string, WorkItem[]> = {};
      for (const [pid, kids] of Object.entries(prev)) {
        next[pid] = kids.map((r) => allRows.get(r.id) ?? r);
      }
      return next;
    });

    // Forward the (possibly rollup-updated) edited row back so the panel
    // and `selectedItem` stay in sync with what the table now shows.
    onItemSync?.(allRows.get(updated.id) ?? updated);
  }, [items, childMap, setItems, onItemSync]);

  // PATCH a single field (or set of fields) on a row, then push the
  // server-confirmed result through the local-tree update pipeline so the
  // edited cell + ancestor rollups refresh in the same render. Used by
  // every inline cell editor in the row.
  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      api<WorkItem>(`/api/work-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
        .then((updated) => applyItemUpdate(updated))
        .catch(() => { /* swallow — UI stays on stale value, refetch on push */ });
    },
    [applyItemUpdate]
  );

  // Expose apply-update + patch to the parent page via the ref it passed in.
  useEffect(() => {
    if (!treeRef) return;
    treeRef.current = { applyItemUpdate, patch: patchAndApply };
    return () => {
      if (treeRef.current?.applyItemUpdate === applyItemUpdate) {
        treeRef.current = null;
      }
    };
  }, [treeRef, applyItemUpdate, patchAndApply]);

  // Compose row props: hook owns the drag listeners + class names, but its
  // built-in onDrop only fires the network call. We need to apply the
  // optimistic mutation locally first so the row visibly snaps before the
  // server confirms.
  const composeRowProps = useCallback(
    (id: string) => {
      const base = rank.rowProps(id);
      const baseOnDrop = base.onDrop;
      return {
        ...base,
        onDrop: (e: React.DragEvent<HTMLTableRowElement>) => {
          const moverId = rank.draggingId;
          const target = rank.dropTarget;
          if (moverId && target && moverId !== target.id) {
            applyDrop(moverId, target.pos, target.id);
          }
          baseOnDrop?.(e as unknown as React.DragEvent);
        },
      };
    },
    [rank, applyDrop]
  );

  const roots = items.filter((i) => !i.parent_id);
  const sortedRoots = sort.key ? sortItems(roots, sort.key, sort.dir) : roots;

  function renderRows(rows: WorkItem[], depth: number, startIndex = 0, ancestorContinuations: boolean[] = []): React.ReactNode {
    let runningIndex = startIndex;
    return rows.map((item, idx) => {
      const children = childMap[item.id] ?? [];
      const isExpanded = expanded.has(item.id);
      const mightHaveChildren = item.children_count > 0 || children.length > 0;
      const rowIndex = runningIndex++;
      const isLast = idx === rows.length - 1;
      // continuations for children: pass our own "not-last" state appended to ancestors
      const childContinuations = [...ancestorContinuations, !isLast];

      return (
        <React.Fragment key={item.id}>
          <WorkItemRow
            item={item}
            depth={depth}
            expanded={isExpanded}
            hasChildren={mightHaveChildren}
            onToggle={() => toggle(item)}
            onSelect={() => onSelect(item)}
            onPatch={patchAndApply}
            selected={selectedId === item.id}
            animIndex={depth > 0 ? rowIndex : undefined}
            isFirst={idx === 0}
            isLast={isLast}
            continuations={ancestorContinuations}
            hasVisibleChildren={isExpanded && children.length > 0}
            rowProps={composeRowProps(item.id)}
            handleProps={rank.handleProps(item.id)}
          />
          {loadingId === item.id && (
            <tr key={item.id + "-loading"}>
              <td className="table__cell table__cell--muted work-items-tree__loading" colSpan={7}>
                Loading…
              </td>
            </tr>
          )}
          {isExpanded && children.length > 0 && renderRows(children, depth + 1, runningIndex, childContinuations)}
        </React.Fragment>
      );
    });
  }

  if (items.length === 0) {
    return (
      <div className="placeholder">
        <p className="placeholder__body">No work items match the current filters.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table work-items-tree" aria-label="Work items">
          <colgroup>
            <DynCol w={colWidths.drag} />
            <DynCol w={colWidths.toggle} />
            <DynCol w={colWidths.tag} />
            <DynCol w={colWidths.title} />
            <DynCol w={colWidths.status} />
            <DynCol w={colWidths.priority} />
            <DynCol w={colWidths.pts} />
          </colgroup>
          <thead className="table__head">
            <tr>
              <th
                className="table__cell work-items-tree__th work-items-tree__th--drag"
                aria-label="Drag handle column"
              />
              <th className="table__cell work-items-tree__th work-items-tree__th--toggle">
                <div className="work-items-tree__toggle-header">
                  <button
                    type="button"
                    className="btn btn--row-expander work-items-tree__toolbar-btn"
                    onClick={() => { if (allExpanded) { collapseAll(); setAllExpanded(false); } else { expandAll().then(() => setAllExpanded(true)); } }}
                    title={allExpanded ? "Collapse all" : "Expand all"}
                  >
                    <MdOutlineArrowForwardIos
                      size={12}
                      className={"work-items-tree__expander-icon" + (allExpanded ? " work-items-tree__expander-icon--open" : "")}
                    />
                  </button>
                </div>
                <span className="work-items-tree__resize-handle" onMouseDown={(e) => startResize("toggle", e)} aria-hidden="true" />
              </th>
              <SortTh label="Tag" sortKey="tag" current={sort.key} dir={sort.dir} onSort={handleSort} onResizeStart={(e) => startResize("tag", e)} />
              <SortTh label="Title" sortKey="title" current={sort.key} dir={sort.dir} onSort={handleSort} onResizeStart={(e) => startResize("title", e)} />
              <SortTh label="Status" sortKey="status" current={sort.key} dir={sort.dir} onSort={handleSort} onResizeStart={(e) => startResize("status", e)} />
              <SortTh label="Priority" sortKey="priority" current={sort.key} dir={sort.dir} onSort={handleSort} onResizeStart={(e) => startResize("priority", e)} />
              <SortTh label="Pts" sortKey="pts" current={sort.key} dir={sort.dir} onSort={handleSort} numeric onResizeStart={(e) => startResize("pts", e)} />
            </tr>
          </thead>
          <tbody>{renderRows(sortedRoots, 0)}</tbody>
        </table>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkItemsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    status: "",
    priority: "",
    sprint_id: "",
    item_type: "",
  });
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    epics: number;
    stories: number;
    tasks: number;
    defects: number;
    blocked: number;
  } | null>(null);
  const treeRef = useRef<WorkItemsTreeHandle | null>(null);
  const [activeTab, setActiveTab] = useState<"ex1" | "ex2">("ex2");

  const patchFilter = useCallback((patch: Partial<FilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  useEffect(() => {
    api<{ items: Sprint[] }>("/api/sprints")
      .then((r) => setSprints(r.items))
      .catch(() => {});
  }, []);

  // Summary scopes to subscription + sprint only — type/status/search filters
  // are intentionally ignored so the strip reflects the whole-tree shape
  // regardless of how the list is currently narrowed below.
  const refetchSummary = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.sprint_id) params.set("sprint_id", filters.sprint_id);
    const qs = params.toString();
    return api<{
      total: number;
      epics: number;
      stories: number;
      tasks: number;
      defects: number;
      blocked: number;
    }>(`/api/work-items/summary${qs ? "?" + qs : ""}`)
      .then((r) => setSummary(r))
      .catch(() => setSummary(null));
  }, [filters.sprint_id]);

  const refetch = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.sprint_id) params.set("sprint_id", filters.sprint_id);
    if (filters.item_type) params.set("item_type", filters.item_type);
    const qs = params.toString();
    const list = api<{ items: WorkItem[] }>(`/api/work-items${qs ? "?" + qs : ""}`)
      .then((r) => {
        let rows = r.items;
        if (filters.search.trim()) {
          const q = filters.search.toLowerCase();
          rows = rows.filter(
            (i) =>
              i.title.toLowerCase().includes(q) ||
              String(i.key_num).includes(q)
          );
        }
        setItems(rows);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return Promise.all([list, refetchSummary()]).then(() => undefined);
  }, [filters, refetchSummary]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime subscription: refetch when any other tab/user reorders work
  // items in the same scope. Scope is "sprint" + sprintID when filtering by
  // sprint, otherwise "backlog" + the user's subscriptionID. Topic is null
  // until the user is loaded, which keeps the WS dormant on first paint.
  const subscriptionID = user?.subscription_id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  // Strip cells come from the /api/work-items/summary endpoint so counts
  // span the whole tree (every descendant level), not just the top-level
  // rows currently rendered. Defects + Blocked use the warning tone, which
  // only paints amber when their value > 0. Blocked = open items that
  // haven't been updated in 14 days (heuristic; no explicit flag yet).
  const summaryCells = useMemo(() => {
    const s = summary ?? { total: 0, epics: 0, stories: 0, tasks: 0, defects: 0, blocked: 0 };
    return [
      { label: "TOTAL ITEMS", value: s.total },
      { label: "EPICS", value: s.epics },
      { label: "TASKS", value: s.tasks },
      { label: "DEFECTS", value: s.defects, tone: "warning" as const },
      { label: "BLOCKED", value: s.blocked, tone: "warning" as const, glyph: "issue" as const },
    ];
  }, [summary]);

  return (
    <StrictRoute>
    <PageShell
      title="Work Items"
      subtitle="Epics, stories, and their custom fields"
      actions={
        selectedItem ? (
          <button type="button" className="btn btn--ghost" onClick={() => setSelectedItem(null)}>
            Close panel
          </button>
        ) : undefined
      }
    >
      <PageSummaryHeader
        cells={summaryCells}
        search={{
          value: filters.search,
          onChange: (next) => patchFilter({ search: next }),
          placeholder: "Search by title or key…",
          ariaLabel: "Search work items",
        }}
      />

      <SecondaryNavigation<"ex1" | "ex2">
        ariaLabel="Work item views"
        pageId="work-items"
        reorderable
        active={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "ex2", label: "Work items", sortKey: "Work items" },
          { key: "ex1", label: "Example 1", sortKey: "Example 1" },
        ]}
      />

      {activeTab === "ex1" ? (
        <>
          <Panel name="work_items_filters" title="Filters">
            <WorkItemsFilterBar
              filters={filters}
              sprints={sprints}
              onChange={patchFilter}
              onNew={() => {}}
            />
          </Panel>

          <Panel name="work_items_tree" title="Work items">
            {loading ? (
              <div className="placeholder">
                <p className="placeholder__body">Loading…</p>
              </div>
            ) : (
              <div className="work-items-layout">
                <div className="work-items-layout__tree">
                  <WorkItemsTree
                    items={items}
                    setItems={setItems}
                    selectedId={selectedItem?.id ?? null}
                    onSelect={setSelectedItem}
                    onItemSync={(synced) => setSelectedItem(synced)}
                    treeRef={treeRef}
                  />
                </div>
                {selectedItem && (
                  <WorkItemDetailPanel
                    item={selectedItem}
                    onClose={() => setSelectedItem(null)}
                    onPatch={(id, body) => {
                      // Route every panel inline-edit through the tree's
                      // patchAndApply so the row, ancestor rollups, and the
                      // panel selection refresh in one render.
                      treeRef.current?.patch(id, body);
                    }}
                  />
                )}
              </div>
            )}
          </Panel>
        </>
      ) : (
        <Panel name="work_items_grid_tree" title="Grid-Tree">
          {loading ? (
            <div className="placeholder">
              <p className="placeholder__body">Loading…</p>
            </div>
          ) : (
            <Example2Tree
              items={items}
              setItems={setItems}
              selectedId={selectedItem?.id ?? null}
              onSelect={setSelectedItem}
              onPatched={() => { void refetch(); }}
            />
          )}
        </Panel>
      )}
    </PageShell>
    </StrictRoute>
  );
}

function DynCol({ w }: { w: string | number | undefined }) {
  const ref = useRef<HTMLTableColElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (w == null || w === "") {
      el.style.removeProperty("--col-w");
      return;
    }
    el.style.setProperty("--col-w", typeof w === "number" ? `${w}px` : String(w));
  }, [w]);
  return <col ref={ref} className="u-col-w" />;
}
