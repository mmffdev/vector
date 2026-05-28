"use client";

// ObjectTree — generic dumb primitive over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// a config object. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every data-type concern lives in the config.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  workItems as workItemsApi,
  portfolioItems as portfolioItemsApi,
  sprints,
  releases,
  milestones,
  lookups,
  workItems as workItemsLookup,
  type Timebox,
  type Milestone,
  type UserInScope,
} from "@/app/lib/apiSite";
import { apiSite } from "@/app/lib/api";
import { useSentinel } from "@/app/sentinel";
import { useScopedTopologyNodes } from "@/app/components/topology/useScopedTopologyNodes";
import { useParentCandidates } from "@/app/components/ArtefactInlineForm/useParentCandidates";
import { ColourPicker } from "@/app/components/ColourPicker";
import { RichTextField } from "@/app/components/RichTextField";
import type { JSONContent } from "@tiptap/react";
import { useFieldsForType } from "@/app/components/ObjectTreeV2/hooks/useFieldsForType";
import {
  CreateCustomFields,
  customFieldsToWire,
  type CustomFieldValues,
} from "@/app/components/ObjectTreeV2/sheets/CreateCustomFields";

// Walks a TipTap JSON doc and concatenates every text node into a single
// plain string. Used to extract a description plaintext from the create
// flyout's RichTextField output so the legacy `description` TEXT column
// (which the create POST handler reads) carries the user's words even
// though the rich JSON ships separately via a follow-up PATCH into the
// `description_doc` JSONB column.
function docToPlainText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  const parts: string[] = [];
  for (const child of node.content ?? []) {
    parts.push(docToPlainText(child));
  }
  // Insert newlines between top-level block children so paragraphs survive
  // the round-trip when the user views the plaintext fallback.
  return parts.join(node.type === "doc" ? "\n" : "");
}
import ArtefactInlineForm from "@/app/components/ArtefactInlineForm";
// Slice 4 — PARENT_PREFIX_MAP no longer imported here. The reparent
// legality rule moves into a per-domain rules module so V2's shell
// doesn't know about artefact type prefixes. Only the ArtefactDetail
// type stays — used by the duplicate/delete handlers which are still
// work-items-shaped at this slice (carved later, alongside the flyout
// adapter generalisation).
import { type ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
import {
  workItemsCanReparent,
  workItemsGetCandidateIds,
} from "@/app/components/ObjectTreeV2/configs/workItemsReparentRules";
import BulkActionBar from "@/app/components/BulkActionBar";
import Panel from "@/app/components/Panel";
import { ResourceTree } from "@/app/components/ResourceTree";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import { useFlowStatesByType } from "@/app/components/useFlowStatesByType";
import {
  buildWorkItemsColumns,
  // Slice 1 of the refactor — V2 no longer consumes useArtefactItemsWindow.
  // The generic useObjectTreeWindow<T> hook below replaces it; the work-items-
  // specific filter shape and cascade-trigger list are layered here at the
  // call site instead of being baked into the data hook.
  // useArtefactItemsWindow,
  useArtefactTypeColours,
  useWorkItemsFilters,
  useWorkItemsSort,
  WorkItemsFilterChips,
  type SortKey,
  type WorkItem,
} from "@/app/components/work-items-tree-config";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { useArtefactPriorityCatalogue } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import type { ColumnDef } from "@/app/components/ResourceTree";
// Slice 3 — icons moved into the kind components (DenseGridHeader doesn't
// need any; ActionBar imports MdAdd / MdOutlineCategory / MdSearch itself).
import { useObjectTreeWindow, ApiError as ObjectTreeApiError } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeWindow";
import { useObjectTreeFacets } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeFacets";
import { ObjectTreeDetailFlyout, type DetailFlyoutBodyProps } from "@/app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout";
import { DenseGridHeader } from "@/app/components/ObjectTreeV2/kinds/DenseGridHeader";
import { ActionBar } from "@/app/components/ObjectTreeV2/kinds/ActionBar";
import {
  ColumnPicker,
  useColumnPickerState,
  type ColumnCatalogue,
} from "@/app/components/ObjectTreeV2/plugins/ColumnPicker";
import { notify } from "@/app/lib/toast";

// Slice 1 of the ObjectTree refactor — work-items-specific cascade triggers.
// When a PATCH body contains any of these keys, the data hook refetches the
// window AND fires onCascadeRefresh so consumers can refresh expanded sub-
// trees. Was previously hardcoded inside useArtefactItemsWindow; now lives
// at the V2 call site so other domains (sprints, releases) can pass [] or
// their own list.
const WORK_ITEMS_CASCADE_FIELDS = ["flow_state_id", "story_points", "parent_artefact_id"];

export type { WorkItem };

// ObjectTree configuration interface — tells ObjectTree how to fetch, render,
// and interact with a specific data type. Built inline based on `mode` for now;
// when we have multiple data types, this comes from the registry.
export interface ObjectTreeDataConfig<T = any> {
  // UI labels and messaging
  label: string; // e.g. "Work items", "Portfolio items"
  searchPlaceholder: string; // e.g. "Search work items…"
  ariaLabel: string; // e.g. "Work items dense grid"
  treeName: string; // e.g. "workitems", "portfolioitems" (for addressing)

  // Columns and rendering
  columns: ColumnDef<T>[];

  // Drag-and-drop configuration
  dndResourceType: string; // e.g. "work_item", "portfolio_item"
  dndEnabled: boolean;

  // Sorting configuration
  defaultSortKey: string | null;
  defaultSortDir: "asc" | "desc";

  // Hierarchy accessors
  getParentId: (row: T) => string | null;
  getChildrenCount: (row: T) => number;

  // Search accessor
  searchAccessor: (row: T) => string;

  // Optional UI elements
  filterChips?: React.ReactNode;

  // Pagination configuration
  paginationOptions: number[];
  defaultPageSize: number;

  // Backend wiring (PLA-0037 / B21) — apiSite path prefix for the artefact
  // resource ("/work-items" or "/portfolio-items"). When omitted, derived
  // from `mode` for back-compat. Supplied by p_wizard_*.json sidecars.
  resourceUrl?: string;
  // Scope hint sourced from p_wizard_*.json. Drives the artefact-type
  // catalogue lookup for the create-action picker (work vs strategy).
  // When omitted, V2 falls back to "work".
  scope?: "work" | "strategy";
  // Per-grid create-action allow-list (post slot→UUID resolution by
  // resolveSlotRefs from `createableTypeSlots`). When set, narrows the
  // create-action picker to just these types; one entry collapses the
  // picker to a single labelled button (e.g. /risk renders "Risk").
  // Omit to keep the legacy "show all scoped types" behaviour (used by
  // the /scope harness, which intentionally exposes the full catalogue).
  createableTypeIds?: string[];
}

export default function ObjectTree({
  selectedId,
  onSelect,
  onPatched,
  mode = "work_items",
  wizardConfig,
  title,
  addressableName,
  subtitleBadge,
  subtitle,
  description,
  columnCatalogue,
  multiSelectEnabled = false,
  onSelectionChange,
}: {
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: (body: Record<string, unknown>) => void;
  mode?: "work_items" | "portfolio_items";
  wizardConfig?: ObjectTreeDataConfig<WorkItem>;
  // Chrome props. ObjectTree renders its own outer <Panel> + sunken header;
  // pages no longer wrap with <Panel>. `title` + `addressableName` are
  // required for the new chrome; `subtitleBadge` / `subtitle` / `description`
  // fill the sunken header band below the title.
  title?: string;
  addressableName?: string;
  subtitleBadge?: React.ReactNode;
  // Slice 4.5 — column-picker catalogue. When supplied, V2 mounts the
  // <ColumnPicker> in the action bar, owns visibleKeys state, persists
  // to localStorage, filters config.columns before passing to
  // ResourceTree, AND forwards visible wireKeys to useObjectTreeWindow's
  // `fields` opt (Slice 2.5 backend ?fields= contract). Omit to disable.
  columnCatalogue?: ColumnCatalogue;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  // Slice 3 / value-sprint — opt-in multi-select column. When false
  // (default), the leading checkbox column is not rendered AND
  // BulkActionBar stays hidden. When true, ResourceTree mounts its
  // existing SelectionConfig, BulkActionBar shows on >0 selection, and
  // selected ids are mirrored to the parent via onSelectionChange so
  // callers can drive bulk actions (e.g. "Add selected to Sprint").
  // Back-compat: every existing caller (Work Items, Portfolio, Risks)
  // omits the prop and gets identical chrome to before.
  multiSelectEnabled?: boolean;
  onSelectionChange?: (selectedIds: Set<string>) => void;
}) {
  // For now, build config based on mode. Once we have multiple data types,
  // this could accept a config prop or look it up from the registry.
  const flowStates = useWorkItemFlowStates();
  const colourMap = useArtefactTypeColours();
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [pageIndex, setPageIndex] = useState(0);

  // Per-user filter/sort preferences are namespaced by treeName so
  // /work-items and /portfolio-items don't bleed across pages
  // (TD-URL-FILTER-CHIPS pay-down). Default keys when consumer hasn't
  // passed treeName: fall back to mode for back-compat.
  const treeName = wizardConfig?.treeName ?? (mode === "portfolio_items" ? "portfolioitems" : "workitems");
  const filtersPrefKey = `${treeName}.filters`;
  const sortPrefKey = `${treeName}.sort`;

  // sortRef and filtersRef cross-wire the two hooks so URL writes from
  // either side carry both dimensions (TD-URL-SHAREABLE-VIEWS).
  const filtersRef = useRef<import("@/app/components/work-items-tree-config").WorkItemsFilters>(
    { type: [], status: [], priority: [], owner_id: [] }
  );
  const { sortKey, sortDir, sortRef, setSort } = useWorkItemsSort(sortPrefKey, filtersRef);
  const { filters } = useWorkItemsFilters(filtersPrefKey, sortRef);
  // Keep filtersRef current so sort-side URL writes reflect latest filters.
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // PLA-0021 / 00456 — multi-select state lives here; the tree consumes
  // it via the SelectionConfig prop set, and BulkActionBar reads it to
  // decide whether to render itself.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  // Slice 3 / value-sprint — mirror local selection up to the parent
  // when multiSelectEnabled is set, so the page can render bulk-action
  // chrome of its own (e.g. "Add selected to Sprint"). We pipe the
  // existing local state through unchanged — the parent sees the same
  // Set reference the tree owns, on every change.
  useEffect(() => {
    if (multiSelectEnabled && onSelectionChange) {
      onSelectionChange(selectedIds);
    }
  }, [selectedIds, multiSelectEnabled, onSelectionChange]);

  // Active topology scope. Used by duplicateArtefact to pin the clone
  // when the source artefact had no topology_node_id of its own
  // (apiSite() only auto-forwards ?meg= on GETs, not POSTs).
  const { sentinel_focus_node: activeScopeNodeId, sentinel_user } = useSentinel();

  // Slice 4.5 — column-picker state. Hook MUST be called every render
  // (rules of hooks); we feed it an empty-catalogue sentinel when the
  // caller didn't supply one. Mounting the <ColumnPicker> UI + filtering
  // config.columns then conditional on `columnCatalogue != null`.
  const emptyCatalogue = useMemo<ColumnCatalogue>(
    () => ({ columns: [], prefsKey: "__none__" }),
    [],
  );
  const picker = useColumnPickerState(columnCatalogue ?? emptyCatalogue);
  const visibleWireKeys = columnCatalogue ? picker.visibleWireKeys : null;
  const visibleKeySet = columnCatalogue ? picker.visibleKeySet : null;

  // Action bar — artefact type picker that focuses the "Add new" CTA.
  // Design-only for now (no create wiring); options come from the workspace
  // artefact-type catalogue. Scope is sourced from the sidecar so
  // /portfolio-items pulls strategy types instead of work types;
  // createableTypeIds (if present) further narrows the list to the
  // grid's allow-list (e.g. /risk = just Risk).
  const scopedTypeOptions = useChipTypeOptions(wizardConfig?.scope ?? "work");
  const actionTypeOptions = useMemo(() => {
    const ids = wizardConfig?.createableTypeIds;
    if (!ids?.length) return scopedTypeOptions;
    const allow = new Set(ids);
    return scopedTypeOptions.filter((o) => allow.has(o.value));
  }, [scopedTypeOptions, wizardConfig?.createableTypeIds]);
  const [actionTypeId, setActionTypeId] = useState<string>("");
  const actionTypeLabel = useMemo(() => {
    const found = actionTypeOptions.find((o) => o.value === actionTypeId);
    return found?.label ?? null;
  }, [actionTypeOptions, actionTypeId]);

  // Create flyout — live data sources for the dropdowns. Mirrors the
  // pattern in ArtefactInlineForm (the existing edit form): topology
  // tree, per-type flow states, users-in-scope, sprints/releases/milestones
  // for the active workspace, and parent candidates for the chosen type's
  // prefix. All fetches are tolerant — one failing source doesn't poison
  // the others; the dropdown falls back to "— None —" only.
  const workspaceId = sentinel_user?.workspace_id || null;
  const { types: typeCatalogue } = useArtefactTypeCatalogue();
  const selectedType = useMemo(
    () => typeCatalogue.find((x) => x.id === actionTypeId) ?? null,
    [typeCatalogue, actionTypeId],
  );
  const actionTypePrefix = selectedType?.prefix ?? null;
  // Rule inputs sourced from the type catalogue + the sidecar's scope.
  // - isStrategic: strategic-scope grids (portfolio) skip Sprint / Release /
  //   Plan estimate; those concepts only apply on the execution side.
  // - isTopLevel: top-of-ladder strategic types (Theme, layer_depth=0) have
  //   no allowed parent — hide the Parent field entirely.
  // - isRisk: Risk type doesn't carry sprint or release allocation today.
  const isStrategic = (wizardConfig?.scope ?? "work") === "strategy";
  const isTopLevel = selectedType?.layer_depth === 0;
  const isRisk = selectedType?.slot === "wrk_risk";
  // Field visibility flags derived from the above.
  const showSprint = !isStrategic && !isRisk;
  const showRelease = !isStrategic && !isRisk;
  const showPlanEstimate = !isStrategic;

  // Topology nodes come from useScopedTopologyNodes (backed by
  // sentinel_grants) so a non-gadmin actor only sees nodes they hold
  // a grant on (incl. descend-inheritance). Don't fetch /topology/tree
  // here — that endpoint is the unclamped admin-canvas view and would
  // leak the whole workspace topology.
  const { nodes: createTopologyNodes } = useScopedTopologyNodes();
  const [createFlowStates, setCreateFlowStates] = useState<
    Array<{ id: string; name: string; flow_position?: number }>
  >([]);
  const [createUsers, setCreateUsers] = useState<UserInScope[]>([]);
  const [createSprints, setCreateSprints] = useState<Timebox[]>([]);
  const [createReleases, setCreateReleases] = useState<Timebox[]>([]);
  const [createMilestones, setCreateMilestones] = useState<Milestone[]>([]);

  const {
    strategic: createParentStrategic,
    execution: createParentExecution,
  } = useParentCandidates({
    typePrefix: actionTypePrefix,
    scope: wizardConfig?.scope ?? "work",
    workspaceId,
  });

  // Per-type custom-field schema. The hook fetches whenever actionTypeId
  // flips to a non-empty UUID; bindings come back ordered by display
  // position. Hosts a parallel `customFieldValues` map keyed by
  // field_library_id so the user's entries survive switching focus
  // between native + custom inputs.
  //
  // We compute the route base inline (rather than reuse the in-scope
  // `resourceUrl` const) because that const is declared further down in
  // this component — using it here would be a TDZ reference. Same mode-
  // based fallback as the resourceUrl block below.
  const customFieldsRoute =
    wizardConfig?.resourceUrl ?? (mode === "portfolio_items" ? "/portfolio-items" : "/work-items");
  const { bindings: customFieldBindings } = useFieldsForType(customFieldsRoute, actionTypeId || null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValues>({});
  useEffect(() => {
    // Reset on type change so values from a prior type don't bleed into
    // the next attempt (different bindings, different storage routing).
    setCustomFieldValues({});
  }, [actionTypeId]);

  // Risk-only cross-scope parent candidates. Risk lives in the work scope
  // but its risk-register UX wants a parent picker that spans BOTH
  // execution work items AND strategic portfolio items within the active
  // topology clamp — so a risk can hang off a Theme / BO / Feature OR a
  // Story / Epic / Defect / Task. The two list endpoints both honour
  // ?meg= (forwarded by apiSite on GETs), so the clamp comes for free;
  // we just merge the two responses and group them under headings. Other
  // types use the prefix-restricted useParentCandidates above.
  const [riskParentExec, setRiskParentExec] = useState<
    Array<{ id: string; type_prefix: string; key_num: number; title: string }>
  >([]);
  const [riskParentStrat, setRiskParentStrat] = useState<
    Array<{ id: string; type_prefix: string; key_num: number; title: string }>
  >([]);
  useEffect(() => {
    if (!isRisk || !actionTypeId) return;
    let cancelled = false;
    (async () => {
      try {
        // page_size large enough to cover any realistic workspace clamp;
        // the clamp is what keeps the result set small. apiSite forwards
        // ?meg= from the URL on GETs.
        const qs = "page_size=500";
        const [exec, strat] = await Promise.all([
          apiSite<{ items: unknown[] }>(`/work-items?${qs}`).catch(() => ({ items: [] })),
          apiSite<{ items: unknown[] }>(`/portfolio-items?${qs}`).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        const shape = (rows: unknown[]) =>
          (rows as Array<{ id?: string; type_prefix?: string; key_num?: number; title?: string }>)
            .filter((r) => r && r.id && r.type_prefix && typeof r.key_num === "number")
            .map((r) => ({
              id: r.id!,
              type_prefix: r.type_prefix!,
              key_num: r.key_num!,
              title: r.title ?? "",
            }));
        setRiskParentExec(shape(exec.items ?? []));
        setRiskParentStrat(shape(strat.items ?? []));
      } catch {
        // Falls through to empty — dropdown shows "— None (root) —" only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRisk, actionTypeId]);

  // Fetch the per-type catalogues whenever the user arms a new type.
  // Topology / users / sprints / releases / milestones are workspace-wide
  // so they don't strictly need to refetch on actionTypeId change, but
  // doing so on the first open keeps the data fresh without burning a
  // call on closed state. Flow states ARE per-type so they must refetch.
  useEffect(() => {
    if (!actionTypeId || !workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const [fs, us, sp, rel, ms] = await Promise.all([
          workItemsLookup
            .listFlowStates(`artefact_type_id=${encodeURIComponent(actionTypeId)}`)
            .catch(() => ({ flow_states: [] as unknown[] })),
          lookups.usersInScope().catch(() => ({ users: [] as UserInScope[], count: 0 })),
          sprints.list(`workspace_id=${workspaceId}`).catch(() => ({ items: [] as Timebox[] })),
          releases.list(`workspace_id=${workspaceId}`).catch(() => ({ items: [] as Timebox[] })),
          milestones
            .list(`workspace_id=${workspaceId}`)
            .catch(() => ({ milestones: [] as Milestone[], count: 0 })),
        ]);
        if (cancelled) return;
        setCreateFlowStates(
          ((fs as { flow_states: unknown[] }).flow_states ?? []) as Array<{
            id: string;
            name: string;
            flow_position?: number;
          }>,
        );
        setCreateUsers((us as { users: UserInScope[] }).users ?? []);
        setCreateSprints((sp as { items?: Timebox[] }).items ?? []);
        setCreateReleases((rel as { items?: Timebox[] }).items ?? []);
        setCreateMilestones((ms as { milestones: Milestone[] }).milestones ?? []);
      } catch {
        // Falls through — individual catches above mean any one source
        // failing doesn't poison the others.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionTypeId, workspaceId]);

  // Controlled state for the create form. Reset whenever the user arms
  // a different type (or cancels), so a half-filled form doesn't bleed
  // into the next attempt.
  const [createDraft, setCreateDraft] = useState<{
    title: string;
    description_doc: JSONContent | null;
    parent_id: string;
    topology_node_id: string;
    flow_state_id: string;
    owner_id: string;
    sprint_id: string;
    release_id: string;
    milestone_id: string;
    story_points: string;
    colour: string;
  }>({
    title: "",
    description_doc: null,
    parent_id: "",
    topology_node_id: "",
    flow_state_id: "",
    owner_id: "",
    sprint_id: "",
    release_id: "",
    milestone_id: "",
    story_points: "",
    colour: "",
  });
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Reset draft when the user closes the flyout or switches type.
  // Topology defaults to the active scope node so the new artefact lands
  // on the user's current clamp by default — they can change it before
  // submit. Applies to every type (execution, strategic, risk).
  useEffect(() => {
    setCreateDraft({
      title: "",
      description_doc: null,
      parent_id: "",
      topology_node_id: activeScopeNodeId ?? "",
      flow_state_id: "",
      owner_id: "",
      sprint_id: "",
      release_id: "",
      milestone_id: "",
      story_points: "",
      colour: "",
    });
    setCreateError(null);
  }, [actionTypeId, activeScopeNodeId]);

  // Default flow state to the type's lowest-position state once the
  // per-type catalogue lands. Skipped if the user has already picked one.
  useEffect(() => {
    if (!actionTypeId) return;
    if (createDraft.flow_state_id) return;
    if (createFlowStates.length === 0) return;
    const sorted = [...createFlowStates].sort(
      (a, b) => (a.flow_position ?? 0) - (b.flow_position ?? 0),
    );
    setCreateDraft((d) => ({ ...d, flow_state_id: sorted[0]?.id ?? "" }));
  }, [actionTypeId, createFlowStates, createDraft.flow_state_id]);

  // ArtefactInlineForm — single-open state for the inline edit panel
  // that expands beneath the action bar when the user clicks a row's
  // coloured type badge. Mutually exclusive with the create flyout
  // (one effect below force-closes the inline form whenever the
  // create flyout opens).
  const [openInlineFormId, setOpenInlineFormId] = useState<string | null>(null);
  // Set whenever a Duplicate action just inserted this id. Cleared as
  // soon as the user navigates to a different artefact or closes the
  // form. The form reads this to flip its title-head to amber so the
  // user can see they're editing a clone, not the original.
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  const openInlineForm = useCallback((id: string) => {
    setActionTypeId("");
    setOpenInlineFormId((cur) => {
      const next = cur === id ? null : id;
      // Navigating away from (or closing) a duplicate clears the flag —
      // amber only applies to the row that came back from the Duplicate
      // call this session.
      if (next !== duplicateOfId) setDuplicateOfId(null);
      return next;
    });
  }, [duplicateOfId]);
  const closeInlineForm = useCallback(() => {
    setOpenInlineFormId(null);
    setDuplicateOfId(null);
  }, []);
  useEffect(() => {
    if (actionTypeId) {
      setOpenInlineFormId(null);
      setDuplicateOfId(null);
    }
  }, [actionTypeId]);

  // Search lives at this level so it can render inside the action bar
  // alongside the create-new chip and filter chips. ResourceTree consumes
  // it via the controlled searchValue + onSearchChange props.
  const [searchQuery, setSearchQuery] = useState("");

  // Filter or sort changes invalidate the page offset — page 5 of an
  // unfiltered/default-sorted set is meaningless on a filtered/resorted set.
  // Multi-value filters are arrays; join to a stable string so identity
  // churn from `useMemo` doesn't fire this effect every render.
  const filterFingerprint =
    filters.type.join(",") + "|" +
    filters.status.join(",") + "|" +
    filters.priority.join(",") + "|" +
    filters.owner_id.join(",");
  useEffect(() => {
    setPageIndex(0);
  }, [filterFingerprint, sortKey, sortDir]);

  // resourceUrl resolution order:
  //   1. wizardConfig.resourceUrl (sidecar JSON — preferred path, PLA-0037)
  //   2. mode-derived fallback (back-compat for callers not on sidecars yet)
  // Both endpoints land on artefactitems with different scope (work | strategy).
  const resourceUrl =
    wizardConfig?.resourceUrl ?? (mode === "portfolio_items" ? "/portfolio-items" : "/work-items");

  // ResourceTree keeps expanded child rows in its own state; the hook's
  // patchAndApply only mutates root rows. Without these back-channels a
  // pill click on a child row updates the backend but not the visible
  // row, and cascade-touched ancestor rows that live under expanded
  // parents go stale until the user collapses + re-expands.
  //
  //   applyChildPatchRef         — merge the optimistic patch body into
  //                                whichever child array holds the id.
  //   refetchExpandedChildrenRef — after a cascade-triggering PATCH,
  //                                re-pull every expanded sub-tree from
  //                                the server so cascade-updated rows
  //                                (Story/Epic) repaint inline.
  const applyChildPatchRef = useRef<((id: string, partial: Record<string, unknown>) => void) | null>(null);
  const refetchExpandedChildrenRef = useRef<(() => Promise<void>) | null>(null);
  // Row-by-id lookup for the drag-reparent gate. ResourceTree fills
  // this on mount + on every childMap change so the legality check
  // always sees fresh row data (type_prefix + parent_id).
  const getRowByIdRef = useRef<((id: string) => WorkItem | undefined) | null>(null);
  // Flat list of every currently-visible row id (roots + expanded
  // children). Used by the drag candidate pre-pass to enumerate the
  // field of legal drop targets the moment a drag starts.
  const getVisibleIdsRef = useRef<(() => string[]) | null>(null);

  // Build the encoded filter slice from work-items' multi-value array
  // filter shape. PLA-0054 / story 00585+00586+00587 — ANY($N::uuid[]) /
  // ANY($N::text[]) backend predicates. The string already starts with
  // "&" when non-empty so it concatenates cleanly into the query string
  // the generic data hook builds.
  const filterQuery = useMemo(() => {
    const parts: string[] = [];
    if (filters.type.length)     parts.push(`item_type_id=${filters.type.map(encodeURIComponent).join(",")}`);
    if (filters.status.length)   parts.push(`flow_state_id=${filters.status.map(encodeURIComponent).join(",")}`);
    if (filters.priority.length) parts.push(`priority_id=${filters.priority.map(encodeURIComponent).join(",")}`);
    if (filters.owner_id.length) parts.push(`owner_id=${filters.owner_id.map(encodeURIComponent).join(",")}`);
    return parts.length ? `&${parts.join("&")}` : "";
  }, [filters.type, filters.status, filters.priority, filters.owner_id]);

  // Slice 1 of the refactor — V2 now consumes useObjectTreeWindow<T>, the
  // generic windowed-fetch hook. Filter encoding + cascade-trigger list +
  // 409 parent_flow_state_derived recovery all live here at the call site
  // rather than inside the hook. Behaviour is identical to the legacy
  // useArtefactItemsWindow path; other domains (sprints/releases/risks)
  // will provide their own filter encoders and cascade lists.
  const { windowRoots, total, loadingWindow, patchAndApply, fetchChildren, refetchWindow } =
    useObjectTreeWindow<WorkItem>({
      resourceUrl,
      pageSize,
      pageIndex,
      sortKey,
      sortDir,
      filterQuery,
      // Slice 4.5 — visible-column-driven ?fields= projection. Empty
      // unless columnCatalogue is supplied; legacy callers stay on the
      // full-payload path. Slice 4.6a's coalescing handles rapid
      // checkbox toggles so flurries collapse to one outgoing request.
      fields: visibleWireKeys,
      cascadeOnFields: WORK_ITEMS_CASCADE_FIELDS,
      onPatched,
      onLocalPatch: (id, body) => applyChildPatchRef.current?.(id, body),
      onCascadeRefresh: () => { void refetchExpandedChildrenRef.current?.(); },
      onPatchError: (err) => {
        // 409 parent_flow_state_derived — backend rejected a manual
        // flow_state_id write because the row has live children driving
        // its state. Frontend pill row should be locked for these rows;
        // this catch is defence-in-depth in case the UI ever misses the
        // gate. Toast a friendly explanation; the hook will refetch to
        // revert the optimistic local update.
        if (
          err instanceof ObjectTreeApiError &&
          err.status === 409 &&
          typeof err.body === "object" &&
          err.body !== null &&
          (err.body as { error?: string }).error === "parent_flow_state_derived"
        ) {
          notify.hint(
            "This artefact's state is set by its children — move a child to change this row.",
          );
          return true; // handled — hook refetches to revert
        }
        return false; // not ours — silent default preserved
      },
    });

  // Bulk-fetch flow states for every artefact type visible in the
  // current window so each row's Status pill row paints with its OWN
  // type's flow (Risk gets Risk states, Task gets Task states, etc.).
  // The legacy `flowStates` (above) stays as a fallback when a row's
  // type id is missing from the by-type cache.
  const visibleTypeIds = useMemo(() => {
    const seen = new Set<string>();
    for (const r of windowRoots) {
      if (r.artefact_type_id) seen.add(r.artefact_type_id);
    }
    return Array.from(seen);
  }, [windowRoots]);
  const flowStatesByType = useFlowStatesByType(visibleTypeIds);

  // Filter-chip option sets — derived from the LOADED ROWS, not from a
  // separate workspace-clamped catalogue fetch. The grid is the source
  // of truth for "what's reachable in the current scope"; chips just
  // surface those choices. This is what makes the same chip layout work
  // for /work-items and /portfolio-items without either knowing about
  // the other's catalogue, and it sidesteps the workspace-vs-topology
  // UUID mismatch (TD-CHIP-SCOPE-MISMATCH).
  //
  // Workspace catalogues are still consulted — but only for display
  // metadata (label + colour) keyed by UUIDs we already know are present.
  // typeCatalogue (above) is the SAME context — aliased as workspaceTypes
  // here for the rest of this file's existing call sites.
  const workspaceTypes = typeCatalogue;
  const { priorities: workspacePriorities } = useArtefactPriorityCatalogue();

  // PLA057 / OBJ1 — chip options come from the backend facets endpoint,
  // which applies the SAME workspace + topology clamp the list endpoint
  // uses. Guarantees the chip surface agrees with the grid surface across
  // pagination, expansion, and federated scopes.
  //
  // Workspace catalogues are still consulted — but only for display
  // metadata (label + colour) keyed by UUIDs we already know are present.
  // If a facet UUID is missing from the workspace catalogue (federation),
  // we synthesise a label from the truncated UUID so the wedge still
  // appears and remains clickable.
  const { typeIds: facetTypeIds, priorityIds: facetPriorityIds } =
    useObjectTreeFacets(resourceUrl, activeScopeNodeId ?? null);

  const typeOptions = useMemo(() => {
    const byId = new Map(workspaceTypes.map((t) => [t.id, t]));
    const out: { value: string; label: string; color?: string }[] = [];
    for (const id of facetTypeIds) {
      const t = byId.get(id);
      out.push({
        value: id,
        label: t?.name ?? id.slice(0, 8),
        color: t?.colour ?? undefined,
      });
    }
    out.sort((a, b) => {
      const ta = byId.get(a.value);
      const tb = byId.get(b.value);
      if (!ta || !tb) return a.label.localeCompare(b.label);
      return ta.sort_order - tb.sort_order || ta.name.localeCompare(tb.name);
    });
    return out;
  }, [facetTypeIds, workspaceTypes]);

  const priorityOptions = useMemo(() => {
    const byId = new Map(workspacePriorities.map((p) => [p.id, p]));
    const out: { value: string; label: string; color?: string }[] = [];
    for (const id of facetPriorityIds) {
      const p = byId.get(id);
      out.push({
        value: id,
        label: p?.name ?? id.slice(0, 8),
        color: p?.colour ?? undefined,
      });
    }
    out.sort((a, b) => {
      const pa = byId.get(a.value);
      const pb = byId.get(b.value);
      if (!pa || !pb) return a.label.localeCompare(b.label);
      return pa.sort_order - pb.sort_order || pa.name.localeCompare(pb.name);
    });
    return out;
  }, [facetPriorityIds, workspacePriorities]);

  // Duplicate — clone the loaded artefact into a fresh row.
  //
  // Wire flow:
  //   1. Compose the new title. Single (Duplicate) suffix — duplicating
  //      an already-duplicated artefact stays "Title (Duplicate)" rather
  //      than "Title (Duplicate)(Duplicate)" (per user requirement).
  //   2. POST /<resource> with the small set of fields Create accepts
  //      (item_type, title, description, story_points, sprint_id,
  //      parent_id). Backend allocates the new id + key_num atomically
  //      and pins the row to the active ?meg= topology scope (forwarded
  //      by apiSite()). priority_id defaults to the workspace default.
  //   3. PATCH /<resource>/{newId} with everything else the form
  //      surfaces but Create doesn't (description_doc, colour, blocked
  //      state, milestone_id, release_id, owned_by_user_id, flow_state,
  //      priority_id, topology override). Two-step because the Create
  //      endpoint is intentionally minimal — we PATCH the rest into
  //      place rather than fattening Create with every column.
  //   4. Refetch the tree window so the new row appears.
  //   5. Open the form on the new id with isDuplicate=true, flipping
  //      the title head to amber.
  const duplicateArtefact = useCallback(
    async (artefact: ArtefactDetail) => {
      const bundle = resourceUrl === "/portfolio-items" ? portfolioItemsApi : workItemsApi;
      // Strip any trailing "(Duplicate …)" suffix (with or without the
      // "of XX-NNN" tail) — collapse to one. Duplicating an already-
      // duplicated artefact keeps a single suffix; the new suffix always
      // names the IMMEDIATE source, not the original original.
      const stripped = (artefact.title ?? "")
        .replace(/(?:\s*\(Duplicate(?:\s+of\s+[A-Z]+-\d+)?\))+$/i, "")
        .trimEnd();
      const newTitle = `${stripped} (Duplicate of ${artefact.type_prefix}-${artefact.key_num})`;

      const createBody: Record<string, unknown> = {
        item_type: artefact.item_type,
        title: newTitle,
      };
      if (artefact.description != null) createBody.description = artefact.description;
      if (artefact.story_points != null) createBody.story_points = artefact.story_points;
      if (artefact.sprint_id) createBody.sprint_id = artefact.sprint_id;
      if (artefact.parent_id) createBody.parent_id = artefact.parent_id;

      let created: { id: string };
      try {
        created = (await bundle.create(createBody)) as { id: string };
      } catch (e) {
        console.error("duplicate: create failed", e);
        return;
      }
      const newId = created.id;

      // Second-pass PATCH for the columns Create doesn't accept. Each
      // value only goes on the body when the source has it, so we don't
      // ship "set blocked_reason to empty" for non-blocked sources.
      const patchBody: Record<string, unknown> = {};
      if (artefact.description_doc != null) patchBody.description_doc = artefact.description_doc;
      if (artefact.colour) patchBody.colour = artefact.colour;
      if (artefact.is_blocked) {
        patchBody.is_blocked = true;
        if (artefact.blocked_reason) patchBody.blocked_reason = artefact.blocked_reason;
      }
      if (artefact.milestone_id) patchBody.milestone_id = artefact.milestone_id;
      if (artefact.release_id) patchBody.release_id = artefact.release_id;
      if (artefact.owner_id) patchBody.owned_by_user_id = artefact.owner_id;
      if (artefact.priority_id) patchBody.priority_id = artefact.priority_id;
      // flow_state intentionally NOT copied — duplicates always begin at
      // the default initial state for the type (CreateWorkItem already
      // assigns is_initial=TRUE), so a "Done" source spawns a "Todo"
      // clone rather than dragging finished state into a fresh row.
      // Topology pin — apiSite.withForwardedMeg only auto-forwards
      // ?meg= on GETs (api.ts:154), so the POST /work-items above lands
      // with NULL topology_node_id and the clone drops off-scope. PATCH
      // it back: source's own node if it had one, else the caller's
      // active scope node from ScopeContext.
      const pinTo = artefact.topology_node_id ?? activeScopeNodeId;
      if (pinTo) patchBody.topology_node_id = pinTo;
      if (Object.keys(patchBody).length > 0) {
        try {
          await bundle.patch(newId, patchBody);
        } catch (e) {
          console.error("duplicate: patch failed (row was created)", e);
        }
      }

      // refetchWindow() repaints root rows but ResourceTree caches
      // expanded children in its own childMap — without the second
      // call the duplicated row never appears inside an open sub-tree.
      // Same fix the cascade uses (onCascadeRefresh path).
      await refetchWindow();
      await refetchExpandedChildrenRef.current?.();
      setDuplicateOfId(newId);
      setOpenInlineFormId(newId);
    },
    [resourceUrl, refetchWindow, activeScopeNodeId],
  );

  // Delete — soft-archive the artefact (backend sets archived_at). The
  // form has already gated this behind a Confirm step, so by the time we
  // get here the user is committed. Close the form and refetch so the
  // row disappears from the visible window. Same dual-refresh as
  // duplicate: roots + expanded children, otherwise the archived row
  // lingers inside an open parent.
  const deleteArtefact = useCallback(
    async (artefact: ArtefactDetail) => {
      const bundle = resourceUrl === "/portfolio-items" ? portfolioItemsApi : workItemsApi;
      try {
        await bundle.archive(artefact.id);
      } catch (e) {
        console.error("delete: archive failed", e);
        return;
      }
      setOpenInlineFormId(null);
      setDuplicateOfId(null);
      await refetchWindow();
      await refetchExpandedChildrenRef.current?.();
    },
    [resourceUrl, refetchWindow],
  );

  // ── Drag-to-reparent rule + handler ─────────────────────────────────
  //
  // Drop a row ONTO another row → mover becomes a direct child of the
  // target. Children of the mover come with it (parent_artefact_id is
  // preserved on every descendant — only the mover's parent_artefact_id
  // changes). Backend cascade fires on OLD and NEW parent automatically
  // (PatchWorkItem's parent_artefact_id path).
  //
  // Legality rules (v1, frontend-only — backend enforcement deferred
  // per TD-REPARENT-BACKEND-PARENT-TYPE):
  //   1. Same-parent → block. No-op move.
  //   2. Target in mover's subtree → block. Cycle prevention.
  //      (The hook itself already catches this via getDescendants.)
  //   3. Target's type prefix NOT in PARENT_PREFIX_MAP[mover prefix] →
  //      block. Strict cross-boundary rule: a Task can't drop onto an
  //      Epic, a strategic row can't host an execution row directly
  //      except where the map permits (EP→FE).
  // Slice 4 — legality check delegated to the work-items reparent
  // rules module. V2's shell only resolves the rows (via the ref-based
  // back-channel into ResourceTree) and passes them to the predicate.
  // The rule itself lives next to the work-items config — sprints
  // would pass a different rule, or skip dnd entirely.
  const canReparent = useCallback(
    (moverID: string, targetID: string): boolean => {
      const get = getRowByIdRef.current;
      if (!get) return false;
      const mover = get(moverID);
      const target = get(targetID);
      if (!mover || !target) return false;
      return workItemsCanReparent(mover, target);
    },
    [],
  );

  // Candidate pre-pass — fires once on dragstart. Two kinds of legal
  // drop target in the visible tree:
  //   (a) PARENT candidates — rows whose TYPE is in the mover's
  //       allowed-parent list. Drop onto = reparent under this row.
  //   (b) SIBLING candidates — rows whose PARENT is itself a parent
  //       candidate (a). Drop above/below = reparent under the same
  //       parent the sibling has, replicating the sibling-reorder
  //       gesture but across a parent boundary. Without these, an
  //       expanded Epic's existing Story rows wouldn't stripe and
  //       the user couldn't drop a Story above/below them.
  //
  // Cost: still O(n) over the visible-id list. One pass to find
  // parent candidates, second pass to find rows whose parent_id is
  // in that set. No fetches, no recursion.
  // Slice 4 — candidate pre-pass delegated to the work-items rules
  // module. V2 resolves the visible rows via the ref-back-channels
  // then passes them to the pure function. The two-pass parent +
  // sibling resolution lives next to the work-items config.
  const getDragCandidateIds = useCallback(
    (moverID: string): string[] => {
      const getIds = getVisibleIdsRef.current;
      const get = getRowByIdRef.current;
      if (!getIds || !get) return [];
      const mover = get(moverID);
      if (!mover) return [];
      // Materialise the visible rows once; the rules module wants a
      // flat readonly array.
      const ids = getIds();
      const visible: typeof mover[] = [];
      for (const id of ids) {
        const row = get(id);
        if (row) visible.push(row);
      }
      return workItemsGetCandidateIds(mover, visible);
    },
    [],
  );

  // Drop handler. Two shapes per the hook's `intent`:
  //   "onto"           — targetID IS the new parent. Drop in middle
  //                      third of a parent candidate row.
  //   "above"/"below"  — targetID is a SIBLING under the new parent;
  //                      resolve the new parent from targetID's
  //                      parent_id. Drop above/below a sibling
  //                      candidate row.
  //
  // Position semantics: cross-parent drops always land at the end of
  // the new parent's child list right now (backend's
  // sqlSelectNextArtefactPosition default fires when no position is
  // explicitly passed). Same-parent reorders within an existing
  // parent still go through /rank/move from the hook's above/below
  // path (the hook only routes here when target was a CANDIDATE — by
  // construction that means a different parent). See
  // TD-RANK-PARTITION-PARENT-NOT-SPRINT for the proper fix to
  // position-on-cross-parent.
  const reparentArtefact = useCallback(
    async (moverID: string, targetID: string, intent: "onto" | "above" | "below") => {
      let newParentID = targetID;
      if (intent === "above" || intent === "below") {
        const get = getRowByIdRef.current;
        const target = get?.(targetID);
        if (!target) return;
        // Above/below an unparented (root) sibling means "parent to
        // the same root scope" — current data shape has no concept
        // of root reparenting from a drag, so we no-op. Real fix:
        // surface a top-of-tree drop zone.
        if (!target.parent_id) return;
        newParentID = target.parent_id;
      }
      const bundle = resourceUrl === "/portfolio-items" ? portfolioItemsApi : workItemsApi;
      try {
        await bundle.patch(moverID, { parent_artefact_id: newParentID });
      } catch (e) {
        console.error("reparent: patch failed", e);
        return;
      }
      await refetchWindow();
      await refetchExpandedChildrenRef.current?.();
    },
    [resourceUrl, refetchWindow],
  );

  // Patch wrapper to satisfy the ResourceTree contract (returns the row).
  const patchRemote = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      patchAndApply(id, body);
      return { id, ...body } as unknown as WorkItem;
    },
    [patchAndApply],
  );

  const columns = useMemo(
    () => buildWorkItemsColumns(flowStates, patchAndApply, colourMap, {
      onTypeBadgeClick: openInlineForm,
      flowStatesByType,
    }),
    [flowStates, patchAndApply, colourMap, openInlineForm, flowStatesByType],
  );

  const handleSortChange = useCallback(
    (key: string | null, dir: "asc" | "desc") => {
      setSort(key as SortKey | null, dir);
    },
    [setSort],
  );

  // Per-row cog-menu items. Wiring deferred — handlers log for now; the
  // visual surface and dropdown behaviour are the contract for this card.
  const buildCogMenu = useCallback(
    (row: WorkItem) => [
      { key: "edit",      label: "Edit",      onSelect: () => console.log("edit", row.id) },
      { key: "duplicate", label: "Duplicate", onSelect: () => console.log("duplicate", row.id) },
      { key: "move",      label: "Move",      onSelect: () => console.log("move", row.id) },
      { key: "split",     label: "Split",     onSelect: () => console.log("split", row.id) },
      { key: "delete",    label: "Delete",    onSelect: () => console.log("delete", row.id) },
    ],
    [],
  );

  // Build config based on mode or accept from wizardConfig (p_wizard.json).
  // When wizardConfig.filterChips is missing OR doesn't already carry our
  // prefKey-bound chips, we provide them here so the page doesn't have to
  // know the prefKey namespace (TD-URL-FILTER-CHIPS).
  const config = useMemo<ObjectTreeDataConfig<WorkItem>>(() => {
    if (wizardConfig) {
      return {
        ...wizardConfig,
        columns,
        filterChips: wizardConfig.filterChips ?? <WorkItemsFilterChips prefKey={filtersPrefKey} typeOptions={typeOptions} priorityOptions={priorityOptions} />,
      };
    }
    const isPortfolio = mode === "portfolio_items";
    return {
      label: isPortfolio ? "Portfolio items" : "Work items",
      searchPlaceholder: isPortfolio ? "Search portfolio items…" : "Search work items…",
      ariaLabel: isPortfolio ? "Portfolio items dense grid" : "Work items dense grid",
      treeName: isPortfolio ? "portfolioitems" : "workitems",
      columns,
      dndResourceType: isPortfolio ? "portfolio_item" : "work_item",
      dndEnabled: true,
      defaultSortKey: null,
      defaultSortDir: "asc",
      getParentId: (r) => r.parent_id,
      getChildrenCount: (r) => r.children_count,
      searchAccessor: (r) => `${r.title} vec-${r.key_num}`,
      filterChips: <WorkItemsFilterChips prefKey={filtersPrefKey} typeOptions={typeOptions} priorityOptions={priorityOptions} />,
      paginationOptions: [25, 50, 100],
      defaultPageSize: 25,
      resourceUrl: isPortfolio ? "/portfolio-items" : "/work-items",
      scope: isPortfolio ? "strategy" : "work",
    };
  }, [mode, columns, wizardConfig]);

  // Slice 3 — chrome rows extracted to <DenseGridHeader> + <ActionBar>
  // kind components. The work-items-specific bits (type-picker options
  // source, create-action labels) get supplied here at the V2 consumer
  // level; future configs (sprints, releases) pass their own action
  // shape (mode: "single", or omit createAction entirely) without
  // touching the kind components.
  const headerNode = (
    <DenseGridHeader
      badge={subtitleBadge}
      subtitle={subtitle}
      description={description}
    />
  );

  // Collapse the create-action to a single labelled button when the
  // grid's allow-list is exactly one type (e.g. /risk → "Risk"). Two
  // or more options render the type-picker dropdown as before.
  const createAction =
    actionTypeOptions.length === 1
      ? ({
          mode: "single" as const,
          label: actionTypeOptions[0].label,
          onCreate: () => setActionTypeId(actionTypeOptions[0].value),
        })
      : ({
          mode: "type-picker" as const,
          label: "Create New",
          options: actionTypeOptions,
          selectedTypeId: actionTypeId,
          onSelectType: setActionTypeId,
          onCancel: () => setActionTypeId(""),
        });

  const actionBarNode = (
    <ActionBar
      ariaLabel="Work item actions"
      createAction={createAction}
      search={{
        placeholder: config.searchPlaceholder ?? "Search…",
        value: searchQuery,
        onChange: setSearchQuery,
      }}
      filterChips={
        <>
          {config.filterChips}
          {columnCatalogue && (
            // Slice 4.5 — column picker sits at the end of the
            // filter-chip cluster (right side of the action bar).
            <ColumnPicker
              catalogue={columnCatalogue}
              visibleKeys={picker.visibleKeys}
              onChange={picker.setVisibleKeys}
              onResetToDefaults={picker.resetToDefaults}
            />
          )}
        </>
      }
    />
  );

  // Always mounted so the slide-down/up animation has both states to
  // transition between. Visibility is gated by data-open on the wrapper,
  // which drives grid-template-rows + opacity + translateY in CSS.
  //
  // Fields below are wired to live data: topology / flow states / users /
  // sprints / releases / milestones come from the same API surface
  // ArtefactInlineForm consumes; parent candidates run through
  // useParentCandidates with the selected type's prefix. Submit POSTs
  // to ${resourceUrl}?meg=<activeScopeNodeId> so the new row is pinned
  // to the active topology scope (apiSite only auto-forwards ?meg= on
  // GETs — POSTs must pass it explicitly).
  const tab = (open: boolean) => (open ? 0 : -1);

  const submitCreate = async () => {
    if (!actionTypeId || !selectedType) return;
    const title = createDraft.title.trim();
    if (!title) {
      setCreateError("Title is required.");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      // Backend POST contract today: { item_type: <lowercase name>, title,
      // description?, status?, priority_id?, story_points?, sprint_id?,
      // parent_id? }. Topology node comes from ?meg= URL param. Other
      // fields (release_id, milestone_id, flow_state_id, owned_by_user_id,
      // colour, description_doc) are NOT yet accepted at create — they're
      // applied via a follow-up PATCH on the new id, keeping the artefact
      // atomic from the user's perspective even though the wire shape is
      // two round-trips. Extension of the create handler to accept these
      // natively is tracked as TD-CREATE-ATOMIC-NATIVE-FIELDS.
      const body: Record<string, unknown> = {
        item_type: selectedType.name.toLowerCase(),
        title,
      };
      const descriptionPlaintext = docToPlainText(createDraft.description_doc).trim();
      if (descriptionPlaintext) body.description = descriptionPlaintext;
      if (createDraft.parent_id) body.parent_id = createDraft.parent_id;
      if (showSprint && createDraft.sprint_id) body.sprint_id = createDraft.sprint_id;
      // Custom-field values land atomically with the artefact insert
      // (backend wraps both writes in one transaction). customFieldsToWire
      // drops empty values and routes each populated entry to the right
      // *_value column by field_type.
      const customWire = customFieldsToWire(customFieldValues, customFieldBindings);
      if (customWire.length > 0) body.custom_fields = customWire;
      if (showPlanEstimate) {
        const sp = createDraft.story_points.trim();
        if (sp !== "") {
          const n = parseInt(sp, 10);
          if (Number.isFinite(n)) body.story_points = n;
        }
      }

      // ?meg= pins the new row to the active topology scope. apiSite's
      // withForwardedMeg only fires on GETs, so we add it explicitly on
      // POST. The user may have changed the dropdown away from the active
      // scope node — prefer the form's value when present.
      //
      // resourceUrl can already carry GET-only filters (e.g. /risk's
      // sidecar is "/work-items?item_type_id=<uuid>" for the LIST
      // surface). The POST handler ignores query params other than ?meg=,
      // but a bare `${resourceUrl}?meg=...` concat would produce a
      // double-`?` malformed URL. Strip any existing query string and
      // rebuild cleanly from the path + meg.
      const meg = createDraft.topology_node_id || activeScopeNodeId || "";
      const postPath = resourceUrl.split("?")[0];
      const url = meg
        ? `${postPath}?meg=${encodeURIComponent(meg)}`
        : postPath;
      const created = (await apiSite<{ id: string }>(url, {
        method: "POST",
        body: JSON.stringify(body),
      })) as { id?: string } | null;

      // Follow-up PATCH for fields the create handler doesn't accept yet.
      // Each field is "absent ⇒ no change" so we only send what the user
      // actually set. Failures here don't roll back the artefact — we
      // surface them as a non-fatal toast and let the user fix via the
      // inline edit form.
      const newId = created?.id;
      if (newId) {
        const patch: Record<string, unknown> = {};
        if (showRelease && createDraft.release_id) patch.release_id = createDraft.release_id;
        if (createDraft.milestone_id) patch.milestone_id = createDraft.milestone_id;
        if (createDraft.flow_state_id) patch.flow_state_id = createDraft.flow_state_id;
        if (createDraft.owner_id) patch.owned_by_user_id = createDraft.owner_id;
        if (createDraft.colour) patch.colour = createDraft.colour;
        // Rich-text JSON doc lands via PATCH into the JSONB
        // `description_doc` column. The plaintext fallback in `description`
        // was set on the create POST so list-view summaries still render
        // even before the doc patch lands.
        if (createDraft.description_doc) patch.description_doc = createDraft.description_doc;
        if (Object.keys(patch).length > 0) {
          try {
            // Same path-strip as the POST: resourceUrl can carry GET-only
            // query params (e.g. `?item_type_id=<uuid>` on /risk) which
            // become illegal segments when concatenated with `/${newId}`.
            await apiSite(`${postPath}/${newId}`, {
              method: "PATCH",
              body: JSON.stringify(patch),
            });
          } catch {
            notify.info("Artefact created — some fields couldn't be applied. Open it to fix.");
          }
        }
      }

      await refetchWindow();
      setActionTypeId("");
      notify.success(`${actionTypeLabel ?? "Artefact"} created.`);
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : "Create failed. Please try again.",
      );
    } finally {
      setCreateSubmitting(false);
    }
  };

  const createFlyoutNode = (
    <section
      className="tree_accordion-dense__createflyout"
      data-open={actionTypeId ? "true" : "false"}
      role="region"
      aria-label={actionTypeLabel ? `New ${actionTypeLabel} form` : "New artefact form"}
      aria-hidden={!actionTypeId}
    >
      <div className="tree_accordion-dense__createflyout-inner">
        <header className="tree_accordion-dense__createflyout-head">
          <h3 className="tree_accordion-dense__createflyout-title">
            New {actionTypeLabel ?? "artefact"}
          </h3>
          <button
            type="button"
            className="tree_accordion-dense__createflyout-close"
            aria-label="Close form"
            tabIndex={tab(!!actionTypeId)}
            onClick={() => setActionTypeId("")}
          >
            ×
          </button>
        </header>
        <form
          className="tree_accordion-dense__createflyout-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreate();
          }}
        >
          {/* ─── Core (artefacts columns) ──────────────────────────── */}
          <div className="tree_accordion-dense__createflyout-section">
            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">
                Title <span className="tree_accordion-dense__createflyout-required">*</span>
              </span>
              <input
                type="text"
                className="tree_accordion-dense__createflyout-input"
                placeholder={actionTypeLabel ? `${actionTypeLabel} title…` : "Title…"}
                tabIndex={tab(!!actionTypeId)}
                value={createDraft.title}
                onChange={(e) =>
                  setCreateDraft((d) => ({ ...d, title: e.target.value }))
                }
                autoFocus={!!actionTypeId}
                required
              />
            </label>

            <div className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Description</span>
              {/* RichTextField — TipTap-backed JSON doc, same primitive
                  the inline edit form uses. We keep a controlled-doc
                  pattern via onChange so the draft is up-to-date on
                  submit. Plaintext is extracted from this doc on submit
                  and POSTed as `description`; the full JSON ships via
                  the follow-up PATCH into `description_doc`. */}
              <RichTextField
                key={actionTypeId || "empty"}
                value={createDraft.description_doc}
                onChange={(doc) =>
                  setCreateDraft((d) => ({ ...d, description_doc: doc }))
                }
                placeholder="Add a description…"
              />
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              {/* Parent is hidden for top-of-ladder strategic types
                  (layer_depth=0, e.g. Theme) — there's nothing they can
                  parent under. Every other type renders the picker; if
                  the prefix has no allowed parents the candidate list
                  is empty and the user sees "— None (root) —" only. */}
              {!isTopLevel && (
                <label className="tree_accordion-dense__createflyout-field">
                  <span className="tree_accordion-dense__createflyout-field-label">
                    Parent artefact
                  </span>
                  <select
                    className="tree_accordion-dense__createflyout-input"
                    tabIndex={tab(!!actionTypeId)}
                    value={createDraft.parent_id}
                    onChange={(e) =>
                      setCreateDraft((d) => ({ ...d, parent_id: e.target.value }))
                    }
                  >
                    <option value="">— None (root) —</option>
                    {isRisk ? (
                      <>
                        {/* Risk's parent picker spans both scopes within
                            the active topology clamp. Grouped under
                            Strategic / Execution headings so the user
                            sees the hierarchy at a glance. Each option
                            shows prefix-num + title. */}
                        {riskParentStrat.length > 0 && (
                          <optgroup label="Strategic Items">
                            {riskParentStrat.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.type_prefix}-{r.key_num} — {r.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {riskParentExec.length > 0 && (
                          <optgroup label="Execution Items">
                            {riskParentExec.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.type_prefix}-{r.key_num} — {r.title}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Non-Risk parent picker now also spans both
                            scopes (Story / Epic / Defect can parent
                            under Feature). Same Strategic / Execution
                            optgroup shape as the Risk branch above so
                            the user sees the hierarchy at a glance. */}
                        {createParentStrategic.length > 0 && (
                          <optgroup label="Strategic Items">
                            {createParentStrategic.map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </optgroup>
                        )}
                        {createParentExecution.length > 0 && (
                          <optgroup label="Execution Items">
                            {createParentExecution.map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    )}
                  </select>
                </label>
              )}

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Topology node
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  value={createDraft.topology_node_id}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, topology_node_id: e.target.value }))
                  }
                >
                  <option value="">— Unassigned —</option>
                  {createTopologyNodes.map((n) => {
                    const labelText = n.label_override ?? n.name;
                    const isActive = activeScopeNodeId && n.id === activeScopeNodeId;
                    return (
                      <option key={n.id} value={n.id}>
                        {isActive ? `★ ${labelText} (current scope)` : labelText}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Flow state
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  value={createDraft.flow_state_id}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, flow_state_id: e.target.value }))
                  }
                >
                  <option value="">— Initial —</option>
                  {createFlowStates.map((fs) => (
                    <option key={fs.id} value={fs.id}>{fs.name}</option>
                  ))}
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Owner
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  value={createDraft.owner_id}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, owner_id: e.target.value }))
                  }
                >
                  <option value="">— Me —</option>
                  {createUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.display_name}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Sprint / Release — execution timeboxes. Hidden for
                strategic-scope grids (portfolio) and for Risk. Strategic
                items don't sprint-plan; risks don't ship in a release. */}
            {(showSprint || showRelease) && (
              <div className="tree_accordion-dense__createflyout-row">
                {showSprint && (
                  <label className="tree_accordion-dense__createflyout-field">
                    <span className="tree_accordion-dense__createflyout-field-label">
                      Sprint
                    </span>
                    <select
                      className="tree_accordion-dense__createflyout-input"
                      tabIndex={tab(!!actionTypeId)}
                      value={createDraft.sprint_id}
                      onChange={(e) =>
                        setCreateDraft((d) => ({ ...d, sprint_id: e.target.value }))
                      }
                    >
                      <option value="">— Unscheduled —</option>
                      {createSprints.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {showRelease && (
                  <label className="tree_accordion-dense__createflyout-field">
                    <span className="tree_accordion-dense__createflyout-field-label">
                      Release
                    </span>
                    <select
                      className="tree_accordion-dense__createflyout-input"
                      tabIndex={tab(!!actionTypeId)}
                      value={createDraft.release_id}
                      onChange={(e) =>
                        setCreateDraft((d) => ({ ...d, release_id: e.target.value }))
                      }
                    >
                      <option value="">— Unscheduled —</option>
                      {createReleases.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Milestone
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  value={createDraft.milestone_id}
                  onChange={(e) =>
                    setCreateDraft((d) => ({ ...d, milestone_id: e.target.value }))
                  }
                >
                  <option value="">— None —</option>
                  {createMilestones.map((m) => (
                    <option
                      key={m.timeboxes_milestones_id}
                      value={m.timeboxes_milestones_id}
                    >
                      {m.timeboxes_milestones_name} ({m.timeboxes_milestones_date_target})
                    </option>
                  ))}
                </select>
              </label>

              {/* Plan estimate is execution-only. Strategic artefacts
                  don't carry story points. */}
              {showPlanEstimate && (
                <label className="tree_accordion-dense__createflyout-field">
                  <span className="tree_accordion-dense__createflyout-field-label">
                    Plan estimate (points)
                  </span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    className="tree_accordion-dense__createflyout-input"
                    tabIndex={tab(!!actionTypeId)}
                    value={createDraft.story_points}
                    onChange={(e) =>
                      setCreateDraft((d) => ({ ...d, story_points: e.target.value }))
                    }
                  />
                </label>
              )}
            </div>

            {/* Colour — mirrors the inline edit form. ColourPicker is the
                shared swatch + popover primitive; on-create the user
                can colour-code the row before it lands. Available on
                every type since `artefacts.colour` is a base column. */}
            <div className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">
                Colour
              </span>
              <ColourPicker
                value={createDraft.colour || null}
                onChange={(hex) =>
                  setCreateDraft((d) => ({ ...d, colour: hex ?? "" }))
                }
              />
            </div>

            <p className="tree_accordion-dense__createflyout-meta">
              <span>Type: <strong>{actionTypeLabel ?? "—"}</strong></span>
              <span>Number: <strong>auto</strong></span>
              <span>Created by: <strong>me</strong></span>
              <span>
                Scope:{" "}
                <strong>
                  {activeScopeNodeId
                    ? createTopologyNodes.find((n) => n.id === activeScopeNodeId)
                        ?.label_override ??
                      createTopologyNodes.find((n) => n.id === activeScopeNodeId)?.name ??
                      "active node"
                    : "workspace-wide"}
                </strong>
              </span>
            </p>
            {createError && (
              <p className="tree_accordion-dense__createflyout-meta" role="alert" style={{ color: "var(--danger, #c00)" }}>
                {createError}
              </p>
            )}
          </div>

          {/* Custom-field section — live bindings from the backend
              schema endpoint (GET /work-items/types/{id}/fields). Empty
              for types with no bindings; otherwise renders one input per
              binding (ordered by position). Values land in the same POST
              body as `custom_fields: [...]` and are committed inside the
              backend's create transaction (atomic with the artefact). */}
          <CreateCustomFields
            bindings={customFieldBindings}
            values={customFieldValues}
            onChange={setCustomFieldValues}
            tabIndex={tab(!!actionTypeId)}
          />

          <div className="tree_accordion-dense__createflyout-actions">
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              tabIndex={tab(!!actionTypeId)}
              onClick={() => setActionTypeId("")}
              disabled={createSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--sm btn--primary"
              tabIndex={tab(!!actionTypeId)}
              disabled={createSubmitting || !createDraft.title.trim()}
            >
              {createSubmitting
                ? "Creating…"
                : `+ Create ${actionTypeLabel ?? "artefact"}`}
            </button>
          </div>
        </form>
      </div>
    </section>
  );

  // Slice 2 — adapter that maps the shell's DetailFlyoutBodyProps (rowId,
  // onClose, onSaved) onto ArtefactInlineForm's existing prop surface
  // (artefactId, onClose, onSaved, plus domain extras). The adapter is
  // defined inline so it closes over the local handlers without lifting
  // them to refs. ArtefactInlineForm's lifecycle is preserved — it
  // accepts artefactId: string | null and renders nothing when null,
  // matching the shell's contract.
  const ArtefactBody = useCallback(
    (props: DetailFlyoutBodyProps & {
      resourceUrl: string;
      scope: "work" | "strategy";
      onNavigate: (id: string) => void;
      onDuplicate: (artefact: ArtefactDetail) => void;
      onDelete: (artefact: ArtefactDetail) => void;
      isDuplicate: boolean;
    }) => (
      <ArtefactInlineForm
        artefactId={props.rowId}
        resourceUrl={props.resourceUrl}
        scope={props.scope}
        onClose={props.onClose}
        onSaved={props.onSaved}
        onNavigate={props.onNavigate}
        onDuplicate={props.onDuplicate}
        onDelete={props.onDelete}
        isDuplicate={props.isDuplicate}
      />
    ),
    [],
  );

  const inlineFormNode = (
    <ObjectTreeDetailFlyout
      openId={openInlineFormId}
      Body={ArtefactBody}
      onClose={closeInlineForm}
      onSaved={(body) => {
        if (openInlineFormId) patchAndApply(openInlineFormId, body);
      }}
      bodyProps={{
        resourceUrl,
        scope: config.scope ?? "work",
        onNavigate: (id: string) => {
          setOpenInlineFormId(id);
          // Manually navigating away from the just-duplicated row clears
          // the amber state — only the row that came back from Duplicate
          // this session keeps the marker.
          if (id !== duplicateOfId) setDuplicateOfId(null);
        },
        onDuplicate: duplicateArtefact,
        onDelete: deleteArtefact,
        isDuplicate: openInlineFormId != null && openInlineFormId === duplicateOfId,
      }}
    />
  );

  const inner = (
    <>
      {headerNode}
      {actionBarNode}
      {createFlyoutNode}
      {/* TODO(00456): wire bulk action handlers in WS3-D */}
      {multiSelectEnabled && (
        <BulkActionBar selectedIds={selectedIds} onClear={clearSelection} />
      )}
      <ResourceTree<WorkItem>
        roots={windowRoots}
        total={total}
        getId={(r) => r.id}
        getParentId={config.getParentId}
        getChildrenCount={config.getChildrenCount}
        fetchChildren={fetchChildren}
        patch={patchRemote}
        applyChildPatchRef={applyChildPatchRef}
        refetchExpandedChildrenRef={refetchExpandedChildrenRef}
        getRowByIdRef={getRowByIdRef}
        getVisibleIdsRef={getVisibleIdsRef}
        getRowStripeColour={(row) =>
          // Per-row override (set via the inline form's ColourPicker)
          // wins. Falls back to the artefact-type's default colour
          // when the user hasn't picked one. Null when neither is set,
          // which leaves the 10px stripe slot transparent.
          row.colour ?? colourMap?.get(row.type_prefix)?.colour ?? null
        }
        columns={
          // Slice 4.5 — filter columns to the visible set when a
          // catalogue is mounted. visibleKeySet is null when no
          // catalogue → pass all columns (back-compat).
          visibleKeySet
            ? config.columns.filter((c) => visibleKeySet.has(c.key))
            : config.columns
        }
        pagination={{ pageSize, options: config.paginationOptions }}
        paginationPosition="bottom"
        search={{ placeholder: config.searchPlaceholder, accessor: config.searchAccessor }}
        sort={{ key: sortKey, dir: sortDir, onChange: handleSortChange }}
        {...(config.dndEnabled && {
          dnd: {
            resourceType: config.dndResourceType,
            canReparent,
            onReparent: reparentArtefact,
            getCandidateIds: getDragCandidateIds,
          },
        })}
        {...(multiSelectEnabled && {
          selection: {
            mode: "multi" as const,
            selectedIds,
            onSelectionChange: setSelectedIds,
          },
        })}
        cogMenu={buildCogMenu}
        selectedId={selectedId}
        onSelect={onSelect}
        pageIndex={pageIndex}
        onPageIndexChange={setPageIndex}
        onPageSizeChange={setPageSize}
        loading={loadingWindow}
        filterChips={config.filterChips}
        hideFilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        ariaLabel={config.ariaLabel}
        name={config.treeName}
        getRowClass={(row) =>
          row.id === openInlineFormId
            ? "tree_accordion-dense__row--form-open"
            : undefined
        }
      />
    </>
  );

  // When the page passes title + addressableName, ObjectTree owns its own
  // <Panel>. Otherwise (legacy callers still wrapping with their own Panel)
  // we render bare. The inline form is rendered as a SIBLING after the
  // panel — not a child — so the panel's white background ends at the
  // pagination's rounded bottom corners, and the gap above the form
  // shows the page canvas through (no holdover panel bg).
  if (title && addressableName) {
    return (
      <>
        <Panel name={addressableName} title={title}>
          {inner}
        </Panel>
        {inlineFormNode}
      </>
    );
  }
  return (
    <>
      <div>{inner}</div>
      {inlineFormNode}
    </>
  );
}
