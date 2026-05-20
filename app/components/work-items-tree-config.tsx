"use client";

// hook-allow-url-query: useWorkItemsFilters + useWorkItemsSort write shareable
// view state (?type=, ?status=, ?priority=, ?owner=, ?sort=) to the address bar
// per TD-URL-SHAREABLE-VIEWS. Allowed params are declared in app/lib/shareableParams.ts.

// Work-items-specific configuration for the generic <ResourceTree>.
// Owns the column defs, cell renderers, sort comparators, presentation helpers
// (sprint alias, owner glyph, due-date placeholder), the filter-chips slot,
// the panel header, and the /api/work-items I/O hook. The wrapper in
// WorkItemsTree.tsx wires these into ResourceTree props.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MdTune, MdOutlineCheckBox, MdOutlinePerson, MdFlag } from "react-icons/md";
import { apiSite, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { useUserPreference } from "@/app/hooks/useUserPreference";
import { useAuth } from "@/app/contexts/AuthContext";
import { useScope } from "@/app/contexts/ScopeContext";
import { safeInk, type TypeColourMap } from "@/app/lib/colourUtils";
import { artefactTypesApi } from "@/app/lib/artefactTypesApi";
import InlineEditField from "@/app/components/InlineEditField";
import { InlineSelect } from "@/app/components/InlineSelect";
import { FlowStatePillRow } from "@/app/components/FlowStatePillRow";
import OwnerChip from "@/app/components/OwnerChip";
import NavigationPie from "@/app/components/NavigationPie";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import { usePriorityChipOptions } from "@/app/hooks/usePriorityChipOptions";
import { usePriorityList } from "@/app/hooks/usePriorityList";
import type { WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";
import {
  PrimaryCellTreeLines,
  PrimaryCellExpander,
  type ColumnDef,
  type RenderCtx,
} from "@/app/components/ResourceTree";
import { parseShareableParams, buildShareableHref } from "@/app/lib/shareableParams";

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
  // UUID of artefacts.artefact_type_id. Used by StatusCell to pick the
  // correct per-type flow-state list out of the bulk-by-type cache.
  artefact_type_id: string;
  title: string;
  status: string;
  flow_state_id: string;
  flow_state_name: string;
  flow_state_code: string;
  // PLA-0055 / story 00595+00597 — priority is a UUID FK on the wire
  // with a joined display ref. priority_id is always non-empty
  // (NOT NULL post-migration); priority carries name/slot/sort_order
  // for renderers. The legacy `priority: string | null` slug field
  // is removed from the wire.
  priority_id: string;
  priority: { id: string; name: string; slot: string | null; sort_order: number } | null;
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

// PLA-0055 / story 00595+00597 — short-code + modifier keyed by slot
// (project-locked), not display name. A gadmin rename of "Critical" to
// anything keeps the same P0 pill colour because the slot doesn't move.
// Custom tenant priorities (slot=null) fall through to the default p3
// modifier with a 2-letter code derived from the name.
const PRIORITY_CODE_BY_SLOT: Record<string, { code: string; mod: string }> = {
  pri_critical: { code: "P0", mod: "p0" },
  pri_high:     { code: "P1", mod: "p1" },
  pri_medium:   { code: "P2", mod: "p2" },
  pri_low:      { code: "P3", mod: "p3" },
};

export function canHaveManualPoints(itemType: string): boolean {
  return itemType !== "task";
}

export function formatPriority(
  pri: { name: string; slot: string | null } | null,
): { code: string; mod: string } | null {
  if (!pri) return null;
  if (pri.slot && PRIORITY_CODE_BY_SLOT[pri.slot]) {
    return PRIORITY_CODE_BY_SLOT[pri.slot];
  }
  // Custom priority: render a 2-letter code from the name, neutral mod.
  return { code: pri.name.toUpperCase().slice(0, 2), mod: "p3" };
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
      // PLA-0055 / story 00595 — sort by the joined catalogue
      // sort_order. Rows with no priority ref (shouldn't happen post-
      // migration but defensive) sort last. New tenant priorities
      // slot in naturally without any code change.
      case "priority": cmp = (a.priority?.sort_order ?? 99) - (b.priority?.sort_order ?? 99); break;
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

function IdCell({
  row,
  ctx,
  onOpenForm,
}: {
  row: WorkItem;
  ctx: RenderCtx<WorkItem>;
  onOpenForm?: (artefactId: string) => void;
}) {
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
      <button
        type="button"
        className="tree_accordion-dense__id-text tree_accordion-dense__id-text--link"
        onClick={(e) => {
          e.stopPropagation();
          onOpenForm?.(row.id);
        }}
        aria-label={`Edit ${idText}`}
      >
        {idText}
      </button>
    </span>
  );
}

function SummaryCell({
  row,
  ctx,
  onPatch,
  colourMap,
  onTypeBadgeClick,
}: {
  row: WorkItem;
  ctx: RenderCtx<WorkItem>;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  colourMap?: TypeColourMap;
  onTypeBadgeClick?: (artefactId: string) => void;
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
      <button
        type="button"
        className={
          "tree_accordion-dense__type-badge " +
          (colourEntry ? "" : (TYPE_VARIANT[row.item_type] ?? ""))
        }
        style={colourEntry ? { background: colourEntry.colour, color: safeInk(colourEntry.colour) } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onTypeBadgeClick?.(row.id);
        }}
        aria-label={`Edit ${row.type_prefix}-${row.key_num}`}
      >
        {row.type_prefix || row.item_type.slice(0, 2).toUpperCase()}
      </button>
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
  flowStatesByType,
  onPatch,
}: {
  row: WorkItem;
  flowStates: WorkItemFlowState[];
  flowStatesByType?: Map<string, WorkItemFlowState[]>;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  // Prefer the by-type list when this artefact's type is in the cache;
  // fall back to the subscription-wide list (legacy) when the bulk
  // fetch hasn't resolved yet or this row's type missed the cache.
  const states =
    (row.artefact_type_id && flowStatesByType?.get(row.artefact_type_id)) ||
    flowStates;
  // Execution-zone rows with live children have a DERIVED flow state —
  // the cascade owns it (work flows up). Lock the pill row so the user
  // can't try to set it manually (backend also rejects with 409 if they
  // bypass; this is the friendly UX gate).
  //
  // EXCEPTION: once the cascade has landed the parent at a TERMINAL
  // state (completed or accepted), the user takes control again — they
  // can move it to accepted (manual gate the cascade never auto-fires)
  // or push it back to an earlier state for further work. Same rule on
  // the backend (PatchWorkItem skips ErrParentFlowStateDerived when the
  // current kind is done/accepted).
  const atTerminal =
    row.flow_state_code === "completed" || row.flow_state_code === "accepted";
  const isDerived = row.children_count > 0 && !atTerminal;
  return (
    <FlowStatePillRow
      currentId={row.flow_state_id}
      currentCode={row.flow_state_code}
      states={states}
      onCommit={(next) => onPatch(row.id, { flow_state_id: next })}
      derived={isDerived}
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
  // PLA-0055 / story 00595+00597 — InlineSelect options come from the
  // workspace catalogue; commit writes the priority_id UUID. Trigger
  // shows the joined display name + slot-based modifier so the pill's
  // colour stays stable across gadmin renames (slot is project-locked).
  const priorities = usePriorityList();
  const pri = formatPriority(row.priority);
  return (
    <InlineSelect
      value={row.priority_id}
      options={priorities.map((p) => ({ value: p.id, label: p.name }))}
      onCommit={(next) => onPatch(row.id, { priority_id: next })}
      ariaLabel="Work item priority"
      placeholder="—"
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
  callbacks?: {
    onTypeBadgeClick?: (artefactId: string) => void;
    flowStatesByType?: Map<string, WorkItemFlowState[]>;
  },
): ColumnDef<WorkItem>[] {
  return [
    {
      key: "id",
      label: "ID",
      width: 160,
      minWidth: 90,
      align: "mono",
      cellModifier: "id",
      stopClick: true,
      render: (row, ctx) => (
        <IdCell row={row} ctx={ctx} onOpenForm={callbacks?.onTypeBadgeClick} />
      ),
    },
    {
      key: "title",
      label: "Summary",
      width: null,
      minWidth: 200,
      cellModifier: "summary",
      stopClick: true,
      render: (row, ctx) => (
        <SummaryCell
          row={row}
          ctx={ctx}
          onPatch={patchAndApply}
          colourMap={colourMap}
          onTypeBadgeClick={callbacks?.onTypeBadgeClick}
        />
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 220,
      minWidth: 180,
      stopClick: true,
      render: (row) => (
        <StatusCell
          row={row}
          flowStates={flowStates}
          flowStatesByType={callbacks?.flowStatesByType}
          onPatch={patchAndApply}
        />
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

// ─── Per-user prefs backing (replaces URL state — TD-URL-FILTER-CHIPS) ───────
//
// State lives in users.preferences (mig 208) keyed by namespace e.g.
// "workitems.filters" / "portfolioitems.sort". Plumbing lives in
// [app/hooks/useUserPreference.ts] — see that file for the seed-once
// pattern and why this approach replaces address-bar query state.

// State lives in users.preferences. Each filter dimension is a separate
// key in the persisted object so future filters can be added without
// invalidating existing preferences. Read-side defaults to EMPTY_FILTERS
// (no chip selected) when the user has no stored value.
//
// `prefKey` is the namespace under /_site/me/preferences/{key}. Each
// page passes its own (`workitems.filters` vs `portfolioitems.filters`)
// so cross-page filter state doesn't bleed.
export function useWorkItemsFilters(
  prefKey: string,
  // Paired sort state — needed to preserve ?sort= when writing filter params.
  sortRef?: React.RefObject<{ key: SortKey | null; dir: SortDir }>,
): {
  filters: WorkItemsFilters;
  hasAny: boolean;
  setFilter: <K extends keyof WorkItemsFilters>(key: K, value: WorkItemsFilters[K]) => void;
  clearAll: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const { value: prefFilters, setValue, seeded } = useUserPreference<WorkItemsFilters>(
    prefKey,
    EMPTY_FILTERS,
  );

  // On first seed, check whether the URL carries shareable filter params.
  // If so, override the preference value so the shared link wins, then
  // write back to preferences so it persists from this point.
  const urlSeededRef = useRef(false);
  useEffect(() => {
    if (!seeded || urlSeededRef.current) return;
    urlSeededRef.current = true;
    const { filters: urlFilters } = parseShareableParams(window.location.search);
    if (!urlFilters) return;
    const merged: WorkItemsFilters = {
      type:     urlFilters.type     ?? prefFilters.type,
      status:   urlFilters.status   ?? prefFilters.status,
      priority: urlFilters.priority ?? prefFilters.priority,
      owner_id: urlFilters.owner_id ?? prefFilters.owner_id,
    };
    setValue(merged);
  }, [seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve effective filters: after seed, prefer preference value
  // (which may have been overridden by URL seed above).
  const filters = prefFilters;

  const hasAny =
    filters.type.length > 0 ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.owner_id.length > 0;

  const writeUrl = useCallback(
    (next: WorkItemsFilters) => {
      const sort = sortRef?.current ?? { key: null, dir: "asc" as SortDir };
      const href = buildShareableHref(pathname, window.location.search, next, sort);
      router.replace(href, { scroll: false });
    },
    [router, pathname, sortRef],
  );

  const setFilter = useCallback(
    <K extends keyof WorkItemsFilters>(key: K, v: WorkItemsFilters[K]) => {
      const next = { ...filters, [key]: v };
      setValue(next);
      writeUrl(next);
    },
    [filters, setValue, writeUrl],
  );

  const clearAll = useCallback(() => {
    setValue(EMPTY_FILTERS);
    writeUrl(EMPTY_FILTERS);
  }, [setValue, writeUrl]);

  return { filters, hasAny, setFilter, clearAll };
}

// ─── Sort state (per-user pref) ───────────────────────────────────────────────

const SORT_KEYS: ReadonlySet<string> = new Set([
  "id", "title", "status", "priority", "points", "sprint", "due",
]);

interface SortPref {
  key: SortKey | null;
  dir: SortDir;
}

const DEFAULT_SORT: SortPref = { key: null, dir: "asc" };

// Mirrors useWorkItemsFilters but stores a single object { key, dir }.
// `prefKey` namespaces per-page (e.g. "workitems.sort").
// Returns a sortRef the caller can pass into useWorkItemsFilters so URL
// writes from the filter side include the current sort.
export function useWorkItemsSort(
  prefKey: string,
  filtersRef?: React.RefObject<WorkItemsFilters>,
): {
  sortKey: SortKey | null;
  sortDir: SortDir;
  sortRef: React.RefObject<{ key: SortKey | null; dir: SortDir }>;
  setSort: (key: SortKey | null, dir: SortDir) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const { value, setValue, seeded } = useUserPreference<SortPref>(prefKey, DEFAULT_SORT);

  // Defensive: unknown sort key collapses to default.
  const sortKey: SortKey | null =
    value.key && SORT_KEYS.has(value.key) ? value.key : null;
  const sortDir: SortDir = value.dir === "desc" ? "desc" : "asc";

  // Ref so filter-side URL writes can read current sort without circular deps.
  const sortRef = useRef<{ key: SortKey | null; dir: SortDir }>({ key: sortKey, dir: sortDir });
  useEffect(() => { sortRef.current = { key: sortKey, dir: sortDir }; }, [sortKey, sortDir]);

  // On first seed, check for ?sort= in URL.
  const urlSeededRef = useRef(false);
  useEffect(() => {
    if (!seeded || urlSeededRef.current) return;
    urlSeededRef.current = true;
    const { sort: urlSort } = parseShareableParams(window.location.search);
    if (!urlSort) return;
    setValue({ key: urlSort.key, dir: urlSort.dir });
  }, [seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSort = useCallback(
    (key: SortKey | null, dir: SortDir) => {
      setValue({ key, dir });
      const filters = filtersRef?.current ?? EMPTY_FILTERS;
      const href = buildShareableHref(pathname, window.location.search, filters, { key, dir });
      router.replace(href, { scroll: false });
    },
    [setValue, router, pathname, filtersRef],
  );

  return { sortKey, sortDir, sortRef, setSort };
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
// PLA-0055 / story 00599 — Priority chip options come from
// usePriorityChipOptions (per-workspace artefact_priorities catalogue).
// Hardcoded PRIORITY_CHIP_OPTIONS was deleted as part of this story;
// tenant-added custom priorities now appear in the chip with no code
// change.
const STATUS_CHIP_OPTIONS_TRANSITIONAL: { value: string; label: string }[] = [];

// Controlled filter chips. State lives in users.preferences (mig 208)
// keyed by `prefKey` — see useWorkItemsFilters / TD-URL-FILTER-CHIPS.
// Type / Status / Priority are multi-select NavigationPie chips; Owner
// remains a single-toggle "Mine" chip until the user-picker story lands.
export function WorkItemsFilterChips({ prefKey }: { prefKey: string }) {
  const { user } = useAuth();
  const { filters, hasAny, setFilter, clearAll } = useWorkItemsFilters(prefKey);
  const meId = user?.id ?? null;
  const ownerIsMe = filters.owner_id.length > 0 && filters.owner_id[0] === meId;

  // PLA-0054 / story 00590 — Type options sourced from the workspace
  // catalogue. Values are artefact_type UUIDs.
  const typeOptions = useChipTypeOptions("work");
  // PLA-0055 / story 00599 — Priority options sourced from the
  // workspace artefact_priorities catalogue. Values are UUIDs.
  const priorityOptions = usePriorityChipOptions();

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
        options={priorityOptions}
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
  // Optional callback fired right after the optimistic local update in
  // patchAndApply. Hosts use this to forward the same patch into
  // ResourceTree's childMap (windowRoots-only optimism leaves
  // expanded-child rows visually stale on inline pill clicks).
  onLocalPatch?: (id: string, body: Record<string, unknown>) => void;
  // Optional callback fired AFTER a successful PATCH that may have
  // triggered the flow-state cascade. Hosts use this to re-pull every
  // expanded sub-tree so cascade-updated ancestor rows (Story, Epic)
  // repaint without the user having to collapse + re-expand.
  onCascadeRefresh?: () => void;
}

export function useArtefactItemsWindow(
  opts: UseArtefactItemsWindowOptions,
): UseWorkItemsWindowResult {
  const { resourceUrl, pageSize, pageIndex, sortKey, sortDir, filters, onPatched, onLocalPatch, onCascadeRefresh } = opts;
  // Active topology scope clamps every read in this hook. The actual
  // ?meg= param is appended by withForwardedMeg (api.ts), but the
  // refetch loop needs activeNodeId in its dep list so a scope-picker
  // flip re-fires the fetch with the new clamp — without this dep the
  // ObjectTree below the scope picker shows stale rows for the previous
  // scope (TD-URL-SCOPE-PARAM-CUTOVER).
  const { activeNodeId, direction } = useScope();
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
    if (filters.priority.length) parts.push(`priority_id=${filters.priority.map(encodeURIComponent).join(",")}`);
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
  }, [resourceUrl, sep, pageSize, pageIndex, sortKey, sortDir, filterQuery, activeNodeId, direction]);

  useEffect(() => { void refetchWindow(); }, [refetchWindow]);

  const patchAndApply = useCallback(
    (id: string, body: Record<string, unknown>) => {
      setWindowRoots((prev) =>
        prev.map((r) => (r.id === id ? ({ ...r, ...body } as WorkItem) : r)),
      );
      // Mirror the optimistic patch into child rows too. ResourceTree
      // keeps expanded children in its own state; without this hook the
      // host can't see/update them.
      onLocalPatch?.(id, body);
      apiSite<WorkItem>(`${resourceUrl}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
        .then(() => {
          onPatched?.(body);
          // After a flow_state_id change, the cascade may have mutated
          // ancestor rows (Task → Story → Epic). Roots may be stale —
          // refetch so the visible parent pills reflect the cascade.
          // ALSO ping the host so it can re-pull every expanded sub-tree
          // — the bare refetchWindow() only repaints root rows, but
          // cascade-touched ancestors may be CHILD rows under whatever
          // root is expanded.
          if ("flow_state_id" in body || "story_points" in body) {
            void refetchWindow();
            onCascadeRefresh?.();
          }
        })
        .catch((err: unknown) => {
          // 409 parent_flow_state_derived — the cascade rejected a
          // manual flow_state_id write because the row has live
          // children. The frontend pill row is supposed to be locked
          // for these rows; this catch is defence-in-depth in case the
          // UI ever misses the gate. Toast a friendly explanation AND
          // refetch so the optimistic local update reverts.
          if (
            err instanceof ApiError &&
            err.status === 409 &&
            typeof err.body === "object" &&
            err.body !== null &&
            (err.body as { error?: string }).error === "parent_flow_state_derived"
          ) {
            notify.hint(
              "This artefact's state is set by its children — move a child to change this row.",
            );
            void refetchWindow();
            return;
          }
          // Other errors stay silent — same behaviour as before so
          // unrelated patch failures don't gain a regression here.
        });
    },
    [resourceUrl, onPatched, refetchWindow, onLocalPatch, onCascadeRefresh],
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
