"use client";

// Work-items-specific configuration for the generic <ResourceTree>.
// Owns the column defs, cell renderers, sort comparators, presentation helpers
// (sprint alias, owner glyph, due-date placeholder), the filter-chips slot,
// the panel header, and the /api/work-items I/O hook. The wrapper in
// WorkItemsTree.tsx wires these into ResourceTree props.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MdTune, MdOutlineCheckBox, MdOutlinePerson, MdFlag, MdClose } from "react-icons/md";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import InlineEditField from "@/app/components/InlineEditField";
import { InlineSelect } from "@/app/components/InlineSelect";
import { FlowStatePillRow } from "@/app/components/FlowStatePillRow";
import type { WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";
import {
  PrimaryCellTreeLines,
  PrimaryCellExpander,
  type ColumnDef,
  type RenderCtx,
} from "@/app/components/ResourceTree";

// ─── Public type ──────────────────────────────────────────────────────────────

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
  high: { code: "P1", mod: "p1" },
  medium: { code: "P2", mod: "p2" },
  low: { code: "P3", mod: "p3" },
};

const PRIORITY_OPTIONS = ["critical", "high", "medium", "low"];

export function canHaveManualPoints(itemType: string): boolean {
  return itemType !== "task";
}

export function formatPriority(raw: string | null) {
  if (!raw) return null;
  return (
    PRIORITY_CODE[raw] ?? { code: raw.toUpperCase().slice(0, 2), mod: "p3" }
  );
}

// Owner glyph: 2-char monogram from owner_id; deterministic but cosmetic.
// Placeholder pending Wave-4 owner-display work.
export function ownerGlyph(ownerId: string): string {
  const clean = ownerId.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.slice(-2) || "??").toUpperCase();
}

// Sprint label: backend gives sprint_id; we render a short "S-NN" alias.
// With no real sprint mapping yet we hash the last 2 hex digits.
export function sprintAlias(sprintId: string | null): string {
  if (!sprintId) return "—";
  const tail = sprintId.replace(/[^0-9a-fA-F]/g, "").slice(-2);
  if (!tail) return "—";
  const num = (parseInt(tail, 16) % 30) + 1;
  return `S-${num.toString().padStart(2, "0")}`;
}

// Due: backend has no due date yet; offset from updated_at as a stand-in.
export function dueLabel(updated_at: string): string {
  const d = new Date(updated_at);
  if (Number.isNaN(d.getTime())) return "—";
  d.setDate(d.getDate() + 7);
  const m = d.toLocaleString("en-US", { month: "short" });
  return `${m} ${d.getDate()}`;
}

// ─── Sort comparator ──────────────────────────────────────────────────────────

export type SortKey =
  | "id" | "title" | "status" | "priority" | "points" | "sprint" | "due";
export type SortDir = "asc" | "desc";

const CANONICAL_ORDER: Record<string, number> = {
  backlog: 0, ready: 1, doing: 2, completed: 3, accepted: 4,
};
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const TYPE_TIER: Record<string, number> = { epic: 1, story: 2, task: 3, defect: 4 };

export function sortRoots(rows: WorkItem[], key: SortKey, dir: SortDir): WorkItem[] {
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

// ─── Cell renderers ───────────────────────────────────────────────────────────

function IdCell({ row, ctx }: { row: WorkItem; ctx: RenderCtx<WorkItem> }) {
  const idText = `${TYPE_PREFIX[row.item_type] ?? "?"}-${row.key_num}`;
  return (
    <span className="tree_accordion-dense__id-inner">
      <PrimaryCellTreeLines
        depth={ctx.depth}
        isLast={ctx.isLast}
        hasVisibleChildren={ctx.hasVisibleChildren}
        continuations={ctx.continuations}
      />
      <PrimaryCellExpander
        expanded={ctx.expanded}
        hasChildren={ctx.hasChildren}
        onToggle={ctx.toggle}
      />
      <span className="tree_accordion-dense__id-text">{idText}</span>
    </span>
  );
}

function SummaryCell({
  row,
  ctx,
  onPatch,
}: {
  row: WorkItem;
  ctx: RenderCtx<WorkItem>;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const isEpic = row.item_type === "epic";
  return (
    <span className="tree_accordion-dense__summary">
      <PrimaryCellTreeLines
        depth={ctx.depth}
        isLast={ctx.isLast}
        hasVisibleChildren={ctx.hasVisibleChildren}
        continuations={ctx.continuations}
      />
      <span
        className={
          "tree_accordion-dense__type-badge " +
          (TYPE_VARIANT[row.item_type] ?? "")
        }
      >
        {TYPE_PREFIX[row.item_type] ?? "?"}
      </span>
      <span
        className={
          "tree_accordion-dense__title" +
          (isEpic ? " tree_accordion-dense__title--epic" : "")
        }
      >
        <InlineEditField
          value={row.title}
          onCommit={(next) => onPatch(row.id, { title: next })}
          ariaLabel="Work item title"
          inputClassName="form__input form__input--sm"
          displayClassName="inline-edit-trigger"
          clickToEdit
          stopPointerOnInput
          maxLength={200}
        />
      </span>
    </span>
  );
}

function StatusCell({
  row,
  flowStates,
  onPatch,
}: {
  row: WorkItem;
  flowStates: WorkItemFlowState[];
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  return (
    <FlowStatePillRow
      currentId={row.flow_state_id}
      currentCode={row.flow_state_code}
      states={flowStates}
      onCommit={(next) => onPatch(row.id, { flow_state_id: next })}
    />
  );
}

function PriorityCell({
  row,
  onPatch,
}: {
  row: WorkItem;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const pri = formatPriority(row.priority);
  return (
    <InlineSelect
      value={row.priority ?? ""}
      options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
      onCommit={(next) => onPatch(row.id, { priority: next === "" ? null : next })}
      ariaLabel="Work item priority"
      placeholder="None"
      trigger={
        pri ? (
          <span className={"tree_accordion-dense__pri tree_accordion-dense__pri--" + pri.mod}>
            {pri.code}
          </span>
        ) : (
          <span className="tree_accordion-dense__pri tree_accordion-dense__pri--p3">—</span>
        )
      }
    />
  );
}

function PointsOwnerCell({
  row,
  onPatch,
}: {
  row: WorkItem;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  if (!canHaveManualPoints(row.item_type)) return <span>—</span>;
  if (row.rollup_points != null) {
    return (
      <span title={`Rolled up. Manual: ${row.story_points ?? "—"}`}>
        {row.rollup_points}
        {ownerGlyph(row.owner_id)}
      </span>
    );
  }
  return (
    <InlineEditField
      value={row.story_points != null ? String(row.story_points) : ""}
      onCommit={(next) => {
        const trimmed = next.trim();
        if (trimmed === "") return onPatch(row.id, { story_points: null });
        const parsed = parseInt(trimmed, 10);
        if (Number.isNaN(parsed) || parsed < 0) return false;
        return onPatch(row.id, { story_points: parsed });
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
  );
}

// ─── Column factory ───────────────────────────────────────────────────────────

export function buildWorkItemsColumns(
  flowStates: WorkItemFlowState[],
  patchAndApply: (id: string, body: Record<string, unknown>) => void,
): ColumnDef<WorkItem>[] {
  return [
    {
      key: "id",
      label: "ID",
      width: 90,
      minWidth: 70,
      align: "mono",
      cellModifier: "id",
      render: (row, ctx) => <IdCell row={row} ctx={ctx} />,
    },
    {
      key: "title",
      label: "Summary",
      width: null,
      minWidth: 200,
      cellModifier: "summary",
      stopClick: true,
      render: (row, ctx) => (
        <SummaryCell row={row} ctx={ctx} onPatch={patchAndApply} />
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 220,
      minWidth: 180,
      stopClick: true,
      render: (row) => (
        <StatusCell row={row} flowStates={flowStates} onPatch={patchAndApply} />
      ),
    },
    {
      key: "priority",
      label: "Pri",
      width: 70,
      minWidth: 70,
      render: (row) => <PriorityCell row={row} onPatch={patchAndApply} />,
    },
    {
      key: "points",
      label: "PtsOwner",
      width: 110,
      minWidth: 110,
      align: "mono",
      stopClick: true,
      render: (row) => <PointsOwnerCell row={row} onPatch={patchAndApply} />,
    },
    {
      key: "sprint",
      label: "Sprint",
      width: 95,
      minWidth: 95,
      align: "mono",
      render: (row) => <>{sprintAlias(row.sprint_id)}</>,
    },
    {
      key: "due",
      label: "Due",
      width: 80,
      minWidth: 70,
      align: "mono",
      render: (row) => <>{dueLabel(row.updated_at)}</>,
    },
  ];
}

// ─── Panel header + filter chips ──────────────────────────────────────────────

export function WorkItemsPanelHeader() {
  return (
    <header className="tree_accordion-dense__panel-head">
      <span className="tree_accordion-dense__panel-head-num">05</span>
      <div className="tree_accordion-dense__panel-head-body">
        <h3 className="tree_accordion-dense__panel-head-title">Dense grid</h3>
        <p className="tree_accordion-dense__panel-head-subtitle">
          Spreadsheet-fast. 28px rows, single-character status, mono ID column.
        </p>
      </div>
    </header>
  );
}

// ─── Filter state (URL-backed) ────────────────────────────────────────────────

export interface WorkItemsFilters {
  type: string | null;
  status: string | null;
  priority: string | null;
  owner_id: string | null;
}

export const EMPTY_FILTERS: WorkItemsFilters = {
  type: null,
  status: null,
  priority: null,
  owner_id: null,
};

// Single source of truth: URL search params. Each filter maps to one param
// of the same name (so the URL stays human-readable). All updates route
// through router.replace() so back/forward history is not polluted on each
// chip flick — bookmarking still works because params are persisted.
export function useWorkItemsFilters(): {
  filters: WorkItemsFilters;
  hasAny: boolean;
  setFilter: <K extends keyof WorkItemsFilters>(key: K, value: WorkItemsFilters[K]) => void;
  clearAll: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const filters = useMemo<WorkItemsFilters>(
    () => ({
      type: search.get("type"),
      status: search.get("status"),
      priority: search.get("priority"),
      owner_id: search.get("owner_id"),
    }),
    [search],
  );

  const hasAny = !!(filters.type || filters.status || filters.priority || filters.owner_id);

  const setFilter = useCallback(
    <K extends keyof WorkItemsFilters>(key: K, value: WorkItemsFilters[K]) => {
      const next = new URLSearchParams(search.toString());
      if (value == null || value === "") next.delete(key);
      else next.set(key, String(value));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  const clearAll = useCallback(() => {
    const next = new URLSearchParams(search.toString());
    (["type", "status", "priority", "owner_id"] as const).forEach((k) => next.delete(k));
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, search]);

  return { filters, hasAny, setFilter, clearAll };
}

// ─── Sort URL state ───────────────────────────────────────────────────────────

const SORT_KEYS: ReadonlySet<string> = new Set([
  "id", "title", "status", "priority", "points", "sprint", "due",
]);

// Sort state mirrors the filter pattern: URL is the single source of truth.
// `?sort=<key>&dir=asc|desc`; absent ⇒ default (no sort key, server uses
// position order). setSort with key=null clears both params at once.
export function useWorkItemsSort(): {
  sortKey: SortKey | null;
  sortDir: SortDir;
  setSort: (key: SortKey | null, dir: SortDir) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const rawKey = search.get("sort");
  const rawDir = search.get("dir");
  const sortKey = (rawKey && SORT_KEYS.has(rawKey) ? rawKey : null) as SortKey | null;
  const sortDir: SortDir = rawDir === "desc" ? "desc" : "asc";

  const setSort = useCallback(
    (key: SortKey | null, dir: SortDir) => {
      const next = new URLSearchParams(search.toString());
      if (key == null) {
        next.delete("sort");
        next.delete("dir");
      } else {
        next.set("sort", key);
        next.set("dir", dir);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  return { sortKey, sortDir, setSort };
}

// ─── Filter chips (controlled) ────────────────────────────────────────────────

const TYPE_CHIP_OPTIONS = [
  { value: "epic", label: "Epic" },
  { value: "story", label: "Story" },
  { value: "task", label: "Task" },
  { value: "defect", label: "Defect" },
];

// Backend `?status=` filter is the legacy enum (open/in_progress/done/cancelled)
// and lives alongside the new flow_state_id substrate during the migration
// window — see types.go WorkItem.Status comment. The chip uses the legacy
// values until the backend exposes a `?flow_state_code=` filter.
const STATUS_CHIP_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_CHIP_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function FilterChip({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (next: string | null) => void;
}) {
  const active = !!value;
  const display = active ? (options.find((o) => o.value === value)?.label ?? value!) : label;
  return (
    <span
      className={
        "tree_accordion-dense__filterbar-chip" +
        (active ? " tree_accordion-dense__filterbar-chip--active" : "")
      }
    >
      <span className="tree_accordion-dense__filterbar-chip-icon">{icon}</span>
      <span className="tree_accordion-dense__filterbar-chip-label">{display}</span>
      <select
        className="tree_accordion-dense__filterbar-chip-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        aria-label={`Filter by ${label}`}
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          className="tree_accordion-dense__filterbar-chip-clear"
          onClick={(e) => { e.stopPropagation(); onChange(null); }}
          aria-label={`Clear ${label.toLowerCase()} filter`}
        >
          <MdClose size={12} />
        </button>
      )}
    </span>
  );
}

// Controlled filter chips. State lives in URL via useWorkItemsFilters().
// Owner chip is a "Mine" toggle that filters to the current user — full
// owner-picker UI requires a /api/users endpoint with users.list permission
// (deferred to a Wave-4 Owner-column story).
export function WorkItemsFilterChips() {
  const { user } = useAuth();
  const { filters, hasAny, setFilter, clearAll } = useWorkItemsFilters();
  const meId = user?.id ?? null;
  const ownerIsMe = !!filters.owner_id && filters.owner_id === meId;

  return (
    <>
      <FilterChip
        icon={<MdTune size={14} />}
        label="Type"
        value={filters.type}
        options={TYPE_CHIP_OPTIONS}
        onChange={(v) => setFilter("type", v)}
      />
      <FilterChip
        icon={<MdOutlineCheckBox size={14} />}
        label="Status"
        value={filters.status}
        options={STATUS_CHIP_OPTIONS}
        onChange={(v) => setFilter("status", v)}
      />
      <FilterChip
        icon={<MdFlag size={14} />}
        label="Priority"
        value={filters.priority}
        options={PRIORITY_CHIP_OPTIONS}
        onChange={(v) => setFilter("priority", v)}
      />
      <button
        type="button"
        className={
          "tree_accordion-dense__filterbar-chip" +
          (ownerIsMe ? " tree_accordion-dense__filterbar-chip--active" : "")
        }
        onClick={() => setFilter("owner_id", ownerIsMe ? null : meId)}
        disabled={!meId}
        aria-pressed={ownerIsMe}
      >
        <span className="tree_accordion-dense__filterbar-chip-icon">
          <MdOutlinePerson size={14} />
        </span>
        <span className="tree_accordion-dense__filterbar-chip-label">
          {ownerIsMe ? "Mine" : "Owner"}
        </span>
      </button>
      {hasAny && (
        <button
          type="button"
          className="tree_accordion-dense__filterbar-clear"
          onClick={clearAll}
        >
          Clear filters
        </button>
      )}
    </>
  );
}

// ─── I/O hook ─────────────────────────────────────────────────────────────────

export interface UseWorkItemsWindowResult {
  windowRoots: WorkItem[];
  total: number;
  loadingWindow: boolean;
  refetchWindow: () => Promise<void>;
  patchAndApply: (id: string, body: Record<string, unknown>) => void;
  fetchChildren: (parentId: string) => Promise<WorkItem[]>;
}

// Fetches a window of root work items + supplies optimistic PATCH and lazy
// child loading. "View all" issues a first chunk to learn total, then fetches
// remaining chunks in parallel — children stay lazy.
//
// Filters: each non-null entry is appended to the request query. The backend
// `?status=` param is the legacy enum during the flow_state migration window.
// The chip-level `type` field maps to the server param `item_type`.
export function useWorkItemsWindow(
  pageSize: number | "all",
  pageIndex: number,
  sortKey: SortKey | null,
  sortDir: SortDir,
  filters: WorkItemsFilters,
  onPatched?: (body: Record<string, unknown>) => void,
): UseWorkItemsWindowResult {
  const [windowRoots, setWindowRoots] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingWindow, setLoadingWindow] = useState(false);

  const filterQuery = useMemo(() => {
    const parts: string[] = [];
    if (filters.type) parts.push(`item_type=${encodeURIComponent(filters.type)}`);
    if (filters.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
    if (filters.priority) parts.push(`priority=${encodeURIComponent(filters.priority)}`);
    if (filters.owner_id) parts.push(`owner_id=${encodeURIComponent(filters.owner_id)}`);
    return parts.length ? `&${parts.join("&")}` : "";
  }, [filters.type, filters.status, filters.priority, filters.owner_id]);

  const refetchWindow = useCallback(async () => {
    setLoadingWindow(true);
    // Backend ORDER BY whitelist (00452) covers every SortKey value, so any
    // non-null key threads through to the server. Default (null) keeps the
    // canonical position-then-key order.
    const sortQuery = sortKey ? `&sort=${sortKey}&dir=${sortDir}` : "";
    try {
      if (pageSize === "all") {
        const CHUNK = 1000;
        const first = await api<{ items: WorkItem[]; total: number }>(
          `/api/work-items?limit=${CHUNK}&offset=0${sortQuery}${filterQuery}`,
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
              `/api/work-items?limit=${CHUNK}&offset=${o}${sortQuery}${filterQuery}`,
            ),
          ),
        );
        setWindowRoots([...first.items, ...rest.flatMap((r) => r.items)]);
        setTotal(totalRoots);
        return;
      }
      const offset = pageIndex * pageSize;
      const res = await api<{ items: WorkItem[]; total: number }>(
        `/api/work-items?limit=${pageSize}&offset=${offset}${sortQuery}${filterQuery}`,
      );
      setWindowRoots(res.items);
      setTotal(res.total ?? res.items.length);
    } finally {
      setLoadingWindow(false);
    }
  }, [pageSize, pageIndex, sortKey, sortDir, filterQuery]);

  useEffect(() => { void refetchWindow(); }, [refetchWindow]);

  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      setWindowRoots((prev) =>
        prev.map((r) => (r.id === id ? ({ ...r, ...body } as WorkItem) : r)),
      );
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
    [onPatched, refetchWindow],
  );

  const fetchChildren = useCallback(async (parentId: string) => {
    const res = await api<{ items: WorkItem[] }>(
      `/api/work-items/${parentId}/children`,
    );
    return res.items;
  }, []);

  return { windowRoots, total, loadingWindow, refetchWindow, patchAndApply, fetchChildren };
}
