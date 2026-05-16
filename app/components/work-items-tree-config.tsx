"use client";

// Work-items-specific configuration for the generic <ResourceTree>.
// Owns the column defs, cell renderers, sort comparators, presentation helpers
// (sprint alias, owner glyph, due-date placeholder), the filter-chips slot,
// the panel header, and the /api/work-items I/O hook. The wrapper in
// WorkItemsTree.tsx wires these into ResourceTree props.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdTune, MdOutlineCheckBox, MdOutlinePerson, MdFlag } from "react-icons/md";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { apiSite } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import { safeInk, type TypeColourMap } from "@/app/lib/colourUtils";
import { artefactTypesApi } from "@/app/lib/artefactTypesApi";
import InlineEditField from "@/app/components/InlineEditField";
import { InlineSelect } from "@/app/components/InlineSelect";
import { FlowStatePillRow } from "@/app/components/FlowStatePillRow";
import OwnerChip from "@/app/components/OwnerChip";
import NavigationPie from "@/app/components/NavigationPie";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import type { WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";
import {
  PrimaryCellTreeLines,
  PrimaryCellExpander,
  type ColumnDef,
  type RenderCtx,
} from "@/app/components/ResourceTree";

// ─── Artefact-type colour map ─────────────────────────────────────────────────

// Fetches artefact type colours once per mount (module-level cache so the
// request fires at most once across all tree instances on the same page).
let _colourCache: TypeColourMap | null = null;
let _colourPromise: Promise<TypeColourMap> | null = null;

async function fetchColourMap(): Promise<TypeColourMap> {
  if (_colourCache) return _colourCache;
  if (!_colourPromise) {
    _colourPromise = artefactTypesApi.list().then((types) => {
      const m: TypeColourMap = new Map();
      for (const t of types) {
        if (t.colour) m.set(t.prefix, { colour: t.colour, name: t.name });
      }
      _colourCache = m;
      return m;
    }).catch(() => new Map());
  }
  return _colourPromise;
}

export function useArtefactTypeColours(): TypeColourMap {
  const [map, setMap] = useState<TypeColourMap>(_colourCache ?? new Map());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    fetchColourMap().then((m) => { if (mounted.current) setMap(m); });
    return () => { mounted.current = false; };
  }, []);
  return map;
}

// ─── Public type ──────────────────────────────────────────────────────────────

export interface WorkItem {
  id: string;
  key_num: number;
  item_type: string;
  type_prefix: string;
  title: string;
  status: string;
  flow_state_id: string;
  flow_state_name: string;
  flow_state_code: string;
  priority: string | null;
  story_points: number | null;
  rollup_points: number | null;
  sprint_id: string | null;
  // PLA-0021 / 00458 — backend now joins the sprints row and emits
  // `sprint: {id, alias}` (alias = sprints.name). null when the row has
  // no sprint or the sprint is archived. Renders the alias directly —
  // no client-side derivation. The legacy `sprint_id` field is kept
  // for writers (PATCH still posts sprint_id).
  sprint: { id: string; alias: string } | null;
  parent_id: string | null;
  owner_id: string;
  // PLA-0021 / 00459 — backend now joins the users row and emits
  // `owner: {id, display_name, avatar_url}` derived from first/last name
  // (with email fallback). null only when the join fails (deleted user).
  // The legacy `owner_id` field is kept for writers (PATCH still posts it).
  owner: { id: string; display_name: string; avatar_url: string | null } | null;
  // Per-row due date from artefacts.due_date. Wire shape is YYYY-MM-DD
  // (Postgres ::text cast). null when unset; the inline date editor in
  // the Due column posts "" or null to clear, and a parsed YYYY-MM-DD
  // string to set.
  due_date: string | null;
  created_at: string;
  updated_at: string;
  children_count: number;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

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

// PLA-0021 / 00460 (WS4-C) — Due column display helper. The backend now
// emits a real YYYY-MM-DD date in `due_date`; we just reformat to the
// short "Mon DD" form for the dense grid. Returns "—" when null/invalid
// so the placeholder matches every other empty column in the row.
export function formatDueDate(due_date: string | null | undefined): string {
  if (!due_date) return "—";
  // Parse as a local-tz date by appending T00:00 — bare YYYY-MM-DD is
  // interpreted as UTC midnight by Date(), which on negative-offset
  // timezones rolls back to the previous day in the rendered output.
  const d = new Date(due_date + "T00:00");
  if (Number.isNaN(d.getTime())) return "—";
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
// PLA-0052 Story 11 — Risk added at tier 5; Defect/Task swapped to match
// the backend CASE clause in service.go:850 (Epic→1, Story→2, Defect→3,
// Task→4, Risk→5). FE and BE must agree on ordering otherwise the
// secondary client-side sort drifts from the server-paginated list.
const TYPE_TIER: Record<string, number> = { epic: 1, story: 2, defect: 3, task: 4, risk: 5 };

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
      // PLA-0021 / 00460 (WS4-C) — sort by the real due_date now. Empty
      // (null) values sort last in both directions; localeCompare on
      // YYYY-MM-DD is a correct calendar comparison without parsing.
      case "due": {
        const av = a.due_date ?? "";
        const bv = b.due_date ?? "";
        if (av === "" && bv === "") cmp = 0;
        else if (av === "") cmp = 1;
        else if (bv === "") cmp = -1;
        else cmp = av.localeCompare(bv);
        break;
      }
    }
    return asc ? cmp : -cmp;
  });
}

// ─── Cell renderers ───────────────────────────────────────────────────────────

function IdCell({ row, ctx }: { row: WorkItem; ctx: RenderCtx<WorkItem> }) {
  const idText = `${row.type_prefix || row.item_type.slice(0, 2).toUpperCase()}-${row.key_num}`;
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
  colourMap,
}: {
  row: WorkItem;
  ctx: RenderCtx<WorkItem>;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  colourMap?: TypeColourMap;
}) {
  const isEpic = row.item_type === "epic";
  const colourEntry = colourMap?.get(row.type_prefix);
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
          (colourEntry ? "" : (TYPE_VARIANT[row.item_type] ?? ""))
        }
        style={colourEntry ? { background: colourEntry.colour, color: safeInk(colourEntry.colour) } : undefined}
      >
        {row.type_prefix || row.item_type.slice(0, 2).toUpperCase()}
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
    // PLA-0021 / 00459 — points cell is points-only now; Owner moved to
    // its own column and renders via <OwnerChip>. The rollup branch shows
    // just the rolled-up number with the manual value preserved in title.
    return (
      <span title={`Rolled up. Manual: ${row.story_points ?? "—"}`}>
        {row.rollup_points}
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

// PLA-0021 / 00460 (WS4-C) — Click-to-edit due-date cell. Mirrors the
// InlineDateField pattern in WorkItemDetailPanel: display shows the
// "Mon DD" formatted date as a clickable trigger; click swaps to a
// focused <input type="date"> that commits on change/blur. Empty input
// is sent as the empty-string clear-sentinel (server treats "" and null
// identically — see patchWorkItemReq doc-comment in handler.go).
function DueCell({
  row,
  onPatch,
}: {
  row: WorkItem;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        type="date"
        className="form__input form__input--sm"
        defaultValue={row.due_date ?? ""}
        aria-label="Work item due date"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const next = e.target.value;
          setEditing(false);
          // Empty → clear ("" sentinel); same value → no-op; valid → set.
          if (next === (row.due_date ?? "")) return;
          onPatch(row.id, { due_date: next === "" ? null : next });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }
  return (
    <span
      className="inline-edit-trigger"
      title="Click to edit due date"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {formatDueDate(row.due_date)}
    </span>
  );
}

// ─── Column factory ───────────────────────────────────────────────────────────

export function buildWorkItemsColumns(
  flowStates: WorkItemFlowState[],
  patchAndApply: (id: string, body: Record<string, unknown>) => void,
  colourMap?: TypeColourMap,
): ColumnDef<WorkItem>[] {
  return [
    {
      key: "id",
      label: "ID",
      width: 160,
      minWidth: 90,
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
        <SummaryCell row={row} ctx={ctx} onPatch={patchAndApply} colourMap={colourMap} />
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
      label: "Pts",
      width: 70,
      minWidth: 60,
      align: "mono",
      stopClick: true,
      render: (row) => <PointsOwnerCell row={row} onPatch={patchAndApply} />,
    },
    {
      // PLA-0021 / 00459 — Owner now has its own column backed by the
      // joined `owner` payload (display_name + future avatar_url). The
      // legacy synthetic ownerGlyph() is gone; the column renders the
      // shared <OwnerChip> primitive against row.owner.
      key: "owner",
      label: "Owner",
      width: 130,
      minWidth: 100,
      cellModifier: "owner",
      render: (row) => <OwnerChip user={row.owner ?? null} />,
    },
    {
      key: "sprint",
      label: "Sprint",
      width: 95,
      minWidth: 95,
      align: "mono",
      cellModifier: "sprint",
      render: (row) => <>{row.sprint?.alias ?? "—"}</>,
    },
    {
      // PLA-0021 / 00460 (WS4-C) — Due is now an inline date editor backed
      // by the real due_date column. stopClick prevents the row-select
      // click from firing when the user clicks the date trigger or input.
      key: "due",
      label: "Due",
      width: 100,
      minWidth: 80,
      align: "mono",
      cellModifier: "due",
      stopClick: true,
      render: (row) => <DueCell row={row} onPatch={patchAndApply} />,
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

// Multi-value chips (NavigationPie): URL stores comma-joined lists per param.
// `?type=epic,story` → ["epic","story"]. Backend currently only honours the
// first value (see TD-FILTER-MULTI) — see filterQuery() in
// useArtefactItemsWindow for the single-value cap until the artefactitems
// handler learns `?item_type=a,b`.
export interface WorkItemsFilters {
  type: string[];
  status: string[];
  priority: string[];
  owner_id: string[];
}

export const EMPTY_FILTERS: WorkItemsFilters = {
  type: [],
  status: [],
  priority: [],
  owner_id: [],
};

function readMulti(search: URLSearchParams, key: string): string[] {
  const raw = search.get(key);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

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
      type: readMulti(search, "type"),
      status: readMulti(search, "status"),
      priority: readMulti(search, "priority"),
      owner_id: readMulti(search, "owner_id"),
    }),
    [search],
  );

  const hasAny =
    filters.type.length > 0 ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.owner_id.length > 0;

  const setFilter = useCallback(
    <K extends keyof WorkItemsFilters>(key: K, value: WorkItemsFilters[K]) => {
      const next = new URLSearchParams(search.toString());
      const list = (value as unknown as string[]) ?? [];
      if (list.length === 0) next.delete(key);
      else next.set(key, list.join(","));
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

// PLA-0054 / story 00590 — Type options come from the per-workspace
// catalogue (useChipTypeOptions), so chip values are artefact_type
// UUIDs and survive gadmin display-name renames. The hardcoded
// TYPE_CHIP_OPTIONS / STATUS_CHIP_OPTIONS arrays were deleted as
// part of this story.
//
// Status chip is still on the legacy 4-state vocabulary until story
// 00591 lands useStatusChipOptions (context-aware: 6 kind primitives
// fallback / per-type flow_states when one Type is selected). The
// transitional STATUS_CHIP_OPTIONS below carries the kind primitives
// directly so the chip's `selected[]` round-trips against the new
// `?flow_state_id=<uuid>[,<uuid>]` backend param without breaking;
// the kind values are deliberately wrapped at the request layer.
//
// Priority stays a project-locked text enum (multi-value).
const STATUS_CHIP_OPTIONS_TRANSITIONAL: { value: string; label: string }[] = [];

const PRIORITY_CHIP_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

// Controlled filter chips. State lives in URL via useWorkItemsFilters().
// Type / Status / Priority are multi-select NavigationPie chips; Owner
// remains a single-toggle "Mine" chip until the user-picker story lands.
export function WorkItemsFilterChips() {
  const { user } = useAuth();
  const { filters, hasAny, setFilter, clearAll } = useWorkItemsFilters();
  const meId = user?.id ?? null;
  const ownerIsMe = filters.owner_id.length > 0 && filters.owner_id[0] === meId;

  // PLA-0054 / story 00590 — Type options sourced from the workspace
  // catalogue. Values are artefact_type UUIDs.
  const typeOptions = useChipTypeOptions("work");

  return (
    <>
      <NavigationPie
        label="Type"
        icon={<MdTune size={14} />}
        options={typeOptions}
        selected={filters.type}
        onChange={(v) => setFilter("type", v)}
      />
      <NavigationPie
        label="Status"
        icon={<MdOutlineCheckBox size={14} />}
        options={STATUS_CHIP_OPTIONS_TRANSITIONAL}
        selected={filters.status}
        onChange={(v) => setFilter("status", v)}
      />
      <NavigationPie
        label="Priority"
        icon={<MdFlag size={14} />}
        options={PRIORITY_CHIP_OPTIONS}
        selected={filters.priority}
        onChange={(v) => setFilter("priority", v)}
      />
      <button
        type="button"
        className={
          "navigation-pie__Chip" +
          (ownerIsMe ? " navigation-pie__Chip-active" : "")
        }
        onClick={() => setFilter("owner_id", ownerIsMe ? [] : (meId ? [meId] : []))}
        disabled={!meId}
        aria-pressed={ownerIsMe}
      >
        <span className="navigation-pie__Chip_icon">
          <MdOutlinePerson size={14} />
        </span>
        <span className="navigation-pie__Chip_label">
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

// Fetches a window of root artefact items + supplies optimistic PATCH and lazy
// child loading. "View all" issues a first chunk to learn total, then fetches
// remaining chunks in parallel — children stay lazy.
//
// Filters: each non-null entry is appended to the request query. The backend
// `?status=` param is the legacy enum during the flow_state migration window.
// The chip-level `type` field maps to the server param `item_type`.
//
// resourceUrl is the apiSite path prefix (e.g. "/work-items" or
// "/portfolio-items"). Both endpoints are served by the same scope-parameterised
// artefactitems handler — see backend/internal/artefactitems (PLA-0037, B21).
export interface UseArtefactItemsWindowOptions {
  resourceUrl: string;
  pageSize: number | "all";
  pageIndex: number;
  sortKey: SortKey | null;
  sortDir: SortDir;
  filters: WorkItemsFilters;
  onPatched?: (body: Record<string, unknown>) => void;
}

export function useArtefactItemsWindow(
  opts: UseArtefactItemsWindowOptions,
): UseWorkItemsWindowResult {
  const { resourceUrl, pageSize, pageIndex, sortKey, sortDir, filters, onPatched } = opts;
  const [windowRoots, setWindowRoots] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingWindow, setLoadingWindow] = useState(false);

  const filterQuery = useMemo(() => {
    // PLA-0054 / story 00585+00586+00587: multi-value UUID params.
    //   ?item_type_id=<uuid>[,<uuid>] → backend ANY($N::uuid[])
    //   ?flow_state_id=<uuid>[,<uuid>] → backend ANY($N::uuid[])
    //   ?priority=<text>[,<text>]     → backend ANY($N::text[])
    //   ?owner_id=<uuid>[,<uuid>]     → backend ANY($N::uuid[])
    // TD-FILTER-MULTI is paid down here: multi-select chips now round-
    // trip the full selection (no .[0] cap).
    const parts: string[] = [];
    if (filters.type.length)     parts.push(`item_type_id=${filters.type.map(encodeURIComponent).join(",")}`);
    if (filters.status.length)   parts.push(`flow_state_id=${filters.status.map(encodeURIComponent).join(",")}`);
    if (filters.priority.length) parts.push(`priority=${filters.priority.map(encodeURIComponent).join(",")}`);
    if (filters.owner_id.length) parts.push(`owner_id=${filters.owner_id.map(encodeURIComponent).join(",")}`);
    return parts.length ? `&${parts.join("&")}` : "";
  }, [filters.type, filters.status, filters.priority, filters.owner_id]);

  // Use `&` to append pagination/sort/filter if resourceUrl already carries a
  // querystring (e.g. "/work-items?item_type=risk" from p_wizard_risks.json),
  // otherwise start a fresh one with `?`. Without this the page collapses to
  // 0 rows because the backend sees `item_type=risk?limit=25`.
  const sep = resourceUrl.includes("?") ? "&" : "?";

  const refetchWindow = useCallback(async () => {
    setLoadingWindow(true);
    // Backend ORDER BY whitelist (00452) covers every SortKey value, so any
    // non-null key threads through to the server. Default (null) keeps the
    // canonical position-then-key order.
    const sortQuery = sortKey ? `&sort=${sortKey}&dir=${sortDir}` : "";
    try {
      if (pageSize === "all") {
        const CHUNK = 1000;
        const first = await apiSite<{ items: WorkItem[]; total: number }>(
          `${resourceUrl}${sep}limit=${CHUNK}&offset=0${sortQuery}${filterQuery}`,
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
            apiSite<{ items: WorkItem[]; total: number }>(
              `${resourceUrl}${sep}limit=${CHUNK}&offset=${o}${sortQuery}${filterQuery}`,
            ),
          ),
        );
        setWindowRoots([...first.items, ...rest.flatMap((r) => r.items)]);
        setTotal(totalRoots);
        return;
      }
      const offset = pageIndex * pageSize;
      const res = await apiSite<{ items: WorkItem[]; total: number }>(
        `${resourceUrl}${sep}limit=${pageSize}&offset=${offset}${sortQuery}${filterQuery}`,
      );
      setWindowRoots(res.items);
      setTotal(res.total ?? res.items.length);
    } finally {
      setLoadingWindow(false);
    }
  }, [resourceUrl, sep, pageSize, pageIndex, sortKey, sortDir, filterQuery]);

  useEffect(() => { void refetchWindow(); }, [refetchWindow]);

  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      setWindowRoots((prev) =>
        prev.map((r) => (r.id === id ? ({ ...r, ...body } as WorkItem) : r)),
      );
      apiSite<WorkItem>(`${resourceUrl}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
        .then(() => {
          onPatched?.(body);
          if ("story_points" in body) void refetchWindow();
        })
        .catch(() => { /* swallow — refetch on next push */ });
    },
    [resourceUrl, onPatched, refetchWindow],
  );

  const fetchChildren = useCallback(async (parentId: string) => {
    const res = await apiSite<{ items: WorkItem[] }>(
      `${resourceUrl}/${parentId}/children`,
    );
    return res.items;
  }, [resourceUrl]);

  return { windowRoots, total, loadingWindow, refetchWindow, patchAndApply, fetchChildren };
}

// useWorkItemsWindow — back-compat shim for existing call-sites that haven't
// adopted the sidecar-driven resourceUrl yet. Defaults to "/work-items".
// New call-sites should use useArtefactItemsWindow directly with an explicit
// resourceUrl from the wizard JSON.
export function useWorkItemsWindow(
  pageSize: number | "all",
  pageIndex: number,
  sortKey: SortKey | null,
  sortDir: SortDir,
  filters: WorkItemsFilters,
  onPatched?: (body: Record<string, unknown>) => void,
): UseWorkItemsWindowResult {
  return useArtefactItemsWindow({
    resourceUrl: "/work-items",
    pageSize,
    pageIndex,
    sortKey,
    sortDir,
    filters,
    onPatched,
  });
}
