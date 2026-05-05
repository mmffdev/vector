"use client";

import React, { useCallback, useState, useMemo } from "react";
import { api } from "@/app/lib/api";
import { MdOutlineArrowForwardIos, MdSearch, MdTune, MdOutlineCheckBox, MdOutlinePerson } from "react-icons/md";
import { BsArrowsCollapse, BsArrowsExpand } from "react-icons/bs";
import InlineEditField from "@/app/components/InlineEditField";
import { InlineSelect } from "./InlineSelect";
import { useWorkItemFlowStates, CANONICAL_PILL, type WorkItemFlowState } from "./useWorkItemFlowStates";

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
  const statusMod = CANONICAL_PILL[item.flow_state_code] ?? "neutral";
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
      <td className="tree_accordion-dense__cell">
        <InlineSelect
          value={item.flow_state_id}
          options={flowStates.map((s) => ({ value: s.id, label: s.name }))}
          onCommit={(next) => onPatch(item.id, { flow_state_id: next })}
          ariaLabel="Work item status"
          trigger={
            <span className={"tree_accordion-dense__status tree_accordion-dense__status--" + statusMod}>
              <span className="tree_accordion-dense__status-dot" />
              <span className="tree_accordion-dense__status-text">{item.flow_state_name}</span>
            </span>
          }
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

export default function Example2Tree({
  items,
  setItems,
  selectedId,
  onSelect,
  onPatched,
}: {
  items: WorkItem[];
  setItems: (next: WorkItem[]) => void;
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: () => void;
}) {
  const flowStates = useWorkItemFlowStates();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childMap, setChildMap] = useState<Record<string, WorkItem[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Pagination operates on root rows only — descendants come along with the
  // root when a row is expanded. "all" disables paging entirely.
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [pageIndex, setPageIndex] = useState(0);

  // PATCH a single field; optimistically update local state in roots/childMap,
  // then notify the parent so it can refetch (which keeps rollups + summary
  // accurate). On error we silently leave the optimistic value — the next
  // realtime push or refetch will reconcile.
  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      // Optimistic merge into roots.
      const inRoots = items.some((r) => r.id === id);
      if (inRoots) {
        setItems(items.map((r) => (r.id === id ? { ...r, ...body } as WorkItem : r)));
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
        .then(() => { onPatched?.(); })
        .catch(() => { /* swallow — refetch on next push */ });
    },
    [items, setItems, onPatched],
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

    let toFetch = collectUnfetched(items);
    while (toFetch.length > 0) {
      const results = await Promise.all(
        toFetch.map((it) =>
          api<{ items: WorkItem[] }>(`/api/work-items/${it.id}/children`).then((res) => ({
            id: it.id,
            children: res.items,
          })),
        ),
      );
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
  }, [items, childMap]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const roots = useMemo(() => items.filter((i) => !i.parent_id), [items]);

  // Quick filter — only filters root rows by title or VEC-id.
  const visibleRoots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roots;
    return roots.filter(
      (r) => r.title.toLowerCase().includes(q) || `vec-${r.key_num}`.includes(q),
    );
  }, [roots, search]);

  // Pagination — slice of roots actually rendered. "all" returns the full
  // filtered list. pageIndex is clamped against the current page count so
  // changing pageSize doesn't strand the user on a non-existent page.
  const pageCount = pageSize === "all"
    ? 1
    : Math.max(1, Math.ceil(visibleRoots.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRoots = useMemo(() => {
    if (pageSize === "all") return visibleRoots;
    const start = safePageIndex * pageSize;
    return visibleRoots.slice(start, start + pageSize);
  }, [visibleRoots, pageSize, safePageIndex]);

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
        totalRoots={visibleRoots.length}
        pageSize={pageSize}
        pageIndex={safePageIndex}
        pageCount={pageCount}
        onPageChange={setPageIndex}
        onPageSizeChange={(next) => { setPageSize(next); setPageIndex(0); }}
        position="top"
      />

      <div className="tree_accordion-dense__scroll">
        <table className="tree_accordion-dense__table" aria-label="Work items dense grid">
          <colgroup>
            <col style={{ width: 220 }} />
            <col />
            <col style={{ width: 130 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead className="tree_accordion-dense__head">
            <tr>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono">
                <span className="tree_accordion-dense__th-id">
                  {expanded.size > 0 ? (
                    <button
                      type="button"
                      className="tree_accordion-dense__th-toggle"
                      aria-label="Collapse all"
                      title="Collapse all"
                      onClick={collapseAll}
                    >
                      <BsArrowsCollapse size={10} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="tree_accordion-dense__th-toggle"
                      aria-label="Expand all"
                      title="Expand all"
                      onClick={() => { void expandAll(); }}
                    >
                      <BsArrowsExpand size={10} />
                    </button>
                  )}
                  ID
                </span>
              </th>
              <th className="tree_accordion-dense__th">Summary</th>
              <th className="tree_accordion-dense__th">Status</th>
              <th className="tree_accordion-dense__th">Pri</th>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono">PtsOwner</th>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono">Sprint</th>
              <th className="tree_accordion-dense__th tree_accordion-dense__th--mono">Due</th>
            </tr>
          </thead>
          <tbody>{renderRows(pagedRoots, 0)}</tbody>
        </table>
      </div>

      <Pagination
        totalRoots={visibleRoots.length}
        pageSize={pageSize}
        pageIndex={safePageIndex}
        pageCount={pageCount}
        onPageChange={setPageIndex}
        onPageSizeChange={(next) => { setPageSize(next); setPageIndex(0); }}
        position="bottom"
      />

      {visibleRoots.length === 0 && (
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
  // Page-button window: show first, last, current ±1, with ellipses elsewhere.
  // Keeps the pager compact even with hundreds of pages.
  const pages: (number | "…")[] = [];
  if (pageSize === "all" || pageCount <= 1) {
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
    { value: "all", label: "View all" },
    { value: 25, label: "25" },
    { value: 50, label: "50" },
    { value: 100, label: "100" },
  ];

  const start = pageSize === "all" ? 1 : pageIndex * pageSize + 1;
  const end = pageSize === "all"
    ? totalRoots
    : Math.min(totalRoots, (pageIndex + 1) * pageSize);

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
