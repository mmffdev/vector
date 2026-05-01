"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import PageShell from "@/app/components/PageShell";
import { api } from "@/app/lib/api";
import WorkItemDetailPanel from "./WorkItemDetailPanel";
import { MdOutlineCreateNewFolder, MdOutlineFolder, MdChecklist, MdOutlineBugReport, MdOutlineArrowForwardIos } from "react-icons/md";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkItem {
  id: string;
  key_num: number;
  item_type: string;
  title: string;
  status: string;
  priority: string | null;
  story_points: number | null;
  sprint_id: string | null;
  parent_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  children_count: number;
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
      <input
        type="search"
        className="backlog-filter__search"
        placeholder="Search by title or key…"
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
        aria-label="Search work items"
      />

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
  selected,
  animIndex,
  isFirst,
  isLast,
  continuations,
  hasVisibleChildren,
}: {
  item: WorkItem;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onSelect: () => void;
  selected: boolean;
  animIndex?: number;
  isFirst?: boolean;
  isLast?: boolean;
  continuations?: boolean[];
  hasVisibleChildren?: boolean;
}) {
  const TypeIcon = TYPE_ICON[item.item_type] ?? null;
  return (
    <tr
      className={"table__row work-items-tree__row" + (selected ? " table__row--selected" : "") + (animIndex !== undefined ? " work-items-tree__row--child" : "")}
      style={animIndex !== undefined ? { animationDelay: `${animIndex * 30}ms` } : undefined}
      onClick={onSelect}
    >
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
            // Top-level spine. Absolutely-positioned SVG aligned to the same
            // column children's verticals use (lineX = STEP/2 = 12 from the
            // tag-inner content edge), so the spine continues straight into them.
            const H = 48;
            const MID = H / 2;
            const W = 24;
            const X = 12;
            const STUB_GAP = 10;
            const paths: string[] = [];
            if (!isFirst) paths.push(`M${X} 0 L${X} ${MID - STUB_GAP}`);
            if (!isLast || hasVisibleChildren) paths.push(`M${X} ${MID + STUB_GAP} L${X} ${H}`);
            if (paths.length === 0) return null;
            return (
              <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
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
      <td className="table__cell">
        {item.title}
      </td>
      <td className="table__cell">
        <span className={"pill pill--sm " + (STATUS_PILL[item.status] ?? "pill--neutral")}>
          {item.status.replace("_", " ")}
        </span>
      </td>
      <td className="table__cell">
        {item.priority && (
          <span className={"pill pill--sm " + (PRIORITY_PILL[item.priority] ?? "pill--neutral")}>
            {item.priority}
          </span>
        )}
      </td>
      <td className="table__cell table__cell--numeric">
        {item.story_points ?? "—"}
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
        cmp = (a.story_points ?? -1) - (b.story_points ?? -1);
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

const DEFAULT_COL_WIDTHS = { toggle: 40, tag: 120, title: 0, status: 120, priority: 100, pts: 60 };

function WorkItemsTree({
  items,
  selectedId,
  onSelect,
}: {
  items: WorkItem[];
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [childMap, setChildMap] = useState<Record<string, WorkItem[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: SortDir }>({ key: null, dir: "asc" });
  const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS);
  const resizeRef = useRef<{ col: keyof typeof DEFAULT_COL_WIDTHS; startX: number; startW: number } | null>(null);

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
            selected={selectedId === item.id}
            animIndex={depth > 0 ? rowIndex : undefined}
            isFirst={idx === 0}
            isLast={isLast}
            continuations={ancestorContinuations}
            hasVisibleChildren={isExpanded && children.length > 0}
          />
          {loadingId === item.id && (
            <tr key={item.id + "-loading"}>
              <td className="table__cell table__cell--muted work-items-tree__loading" colSpan={6}>
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
            <col style={{ width: colWidths.toggle }} />
            <col style={{ width: colWidths.tag }} />
            <col style={colWidths.title ? { width: colWidths.title } : undefined} />
            <col style={{ width: colWidths.status }} />
            <col style={{ width: colWidths.priority }} />
            <col style={{ width: colWidths.pts }} />
          </colgroup>
          <thead className="table__head">
            <tr>
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

  const patchFilter = useCallback((patch: Partial<FilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  useEffect(() => {
    api<{ items: Sprint[] }>("/api/sprints")
      .then((r) => setSprints(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.sprint_id) params.set("sprint_id", filters.sprint_id);
    if (filters.item_type) params.set("item_type", filters.item_type);
    const qs = params.toString();
    api<{ items: WorkItem[] }>(`/api/work-items${qs ? "?" + qs : ""}`)
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
  }, [filters]);

  return (
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
      <WorkItemsFilterBar
        filters={filters}
        sprints={sprints}
        onChange={patchFilter}
        onNew={() => {}}
      />

      {loading ? (
        <div className="placeholder">
          <p className="placeholder__body">Loading…</p>
        </div>
      ) : (
        <div className="work-items-layout">
          <div className="work-items-layout__tree">
            <WorkItemsTree
              items={items}
              selectedId={selectedItem?.id ?? null}
              onSelect={setSelectedItem}
            />
          </div>
          {selectedItem && (
            <WorkItemDetailPanel
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onUpdated={(updated) => {
                setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
                setSelectedItem(updated);
              }}
            />
          )}
        </div>
      )}
    </PageShell>
  );
}
