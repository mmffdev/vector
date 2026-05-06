"use client";

import React, { useCallback, useState, useMemo, useRef, useEffect } from "react";
import { api } from "@/app/lib/api";
import { MdOutlineArrowForwardIos, MdSearch, MdTune, MdOutlineCheckBox, MdOutlinePerson, MdUnfoldMore, MdExpandLess, MdExpandMore } from "react-icons/md";
import { BsArrowsCollapse, BsArrowsExpand } from "react-icons/bs";
import InlineEditField from "@/app/components/InlineEditField";
import { InlineSelect } from "@/app/components/InlineSelect";
import { useWorkItemFlowStates, type WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";
import { FlowStatePillRow } from "@/app/components/FlowStatePillRow";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkItem {
  id: string;
  key_num: number;
  item_type: string;
  title: string;
  status: string;
  flow_state_id: string;
  flow_state_name: string;
  flow_state_code: string;
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

// ─── Display helpers ──────────────────────────────────────────────────────────

const TYPE_PREFIX: Record<string, string> = {
  epic: "EP",
  story: "US",
  task: "TA",
  defect: "DE",
};

const TYPE_VARIANT: Record<string, string> = {
  epic: "tree_accordion-dense__type-badge--epic",
  story: "tree_accordion-dense__type-badge--story",
  task: "tree_accordion-dense__type-badge--task",
  defect: "tree_accordion-dense__type-badge--defect",
};

// Backend priority strings → P0/P1/P2 short codes.
const PRIORITY_CODE: Record<string, { code: string; mod: string }> = {
  critical: { code: "P0", mod: "p0" },
  high:     { code: "P1", mod: "p1" },
  medium:   { code: "P2", mod: "p2" },
  low:      { code: "P3", mod: "p3" },
};

const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"];

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortKey = "id" | "title" | "status" | "priority" | "points" | "sprint" | "due";
type SortDir = "asc" | "desc";

const CANONICAL_ORDER: Record<string, number> = {
  backlog: 0, ready: 1, doing: 2, completed: 3, accepted: 4,
};
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const TYPE_TIER: Record<string, number> = { epic: 1, story: 2, task: 3, defect: 4 };

function sortRoots(rows: WorkItem[], key: SortKey, dir: SortDir): WorkItem[] {
  const asc = dir === "asc";
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "id": {
        const ta = TYPE_TIER[a.item_type] ?? 99;
        const tb = TYPE_TIER[b.item_type] ?? 99;
        cmp = ta !== tb ? ta - tb : a.key_num - b.key_num;
        break;
      }
      case "title":    cmp = a.title.localeCompare(b.title); break;
      case "status":   cmp = (CANONICAL_ORDER[a.flow_state_code] ?? 99) - (CANONICAL_ORDER[b.flow_state_code] ?? 99); break;
      case "priority": cmp = (PRIORITY_ORDER[a.priority ?? ""] ?? 99) - (PRIORITY_ORDER[b.priority ?? ""] ?? 99); break;
      case "points":   cmp = ((a.rollup_points ?? a.story_points ?? -1)) - ((b.rollup_points ?? b.story_points ?? -1)); break;
      case "sprint":   cmp = (a.sprint_id ?? "").localeCompare(b.sprint_id ?? ""); break;
      case "due":      cmp = (a.updated_at ?? "").localeCompare(b.updated_at ?? ""); break;
    }
    return asc ? cmp : -cmp;
  });
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ col, sortKey, sortDir, onClick }: {
  col: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onClick: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      className={"tree_accordion-dense__sort-btn" + (active ? " tree_accordion-dense__sort-btn--active" : "")}
      aria-label={active ? (sortDir === "asc" ? "Sorted ascending" : "Sorted descending") : "Sort"}
      title={active ? (sortDir === "asc" ? "Sorted ascending — click to reverse" : "Sorted descending — click to clear") : "Sort"}
      onClick={(e) => { e.stopPropagation(); onClick(col); }}
    >
      {!active && <MdUnfoldMore size={16} />}
      {active && sortDir === "asc" && <MdExpandLess size={16} />}
      {active && sortDir === "desc" && <MdExpandMore size={16} />}
    </button>
  );
}

// ─── Column resize ────────────────────────────────────────────────────────────

// Per-column sizing model. Most columns are FIXED at a content-appropriate
// pixel width; SUMMARY is the FLEX column that absorbs all leftover space.
// This matches Rally's `flex` config — one greedy column, the rest fixed.
//
// Columns: [ID, Summary, Status, Pri, PtsOwner, Sprint, Due]
// Minimums are the width needed to render the header label without truncation
// (label text + sort icon + padding; ID adds its expand toggle). Columns can
// never shrink below these — neither via drag nor via narrow viewport.
const FIXED_WIDTHS: Array<number | null> = [90, null, 220, 70, 110, 95, 80];
const MIN_COL_WIDTHS = [70, 200, 180, 70, 110, 95, 70];

// Compute final pixel widths: every fixed column gets its declared width,
// the flex column (any null entry) gets `container - sumOfFixed`. If the
// container is too narrow, the flex column drops to its min and the table
// width may exceed the container — but `overflow-x: hidden` clips it.
function fitToContainer(
  fixed: Array<number | null>,
  mins: number[],
  totalPx: number,
): number[] {
  const n = fixed.length;
  const result = new Array<number>(n);
  let consumed = 0;
  let flexIdx = -1;
  for (let i = 0; i < n; i++) {
    if (fixed[i] === null) { flexIdx = i; continue; }
    result[i] = fixed[i] as number;
    consumed += result[i];
  }
  if (flexIdx >= 0) {
    result[flexIdx] = Math.max(mins[flexIdx], totalPx - consumed);
  }
  return result;
}

function useColumnResize(
  tableRef: React.RefObject<HTMLTableElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  // Initial state: fixed columns take their declared widths; flex column
  // gets its min until the effect runs and measures the container.
  const [widths, setWidths] = useState<number[]>(() =>
    fitToContainer(FIXED_WIDTHS, MIN_COL_WIDTHS, 1000),
  );
  const minWidths = useRef<number[]>(MIN_COL_WIDTHS);

  // Measure container on mount + on resize. Fixed columns stay at their
  // declared widths; the flex column absorbs the remainder. No scrollbars.
  useEffect(() => {
    const fit = () => {
      const c = containerRef.current;
      if (!c) return;
      const w = c.clientWidth;
      if (w <= 0) return;
      setWidths(fitToContainer(FIXED_WIDTHS, MIN_COL_WIDTHS, w));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef]);

  // Drag model: column[i]'s right edge tracks the mouse. Width change is
  // absorbed first by the immediate next neighbour (so the visual edge moves
  // with the cursor); when the neighbour is pinned at its min, the remainder
  // spills into the flex (Summary) column. Total table width stays constant.
  const startResize = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    const table = tableRef.current;
    if (!table) return;
    const cols = Array.from(table.querySelectorAll<HTMLElement>("colgroup col"));
    if (colIndex >= cols.length - 1) return; // last col has no neighbour to take from

    const flexIdx = FIXED_WIDTHS.findIndex((v) => v === null);
    const nextIdx = colIndex + 1;
    const useFlex = flexIdx >= 0 && flexIdx !== colIndex && flexIdx !== nextIdx;

    const startX = e.clientX;
    const startThis = parseInt(cols[colIndex]?.style.width || "0", 10) || 80;
    const startNext = parseInt(cols[nextIdx]?.style.width || "0", 10) || 80;
    const startFlex = useFlex ? (parseInt(cols[flexIdx]?.style.width || "0", 10) || 80) : 0;
    const minThis = minWidths.current[colIndex] ?? 40;
    const minNext = minWidths.current[nextIdx] ?? 40;
    const minFlex = useFlex ? (minWidths.current[flexIdx] ?? 40) : 0;

    const thisSlack = Math.max(0, startThis - minThis);
    const neighborSlack = Math.max(0, startNext - minNext);
    const flexSlack = useFlex ? Math.max(0, startFlex - minFlex) : 0;

    const onMove = (mv: MouseEvent) => {
      let delta = mv.clientX - startX;
      // Clamp by combined donor capacity in each direction:
      //  - Growing right: neighbour slack + flex slack
      //  - Shrinking left: this column's slack + flex slack
      delta = Math.max(delta, -(thisSlack + flexSlack));
      delta = Math.min(delta, neighborSlack + flexSlack);

      let thisChange = delta;
      let nextChange = 0;
      let flexChange = 0;
      if (delta > 0) {
        // Growing: drain neighbour first, spill the remainder into flex.
        const fromNeighbor = Math.min(delta, neighborSlack);
        nextChange = -fromNeighbor;
        flexChange = -(delta - fromNeighbor);
      } else if (delta < 0) {
        // Shrinking: this column shrinks first; once pinned at its min,
        // additional shrinkage is absorbed by flex (Summary), and the
        // neighbour grows by the full |delta|.
        const wantedShrink = -delta;
        nextChange = wantedShrink;
        if (wantedShrink > thisSlack) {
          thisChange = -thisSlack;
          flexChange = -(wantedShrink - thisSlack);
        }
      }

      if (cols[colIndex]) cols[colIndex].style.width = (startThis + thisChange) + "px";
      if (cols[nextIdx]) cols[nextIdx].style.width = (startNext + nextChange) + "px";
      if (useFlex && flexChange !== 0 && cols[flexIdx]) {
        cols[flexIdx].style.width = (startFlex + flexChange) + "px";
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const final = cols.map((c) => parseInt(c.style.width || "0", 10) || 80);
      setWidths(final);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [tableRef]);

  // Double-click reset: snap a single column back to its FIXED_WIDTHS default
  // (or refit the whole layout if the dblclicked column is the flex one).
  // The flex column (Summary) absorbs the difference for non-flex columns.
  const resetColumn = useCallback((colIndex: number) => {
    setWidths((prev) => {
      const target = FIXED_WIDTHS[colIndex];
      const flexIdx = FIXED_WIDTHS.findIndex((v) => v === null);
      if (target === null) {
        const c = containerRef.current;
        const w = c?.clientWidth ?? prev.reduce((s, x) => s + x, 0);
        return fitToContainer(FIXED_WIDTHS, MIN_COL_WIDTHS, w);
      }
      const next = [...prev];
      const delta = target - next[colIndex];
      next[colIndex] = target;
      if (flexIdx >= 0 && flexIdx !== colIndex) {
        next[flexIdx] = Math.max(
          minWidths.current[flexIdx] ?? 0,
          next[flexIdx] - delta,
        );
      }
      return next;
    });
  }, [containerRef]);

  return { widths, startResize, resetColumn };
}

// ─── Resize handle ────────────────────────────────────────────────────────────

function ResizeHandle({ colIndex, onStart }: {
  colIndex: number;
  onStart: (colIndex: number, e: React.MouseEvent) => void;
}) {
  return (
    <span
      className="tree_accordion-dense__resize-handle"
      onMouseDown={(e) => onStart(colIndex, e)}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-hidden="true"
    />
  );
}

function canHaveManualPoints(itemType: string): boolean {
  return itemType !== "task";
}

function formatPriority(raw: string | null) {
  if (!raw) return null;
  return PRIORITY_CODE[raw] ?? { code: raw.toUpperCase().slice(0, 2), mod: "p3" };
}

// Owner glyph: short 2-char monogram from owner_id; deterministic but cosmetic.
function ownerGlyph(ownerId: string): string {
  const clean = ownerId.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(-2) || "??").toUpperCase();
}

// Sprint label: backend gives sprint_id; for the dense grid we render a short
// "S-NN" alias. With no real mapping yet we fall back to the last 2 hex digits.
function sprintAlias(sprintId: string | null): string {
  if (!sprintId) return "—";
  const tail = sprintId.replace(/[^0-9a-fA-F]/g, "").slice(-2);
  if (!tail) return "—";
  const num = parseInt(tail, 16) % 30 + 1;
  return `S-${num.toString().padStart(2, "0")}`;
}

// Due: backend has no due date yet; offset from updated_at as a stand-in so
// the column reads like the screenshot. This is presentation-only.
function dueLabel(updated_at: string): string {
  const d = new Date(updated_at);
  if (Number.isNaN(d.getTime())) return "—";
  // Add 7 days as a placeholder offset.
  d.setDate(d.getDate() + 7);
  const m = d.toLocaleString("en-US", { month: "short" });
  return `${m} ${d.getDate()}`;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

// Tree-line geometry. STEP = horizontal width per depth level (px).
// ROW_H must match the .tree_accordion-dense__row height in CSS (28px).
// CARET_OFFSET is the x-coordinate where a parent row's expander caret
// is *centred* within its slot. The elbow's vertical drops on this x
// so the line lands directly under the parent caret rather than 2px to
// its right (which is what you get from a naive STEP/2 split).
const STEP = 20;
const ROW_H = 28;
const CARET_OFFSET = 8;

// Renders the SVG tree lines (pass-through verticals for ancestors + elbow/T
// for own depth). Mirrors the original WorkItemsTree geometry.
function TreeLines({
  depth,
  isLast,
  hasVisibleChildren,
  continuations,
}: {
  depth: number;
  isLast: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
}) {
  if (depth === 0) return null;
  const H = ROW_H;
  const MID = H / 2;
  const W = depth * STEP;
  // lineX = x of THIS row's vertical (under parent caret centre).
  // childLineX = x of grandchild verticals (under our own caret centre).
  const lineX = (depth - 1) * STEP + CARET_OFFSET;
  const childLineX = depth * STEP + CARET_OFFSET;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  // Ancestor pass-throughs: every level above our parent that still has
  // siblings below this subtree gets a full-height vertical line.
  const ancestors = continuations.slice(0, -1);
  ancestors.forEach((cont, i) => {
    if (cont) {
      const x = i * STEP + CARET_OFFSET;
      throughPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  // Own connector. A last-sibling with no visible children is a clean elbow (└).
  // Otherwise it's a T (├) so the parent's vertical continues through.
  const renderAsLast = isLast && !hasVisibleChildren;
  if (renderAsLast) {
    paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
  } else {
    paths.push(`M${lineX} 0 L${lineX} ${H}`);
    paths.push(`M${lineX} ${MID} L${W} ${MID}`);
    if (hasVisibleChildren) {
      paths.push(`M${childLineX} ${MID + 6} L${childLineX} ${H}`);
    }
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="tree_accordion-dense__svg"
      aria-hidden="true"
    >
      {throughPaths.map((d, i) => (
        <path key={`t${i}`} d={d} stroke="var(--border)" strokeWidth="1.25" fill="none" strokeLinecap="round" />
      ))}
      {paths.map((d, i) => (
        <path key={`c${i}`} d={d} stroke="var(--border)" strokeWidth="1.25" fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function GridRow({
  item,
  depth,
  expanded,
  hasChildren,
  selected,
  onToggle,
  onSelect,
  onPatch,
  isLast,
  hasVisibleChildren,
  continuations,
  flowStates,
}: {
  item: WorkItem;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  isLast: boolean;
  hasVisibleChildren: boolean;
  continuations: boolean[];
  flowStates: WorkItemFlowState[];
}) {
  const pri = formatPriority(item.priority);
  const isEpic = item.item_type === "epic";
  const idText = `${TYPE_PREFIX[item.item_type] ?? "?"}-${item.key_num}`;

  return (
    <tr
      className={
        "tree_accordion-dense__row" +
        (isEpic ? " tree_accordion-dense__row--epic" : depth > 0 ? " tree_accordion-dense__row--child" : "") +
        (selected ? " tree_accordion-dense__row--selected" : "")
      }
      onClick={onSelect}
    >
      <td className="tree_accordion-dense__cell tree_accordion-dense__cell--id">
        <span className="tree_accordion-dense__id-inner">
          <TreeLines
            depth={depth}
            isLast={isLast}
            hasVisibleChildren={hasVisibleChildren}
            continuations={continuations}
          />
          <button
            type="button"
            className={
              "tree_accordion-dense__expander" +
              (expanded ? " tree_accordion-dense__expander--open" : "") +
              (!hasChildren ? " tree_accordion-dense__expander--leaf" : "")
            }
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(); }}
            tabIndex={hasChildren ? 0 : -1}
          >
            <MdOutlineArrowForwardIos size={10} className="tree_accordion-dense__expander-icon" />
          </button>
          <span className="tree_accordion-dense__id-text">{idText}</span>
        </span>
      </td>
      <td className="tree_accordion-dense__cell tree_accordion-dense__cell--summary" onClick={(e) => e.stopPropagation()}>
        <span className="tree_accordion-dense__summary">
          <TreeLines
            depth={depth}
            isLast={isLast}
            hasVisibleChildren={hasVisibleChildren}
            continuations={continuations}
          />
          <span className={"tree_accordion-dense__type-badge " + (TYPE_VARIANT[item.item_type] ?? "")}>
            {TYPE_PREFIX[item.item_type] ?? "?"}
          </span>
          <span className={"tree_accordion-dense__title" + (isEpic ? " tree_accordion-dense__title--epic" : "")}>
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
          </span>
        </span>
      </td>
      <td className="tree_accordion-dense__cell" onClick={(e) => e.stopPropagation()}>
        <FlowStatePillRow
          currentId={item.flow_state_id}
          currentCode={item.flow_state_code}
          states={flowStates}
          onCommit={(next) => onPatch(item.id, { flow_state_id: next })}
        />
      </td>
      <td className="tree_accordion-dense__cell">
        <InlineSelect
          value={item.priority ?? ""}
          options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
          onCommit={(next) => onPatch(item.id, { priority: next === "" ? null : next })}
          ariaLabel="Work item priority"
          placeholder="None"
          trigger={
            pri ? (
              <span className={"tree_accordion-dense__pri tree_accordion-dense__pri--" + pri.mod}>{pri.code}</span>
            ) : (
              <span className="tree_accordion-dense__pri tree_accordion-dense__pri--p3">—</span>
            )
          }
        />
      </td>
      <td className="tree_accordion-dense__cell tree_accordion-dense__cell--mono" onClick={(e) => e.stopPropagation()}>
        {!canHaveManualPoints(item.item_type) ? (
          <span>—</span>
        ) : item.rollup_points != null ? (
          <span title={`Rolled up. Manual: ${item.story_points ?? "—"}`}>
            {item.rollup_points}{ownerGlyph(item.owner_id)}
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
      <td className="tree_accordion-dense__cell tree_accordion-dense__cell--mono">{sprintAlias(item.sprint_id)}</td>
      <td className="tree_accordion-dense__cell tree_accordion-dense__cell--mono">{dueLabel(item.updated_at)}</td>
    </tr>
  );
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

export default function WorkItemsTree({
  selectedId,
  onSelect,
  onPatched,
}: {
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: (body: Record<string, unknown>) => void;
}) {
  const flowStates = useWorkItemFlowStates();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childMap, setChildMap] = useState<Record<string, WorkItem[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Server-side pagination — the LL tab fetches one window of root rows at a
  // time using ?limit&offset. "all" requests up to the backend max (5000).
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [pageIndex, setPageIndex] = useState(0);
  const [windowRoots, setWindowRoots] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingWindow, setLoadingWindow] = useState(false);
  // Sort state lives here (rather than below) so refetchWindow can include
  // sort/dir in the request URL — server-side ORDER BY is the only way for
  // pagination to honour tier-grouping across pages.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Fetch the current window of root rows from the backend. Re-runs whenever
  // pageSize or pageIndex changes; also exposed as `refetchWindow` so a
  // rollup-affecting patch can refresh ancestor rollup_points.
  // "View all" issues a first chunk to learn total, then fetches remaining
  // chunks in parallel — children are still loaded lazily on expand.
  const refetchWindow = useCallback(async () => {
    setLoadingWindow(true);
    const sortQuery = sortKey === "id" ? `&sort=id&dir=${sortDir}` : "";
    try {
      if (pageSize === "all") {
        const CHUNK = 1000;
        const first = await api<{ items: WorkItem[]; total: number }>(
          `/api/work-items?limit=${CHUNK}&offset=0${sortQuery}`,
        );
        const totalRoots = first.total ?? first.items.length;
        if (totalRoots <= first.items.length) {
          setWindowRoots(first.items);
          setTotal(totalRoots);
          return;
        }
        const offsets: number[] = [];
        for (let o = first.items.length; o < totalRoots; o += CHUNK) offsets.push(o);
        const rest = await Promise.all(
          offsets.map((o) =>
            api<{ items: WorkItem[]; total: number }>(
              `/api/work-items?limit=${CHUNK}&offset=${o}${sortQuery}`,
            ),
          ),
        );
        const all = [...first.items, ...rest.flatMap((r) => r.items)];
        setWindowRoots(all);
        setTotal(totalRoots);
        return;
      }
      const offset = pageIndex * pageSize;
      const res = await api<{ items: WorkItem[]; total: number }>(
        `/api/work-items?limit=${pageSize}&offset=${offset}${sortQuery}`,
      );
      setWindowRoots(res.items);
      setTotal(res.total ?? res.items.length);
    } finally {
      setLoadingWindow(false);
    }
  }, [pageSize, pageIndex, sortKey, sortDir]);

  useEffect(() => { void refetchWindow(); }, [refetchWindow]);

  // PATCH a single field; optimistically update local state in
  // windowRoots/childMap, then notify the parent (so the summary strip
  // refreshes). For rollup-affecting patches we also re-fetch this window —
  // the same patch can shift rollup_points on ancestors.
  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      const inRoots = windowRoots.some((r) => r.id === id);
      if (inRoots) {
        setWindowRoots((prev) => prev.map((r) => (r.id === id ? { ...r, ...body } as WorkItem : r)));
      } else {
        setChildMap((prev) => {
          const next: Record<string, WorkItem[]> = {};
          for (const [pid, kids] of Object.entries(prev)) {
            next[pid] = kids.map((r) => (r.id === id ? { ...r, ...body } as WorkItem : r));
          }
          return next;
        });
      }
      api<WorkItem>(`/api/work-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
        .then(() => {
          onPatched?.(body);
          if ("story_points" in body) void refetchWindow();
        })
        .catch(() => { /* swallow — refetch on next push */ });
    },
    [windowRoots, onPatched, refetchWindow],
  );

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

  // Expand every level: iteratively walk roots → fetch unloaded children →
  // recurse until no expandable rows remain. Mirrors the WorkItemsTree
  // implementation; safe to await because each level is one round trip.
  const expandAll = useCallback(async () => {
    let currentMap = { ...childMap };
    const allExpandable = new Set<string>();

    const collectUnfetched = (rows: WorkItem[]): WorkItem[] => {
      const unfetched: WorkItem[] = [];
      for (const it of rows) {
        if (it.children_count > 0 || (currentMap[it.id] ?? []).length > 0) {
          allExpandable.add(it.id);
          if (!currentMap[it.id]) {
            unfetched.push(it);
          } else {
            unfetched.push(...collectUnfetched(currentMap[it.id]));
          }
        }
      }
      return unfetched;
    };

    const CONCURRENCY = 6;
    const fetchInPool = async (
      items: WorkItem[],
    ): Promise<{ id: string; children: WorkItem[] }[]> => {
      const out: { id: string; children: WorkItem[] }[] = new Array(items.length);
      let next = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (true) {
          const i = next++;
          if (i >= items.length) return;
          const it = items[i];
          const res = await api<{ items: WorkItem[] }>(`/api/work-items/${it.id}/children`);
          out[i] = { id: it.id, children: res.items };
        }
      });
      await Promise.all(workers);
      return out;
    };

    let toFetch = collectUnfetched(windowRoots);
    while (toFetch.length > 0) {
      const results = await fetchInPool(toFetch);
      for (const { id, children } of results) {
        currentMap[id] = children;
        for (const c of children) {
          if (c.children_count > 0) allExpandable.add(c.id);
        }
      }
      toFetch = results.flatMap(({ children }) =>
        children.filter((c) => c.children_count > 0 && !currentMap[c.id]),
      );
    }
    setChildMap(currentMap);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of allExpandable) next.add(id);
      return next;
    });
  }, [windowRoots, childMap]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { widths, startResize, resetColumn } = useColumnResize(tableRef, scrollRef);

  const onSort = useCallback((col: SortKey) => {
    setSortKey((prev) => {
      if (prev !== col) { setSortDir("asc"); return col; }
      if (sortDir === "asc") { setSortDir("desc"); return col; }
      return null; // third click clears
    });
  }, [sortDir]);

  // The backend already returned roots only (parent_id IS NULL default). The
  // filter is kept as a defensive identity in case future callers pass a
  // server payload that includes children.
  const roots = useMemo(() => windowRoots.filter((i) => !i.parent_id), [windowRoots]);

  // Quick filter and client sort operate on the loaded window only — this is
  // the lazy-load tradeoff. Switching pages re-fetches a fresh slice from the
  // server-side ORDER BY, so sorting is consistent within a page but does not
  // cross page boundaries.
  const filteredRoots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roots;
    return roots.filter(
      (r) => r.title.toLowerCase().includes(q) || `vec-${r.key_num}`.includes(q),
    );
  }, [roots, search]);

  const visibleRoots = useMemo(() => {
    if (!sortKey) return filteredRoots;
    return sortRoots(filteredRoots, sortKey, sortDir);
  }, [filteredRoots, sortKey, sortDir]);

  // Server tells us the total — use it to compute page count without holding
  // every row in memory. "View all" loads every root in one window (chunked
  // under the hood) so pageCount collapses to 1.
  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  // The window IS the page — no client slice. visibleRoots already reflects
  // the active sort/filter applied to the loaded window.
  const pagedRoots = visibleRoots;

  // Total visible count (incl. expanded children) for the "N items" indicator.
  const visibleCount = useMemo(() => {
    let n = 0;
    const walk = (rows: WorkItem[]) => {
      for (const r of rows) {
        n += 1;
        if (expanded.has(r.id)) {
          const kids = childMap[r.id] ?? [];
          if (kids.length) walk(kids);
        }
      }
    };
    walk(pagedRoots);
    return n;
  }, [pagedRoots, expanded, childMap]);

  function renderRows(
    rows: WorkItem[],
    depth: number,
    ancestorContinuations: boolean[] = [],
  ): React.ReactNode {
    return rows.map((item, idx) => {
      const children = childMap[item.id] ?? [];
      const isExpanded = expanded.has(item.id);
      const mightHaveChildren = item.children_count > 0 || children.length > 0;
      const isLast = idx === rows.length - 1;
      const hasVisibleChildren = isExpanded && children.length > 0;
      // continuations passed to this row = ancestors + (this row continues = !isLast)
      // The last entry represents our own parent's "still-has-siblings" state,
      // which TreeLines slices off so it doesn't double-paint our own lineX.
      const ownContinuations = [...ancestorContinuations, !isLast];
      return (
        <React.Fragment key={item.id}>
          <GridRow
            item={item}
            depth={depth}
            expanded={isExpanded}
            hasChildren={mightHaveChildren}
            selected={selectedId === item.id}
            onToggle={() => toggle(item)}
            onSelect={() => onSelect(item)}
            onPatch={patchAndApply}
            isLast={isLast}
            hasVisibleChildren={hasVisibleChildren}
            continuations={ancestorContinuations}
            flowStates={flowStates}
          />
          {loadingId === item.id && (
            <tr>
              <td className="tree_accordion-dense__cell" colSpan={7} style={{ paddingLeft: 12 + depth * STEP + 32, color: "var(--ink-subtle)" }}>
                Loading…
              </td>
            </tr>
          )}
          {hasVisibleChildren && renderRows(children, depth + 1, ownContinuations)}
        </React.Fragment>
      );
    });
  }

  return (
    <div>
      <header className="tree_accordion-dense__panel-head">
        <span className="tree_accordion-dense__panel-head-num">05</span>
        <div className="tree_accordion-dense__panel-head-body">
          <h3 className="tree_accordion-dense__panel-head-title">Dense grid</h3>
          <p className="tree_accordion-dense__panel-head-subtitle">
            Spreadsheet-fast. 28px rows, single-character status, mono ID column.
          </p>
        </div>
      </header>

      <div className="tree_accordion-dense__filterbar" role="search">
        <div className="tree_accordion-dense__filterbar-search">
          <span className="tree_accordion-dense__filterbar-search-icon" aria-hidden="true">
            <MdSearch size={12} />
          </span>
          <input
            type="search"
            className="tree_accordion-dense__filterbar-search-input"
            placeholder="Search work items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search work items"
          />
        </div>
        <button type="button" className="tree_accordion-dense__filterbar-chip">
          <span className="tree_accordion-dense__filterbar-chip-icon"><MdTune size={14} /></span>
          Type
        </button>
        <button type="button" className="tree_accordion-dense__filterbar-chip">
          <span className="tree_accordion-dense__filterbar-chip-icon"><MdOutlineCheckBox size={14} /></span>
          Status
        </button>
        <button type="button" className="tree_accordion-dense__filterbar-chip">
          <span className="tree_accordion-dense__filterbar-chip-icon"><MdOutlinePerson size={14} /></span>
          Assignee
        </button>
        <span className="tree_accordion-dense__filterbar-spacer" />
        <span className="tree_accordion-dense__filterbar-count">{visibleCount} items</span>
      </div>

      <Pagination
        totalRoots={total}
        pageSize={pageSize}
        pageIndex={safePageIndex}
        pageCount={pageCount}
        onPageChange={setPageIndex}
        onPageSizeChange={(next) => { setPageSize(next); setPageIndex(0); }}
        position="top"
      />

      <div ref={scrollRef} className="tree_accordion-dense__scroll">
        <table
          ref={tableRef}
          className="tree_accordion-dense__table tree_accordion-dense__table--resizable tree_accordion-dense__table--fixed"
          style={{ tableLayout: "fixed", width: "100%" }}
          aria-label="Work items dense grid"
        >
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead className="tree_accordion-dense__head">
            <tr>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono" onDoubleClick={() => resetColumn(0)} title="Double-click to reset column width">
                <span className="tree_accordion-dense__th-id">
                  {expanded.size > 0 ? (
                    <button type="button" className="tree_accordion-dense__th-toggle" aria-label="Collapse all" title="Collapse all" onClick={collapseAll}>
                      <BsArrowsCollapse size={10} />
                    </button>
                  ) : (
                    <button type="button" className="tree_accordion-dense__th-toggle" aria-label="Expand all" title="Expand all" onClick={() => { void expandAll(); }}>
                      <BsArrowsExpand size={10} />
                    </button>
                  )}
                  ID
                  <SortIcon col="id" sortKey={sortKey} sortDir={sortDir} onClick={onSort} />
                </span>
              </th>
              <th className="tree_accordion-dense__th" onDoubleClick={() => resetColumn(1)} title="Double-click to reset column width">
                <ResizeHandle colIndex={0} onStart={startResize} />
                <span className="tree_accordion-dense__th-sortable">Summary <SortIcon col="title" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></span>
              </th>
              <th className="tree_accordion-dense__th" onDoubleClick={() => resetColumn(2)} title="Double-click to reset column width">
                <ResizeHandle colIndex={1} onStart={startResize} />
                <span className="tree_accordion-dense__th-sortable">Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></span>
              </th>
              <th className="tree_accordion-dense__th" onDoubleClick={() => resetColumn(3)} title="Double-click to reset column width">
                <ResizeHandle colIndex={2} onStart={startResize} />
                <span className="tree_accordion-dense__th-sortable">Pri <SortIcon col="priority" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></span>
              </th>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono" onDoubleClick={() => resetColumn(4)} title="Double-click to reset column width">
                <ResizeHandle colIndex={3} onStart={startResize} />
                <span className="tree_accordion-dense__th-sortable">PtsOwner <SortIcon col="points" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></span>
              </th>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono" onDoubleClick={() => resetColumn(5)} title="Double-click to reset column width">
                <ResizeHandle colIndex={4} onStart={startResize} />
                <span className="tree_accordion-dense__th-sortable">Sprint <SortIcon col="sprint" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></span>
              </th>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono" onDoubleClick={() => resetColumn(6)} title="Double-click to reset column width">
                <ResizeHandle colIndex={5} onStart={startResize} />
                <span className="tree_accordion-dense__th-sortable">Due <SortIcon col="due" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></span>
              </th>
            </tr>
          </thead>
          <tbody>{renderRows(pagedRoots, 0)}</tbody>
        </table>
      </div>

      <Pagination
        totalRoots={total}
        pageSize={pageSize}
        pageIndex={safePageIndex}
        pageCount={pageCount}
        onPageChange={setPageIndex}
        onPageSizeChange={(next) => { setPageSize(next); setPageIndex(0); }}
        position="bottom"
      />

      {loadingWindow && visibleRoots.length === 0 && (
        <div className="placeholder">
          <p className="placeholder__body">Loading…</p>
        </div>
      )}
      {!loadingWindow && visibleRoots.length === 0 && (
        <div className="placeholder">
          <p className="placeholder__body">No work items match the current filters.</p>
        </div>
      )}
    </div>
  );
}

function Pagination({
  totalRoots,
  pageSize,
  pageIndex,
  pageCount,
  onPageChange,
  onPageSizeChange,
  position,
}: {
  totalRoots: number;
  pageSize: number | "all";
  pageIndex: number;
  pageCount: number;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number | "all") => void;
  position: "top" | "bottom";
}) {
  // "View all" loads everything (chunked) — single page, no prev/next needed.
  const effSize = pageSize === "all" ? Math.max(totalRoots, 1) : pageSize;
  // Page-button window: show first, last, current ±1, with ellipses elsewhere.
  // Keeps the pager compact even with hundreds of pages.
  const pages: (number | "…")[] = [];
  if (pageCount <= 1) {
    // no pager when there's nothing to page through
  } else {
    const window = new Set<number>([0, pageCount - 1, pageIndex - 1, pageIndex, pageIndex + 1]);
    const sorted = [...window]
      .filter((n) => n >= 0 && n < pageCount)
      .sort((a, b) => a - b);
    let prev = -1;
    for (const n of sorted) {
      if (prev >= 0 && n - prev > 1) pages.push("…");
      pages.push(n);
      prev = n;
    }
  }

  const sizeOptions: ({ value: number | "all"; label: string })[] = [
    { value: 25, label: "25" },
    { value: 50, label: "50" },
    { value: 100, label: "100" },
  ];

  const start = totalRoots === 0 ? 0 : pageIndex * effSize + 1;
  const end = Math.min(totalRoots, (pageIndex + 1) * effSize);

  return (
    <div
      className={`tree_accordion-dense__pagination tree_accordion-dense__pagination--${position}`}
      role="navigation"
      aria-label="Pagination"
    >
      <span className="tree_accordion-dense__pagination-info">
        {totalRoots === 0
          ? "0 rows"
          : `${start.toLocaleString()}–${end.toLocaleString()} of ${totalRoots.toLocaleString()}`}
      </span>

      <div className="tree_accordion-dense__pagination-pagesize" role="group" aria-label="Rows per page">
        {sizeOptions.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className={
              "tree_accordion-dense__pagination-pagesize-btn" +
              (opt.value === pageSize
                ? " tree_accordion-dense__pagination-pagesize-btn--active"
                : "")
            }
            onClick={() => onPageSizeChange(opt.value)}
            aria-pressed={opt.value === pageSize}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {pages.length > 0 && (
        <div className="tree_accordion-dense__pagination-pager" role="group" aria-label="Pages">
          <button
            type="button"
            className="tree_accordion-dense__pagination-btn"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="tree_accordion-dense__pagination-ellipsis">…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={
                  "tree_accordion-dense__pagination-btn" +
                  (p === pageIndex ? " tree_accordion-dense__pagination-btn--active" : "")
                }
                onClick={() => onPageChange(p)}
                aria-current={p === pageIndex ? "page" : undefined}
                aria-label={`Page ${p + 1}`}
              >
                {p + 1}
              </button>
            ),
          )}
          <button
            type="button"
            className="tree_accordion-dense__pagination-btn"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
