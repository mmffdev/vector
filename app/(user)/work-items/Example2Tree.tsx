"use client";

import React, { useCallback, useState, useMemo } from "react";
import { api } from "@/app/lib/api";
import { MdOutlineArrowForwardIos, MdSearch, MdTune, MdOutlineCheckBox, MdOutlinePerson } from "react-icons/md";
import { BsArrowsCollapse, BsArrowsExpand } from "react-icons/bs";
import InlineEditField from "@/app/components/InlineEditField";
import { InlineSelect } from "./InlineSelect";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkItem {
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

// ─── Display helpers ──────────────────────────────────────────────────────────

const TYPE_PREFIX: Record<string, string> = {
  epic: "EP",
  story: "US",
  task: "TA",
  defect: "DE",
};

const TYPE_VARIANT: Record<string, string> = {
  epic: "gtree__type-badge--epic",
  story: "gtree__type-badge--story",
  task: "gtree__type-badge--task",
  defect: "gtree__type-badge--defect",
};

// Map backend status → status modifier + display label.
const STATUS_VARIANT: Record<string, { mod: string; label: string }> = {
  open: { mod: "neutral", label: "To do" },
  todo: { mod: "neutral", label: "To do" },
  in_progress: { mod: "info", label: "In progress" },
  in_review: { mod: "review", label: "In review" },
  review: { mod: "review", label: "In review" },
  done: { mod: "success", label: "Done" },
  blocked: { mod: "danger", label: "Blocked" },
  cancelled: { mod: "neutral", label: "Cancelled" },
};

// Backend priority strings → P0/P1/P2 short codes.
const PRIORITY_CODE: Record<string, { code: string; mod: string }> = {
  critical: { code: "P0", mod: "p0" },
  high:     { code: "P1", mod: "p1" },
  medium:   { code: "P2", mod: "p2" },
  low:      { code: "P3", mod: "p3" },
};

const STATUS_OPTIONS = ["open", "in_progress", "done", "cancelled"];
const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"];

function canHaveManualPoints(itemType: string): boolean {
  return itemType !== "task";
}

function formatStatus(raw: string) {
  return STATUS_VARIANT[raw] ?? { mod: "neutral", label: raw.replace(/_/g, " ") };
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
// ROW_H must match the .gtree__row height in CSS (28px).
const STEP = 20;
const ROW_H = 28;

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
  const lineX = (depth - 1) * STEP + STEP / 2;
  const childLineX = depth * STEP + STEP / 2;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  // Ancestor pass-throughs: every level above our parent that still has
  // siblings below this subtree gets a full-height vertical line.
  const ancestors = continuations.slice(0, -1);
  ancestors.forEach((cont, i) => {
    if (cont) {
      const x = i * STEP + STEP / 2;
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
      className="gtree__svg"
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
}) {
  const status = formatStatus(item.status);
  const pri = formatPriority(item.priority);
  const isEpic = item.item_type === "epic";
  const idText = `${TYPE_PREFIX[item.item_type] ?? "?"}-${item.key_num}`;

  return (
    <tr
      className={
        "gtree__row" +
        (isEpic ? " gtree__row--epic" : depth > 0 ? " gtree__row--child" : "") +
        (selected ? " gtree__row--selected" : "")
      }
      onClick={onSelect}
    >
      <td className="gtree__cell gtree__cell--id">
        <span className="gtree__id-inner">
          <TreeLines
            depth={depth}
            isLast={isLast}
            hasVisibleChildren={hasVisibleChildren}
            continuations={continuations}
          />
          <button
            type="button"
            className={
              "gtree__expander" +
              (expanded ? " gtree__expander--open" : "") +
              (!hasChildren ? " gtree__expander--leaf" : "")
            }
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(); }}
            tabIndex={hasChildren ? 0 : -1}
          >
            <MdOutlineArrowForwardIos size={10} className="gtree__expander-icon" />
          </button>
          <span className="gtree__id-text">{idText}</span>
        </span>
      </td>
      <td className="gtree__cell gtree__cell--summary" onClick={(e) => e.stopPropagation()}>
        <span className="gtree__summary">
          <TreeLines
            depth={depth}
            isLast={isLast}
            hasVisibleChildren={hasVisibleChildren}
            continuations={continuations}
          />
          <span className={"gtree__type-badge " + (TYPE_VARIANT[item.item_type] ?? "")}>
            {TYPE_PREFIX[item.item_type] ?? "?"}
          </span>
          <span className={"gtree__title" + (isEpic ? " gtree__title--epic" : "")}>
            <InlineEditField
              value={item.title}
              onCommit={(next) => onPatch(item.id, { title: next })}
              ariaLabel="Work item title"
              inputClassName="form__input form__input--sm"
              displayClassName="gtree__title-text"
              clickToEdit
              stopPointerOnInput
              maxLength={200}
            />
          </span>
        </span>
      </td>
      <td className="gtree__cell">
        <InlineSelect
          value={item.status}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace("_", " ") }))}
          onCommit={(next) => onPatch(item.id, { status: next })}
          ariaLabel="Work item status"
          trigger={
            <span className={"gtree__status gtree__status--" + status.mod}>
              <span className="gtree__status-dot" />
              <span className="gtree__status-text">{status.label}</span>
            </span>
          }
        />
      </td>
      <td className="gtree__cell">
        <InlineSelect
          value={item.priority ?? ""}
          options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
          onCommit={(next) => onPatch(item.id, { priority: next === "" ? null : next })}
          ariaLabel="Work item priority"
          placeholder="None"
          trigger={
            pri ? (
              <span className={"gtree__pri gtree__pri--" + pri.mod}>{pri.code}</span>
            ) : (
              <span className="gtree__pri gtree__pri--p3">—</span>
            )
          }
        />
      </td>
      <td className="gtree__cell gtree__cell--mono" onClick={(e) => e.stopPropagation()}>
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
            displayClassName="gtree__pts-text"
            clickToEdit
            stopPointerOnInput
            allowEmpty
            emptyDisplay="—"
            maxLength={6}
          />
        )}
      </td>
      <td className="gtree__cell gtree__cell--mono">{sprintAlias(item.sprint_id)}</td>
      <td className="gtree__cell gtree__cell--mono">{dueLabel(item.updated_at)}</td>
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childMap, setChildMap] = useState<Record<string, WorkItem[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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
    walk(visibleRoots);
    return n;
  }, [visibleRoots, expanded, childMap]);

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
          />
          {loadingId === item.id && (
            <tr>
              <td className="gtree__cell" colSpan={7} style={{ paddingLeft: 12 + depth * STEP + 32, color: "var(--ink-subtle)" }}>
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
      <header className="gtree-panel-head">
        <span className="gtree-panel-head__num">05</span>
        <div className="gtree-panel-head__body">
          <h3 className="gtree-panel-head__title">Dense grid</h3>
          <p className="gtree-panel-head__subtitle">
            Spreadsheet-fast. 28px rows, single-character status, mono ID column.
          </p>
        </div>
      </header>

      <div className="gtree-filterbar" role="search">
        {expanded.size > 0 ? (
          <button
            type="button"
            className="gtree-filterbar__icon-btn"
            aria-label="Collapse all"
            title="Collapse all"
            onClick={collapseAll}
          >
            <BsArrowsCollapse size={12} />
          </button>
        ) : (
          <button
            type="button"
            className="gtree-filterbar__icon-btn"
            aria-label="Expand all"
            title="Expand all"
            onClick={() => { void expandAll(); }}
          >
            <BsArrowsExpand size={12} />
          </button>
        )}
        <div className="gtree-filterbar__search">
          <span className="gtree-filterbar__search-icon" aria-hidden="true">
            <MdSearch size={12} />
          </span>
          <input
            type="search"
            className="gtree-filterbar__search-input"
            placeholder="Search work items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search work items"
          />
        </div>
        <button type="button" className="gtree-filterbar__chip">
          <span className="gtree-filterbar__chip-icon"><MdTune size={14} /></span>
          Type
        </button>
        <button type="button" className="gtree-filterbar__chip">
          <span className="gtree-filterbar__chip-icon"><MdOutlineCheckBox size={14} /></span>
          Status
        </button>
        <button type="button" className="gtree-filterbar__chip">
          <span className="gtree-filterbar__chip-icon"><MdOutlinePerson size={14} /></span>
          Assignee
        </button>
        <span className="gtree-filterbar__spacer" />
        <span className="gtree-filterbar__count">{visibleCount} items</span>
      </div>

      <div className="table-wrap">
        <table className="gtree" aria-label="Work items dense grid">
          <colgroup>
            <col style={{ width: 220 }} />
            <col />
            <col style={{ width: 130 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead className="gtree__head">
            <tr>
              <th className="gtree__th gtree__th--mono">ID</th>
              <th className="gtree__th">Summary</th>
              <th className="gtree__th">Status</th>
              <th className="gtree__th">Pri</th>
              <th className="gtree__th gtree__th--mono">PtsOwner</th>
              <th className="gtree__th gtree__th--mono">Sprint</th>
              <th className="gtree__th gtree__th--mono">Due</th>
            </tr>
          </thead>
          <tbody>{renderRows(visibleRoots, 0)}</tbody>
        </table>
      </div>

      {visibleRoots.length === 0 && (
        <div className="placeholder">
          <p className="placeholder__body">No work items match the current filters.</p>
        </div>
      )}
    </div>
  );
}
