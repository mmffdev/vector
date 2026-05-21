"use client";

// ObjectTree — generic dumb primitive over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// a config object. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every data-type concern lives in the config.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workItems as workItemsApi, portfolioItems as portfolioItemsApi } from "@/app/lib/apiSite";
import { useScope } from "@/app/contexts/ScopeContext";
import ArtefactInlineForm from "@/app/components/ArtefactInlineForm";
import { PARENT_PREFIX_MAP, type ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
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
import type { ColumnDef } from "@/app/components/ResourceTree";
// Slice 3 — icons moved into the kind components (DenseGridHeader doesn't
// need any; ActionBar imports MdAdd / MdOutlineCategory / MdSearch itself).
import { useObjectTreeWindow, ApiError as ObjectTreeApiError } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeWindow";
import { ObjectTreeDetailFlyout, type DetailFlyoutBodyProps } from "@/app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout";
import { DenseGridHeader } from "@/app/components/ObjectTreeV2/kinds/DenseGridHeader";
import { ActionBar } from "@/app/components/ObjectTreeV2/kinds/ActionBar";
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
  // Optional scope hint for diagnostics / addressing — does NOT influence
  // routing (the backend route already encodes the scope).
  scope?: "work" | "strategy";
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
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
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

  // Active topology scope. Used by duplicateArtefact to pin the clone
  // when the source artefact had no topology_node_id of its own
  // (apiSite() only auto-forwards ?meg= on GETs, not POSTs).
  const { activeNodeId: activeScopeNodeId } = useScope();

  // Action bar — artefact type picker that focuses the "Add new" CTA.
  // Design-only for now (no create wiring); options come from the workspace
  // artefact-type catalogue, same source as the filter chips.
  const actionTypeOptions = useChipTypeOptions("work");
  const [actionTypeId, setActionTypeId] = useState<string>("");
  const actionTypeLabel = useMemo(() => {
    const found = actionTypeOptions.find((o) => o.value === actionTypeId);
    return found?.label ?? null;
  }, [actionTypeOptions, actionTypeId]);

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
  const canReparent = useCallback(
    (moverID: string, targetID: string): boolean => {
      if (moverID === targetID) return false;
      const get = getRowByIdRef.current;
      if (!get) return false;
      const mover = get(moverID);
      const target = get(targetID);
      if (!mover || !target) return false;
      // Same-parent → no-op (would also be a wasted PATCH).
      if (mover.parent_id === target.id) return false;
      // Allowed-parent rule, from the prefix map.
      const allowed = PARENT_PREFIX_MAP[mover.type_prefix?.toUpperCase() ?? ""] ?? [];
      const targetPrefix = target.type_prefix?.toUpperCase() ?? "";
      return allowed.includes(targetPrefix);
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
  const getDragCandidateIds = useCallback(
    (moverID: string): string[] => {
      const getIds = getVisibleIdsRef.current;
      const get = getRowByIdRef.current;
      if (!getIds || !get) return [];
      const mover = get(moverID);
      if (!mover) return [];
      const allowed = PARENT_PREFIX_MAP[mover.type_prefix?.toUpperCase() ?? ""] ?? [];
      if (allowed.length === 0) return [];
      const allowedSet = new Set(allowed);
      const ids = getIds();
      const parentCandidateIds = new Set<string>();
      // Pass 1 — parent candidates by type.
      for (const id of ids) {
        if (id === moverID) continue;
        const row = get(id);
        if (!row) continue;
        if (mover.parent_id === row.id) continue;
        const prefix = row.type_prefix?.toUpperCase() ?? "";
        if (allowedSet.has(prefix)) parentCandidateIds.add(id);
      }
      // Pass 2 — sibling candidates: any row whose parent is a parent
      // candidate. Mover and its descendants are still excluded
      // (cycle prevention) — useResourceRank's draggingSubtree guard
      // covers the descendant case at the hover step, but we trim
      // here too so the visual field is clean.
      const out: string[] = Array.from(parentCandidateIds);
      for (const id of ids) {
        if (id === moverID) continue;
        if (parentCandidateIds.has(id)) continue; // already added
        const row = get(id);
        if (!row || !row.parent_id) continue;
        if (parentCandidateIds.has(row.parent_id)) {
          out.push(id);
        }
      }
      return out;
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
        filterChips: wizardConfig.filterChips ?? <WorkItemsFilterChips prefKey={filtersPrefKey} />,
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
      filterChips: <WorkItemsFilterChips prefKey={filtersPrefKey} />,
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

  const actionBarNode = (
    <ActionBar
      ariaLabel="Work item actions"
      createAction={{
        mode: "type-picker",
        label: "Create New",
        options: actionTypeOptions,
        selectedTypeId: actionTypeId,
        onSelectType: setActionTypeId,
        onCancel: () => setActionTypeId(""),
      }}
      search={{
        placeholder: config.searchPlaceholder ?? "Search…",
        value: searchQuery,
        onChange: setSearchQuery,
      }}
      filterChips={config.filterChips}
    />
  );

  // Always mounted so the slide-down/up animation has both states to
  // transition between. Visibility is gated by data-open on the wrapper,
  // which drives grid-template-rows + opacity + translateY in CSS.
  //
  // Field inventory below is design-only (PLA-0052 Path A): every column
  // on `artefacts` (vector_artefacts) plus a custom-fields section that
  // shows one stub input per `field_library.field_type` so the visual
  // contract is reviewable. No live data, no submit wiring.
  const tab = (open: boolean) => (open ? 0 : -1);
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
            // Design-only — surface intent in console until wired.
            // eslint-disable-next-line no-console
            console.log("Create artefact", { artefact_type_id: actionTypeId, label: actionTypeLabel });
            setActionTypeId("");
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
              />
            </label>

            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Description</span>
              <textarea
                className="tree_accordion-dense__createflyout-input"
                rows={3}
                placeholder="Optional rich text"
                tabIndex={tab(!!actionTypeId)}
              />
            </label>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Parent artefact
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— None (root) —</option>
                  <option value="stub-1">Epic: Onboarding revamp</option>
                  <option value="stub-2">Feature: Risk register</option>
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Topology node
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Unassigned —</option>
                  <option value="stub-a">Platform / Identity</option>
                  <option value="stub-b">Platform / Billing</option>
                  <option value="stub-c">Revenue / Acquisition</option>
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
                  defaultValue=""
                >
                  <option value="">— Initial —</option>
                  <option value="backlog">Backlog</option>
                  <option value="ready">Ready</option>
                  <option value="doing">Doing</option>
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Position
                </span>
                <input
                  type="number"
                  className="tree_accordion-dense__createflyout-input"
                  defaultValue={0}
                  tabIndex={tab(!!actionTypeId)}
                />
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Owner
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Me —</option>
                  <option value="stub-u1">Alex Chen</option>
                  <option value="stub-u2">Priya Shah</option>
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Assigned to
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Unassigned —</option>
                  <option value="stub-u1">Alex Chen</option>
                  <option value="stub-u2">Priya Shah</option>
                </select>
              </label>
            </div>

            <p className="tree_accordion-dense__createflyout-meta">
              <span>Type: <strong>{actionTypeLabel ?? "—"}</strong></span>
              <span>Number: <strong>auto</strong></span>
              <span>Created by: <strong>me</strong></span>
              <span>Workspace + Subscription: <strong>session-scoped</strong></span>
            </p>
          </div>

          {/* ─── Custom fields (per-type field_library bindings) ───── */}
          <div className="tree_accordion-dense__createflyout-section">
            <div className="tree_accordion-dense__createflyout-section-head">
              <span className="cf-tree__section-label">Custom Fields</span>
              <span className="tree_accordion-dense__createflyout-stub-tag">stub</span>
            </div>

            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Short text (textbox)</span>
              <input type="text" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
            </label>

            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Long text (richtext)</span>
              <textarea rows={2} className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
            </label>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Integer</span>
                <input type="number" step={1} className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Decimal</span>
                <input type="number" step="0.01" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Date</span>
                <input type="date" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
              <label className="tree_accordion-dense__createflyout-field tree_accordion-dense__createflyout-field--inline">
                <input type="checkbox" tabIndex={tab(!!actionTypeId)} />
                <span className="tree_accordion-dense__createflyout-field-label">Boolean</span>
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Select (one)</span>
                <select className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} defaultValue="">
                  <option value="">— Choose —</option>
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                </select>
              </label>
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Multiselect</span>
                <select multiple size={3} className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)}>
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                  <option value="c">Option C</option>
                </select>
              </label>
            </div>

            <fieldset className="tree_accordion-dense__createflyout-radiogroup">
              <legend className="tree_accordion-dense__createflyout-field-label">Radio</legend>
              <label className="tree_accordion-dense__createflyout-radio">
                <input type="radio" name="stub-radio" tabIndex={tab(!!actionTypeId)} /> One
              </label>
              <label className="tree_accordion-dense__createflyout-radio">
                <input type="radio" name="stub-radio" tabIndex={tab(!!actionTypeId)} /> Two
              </label>
              <label className="tree_accordion-dense__createflyout-radio">
                <input type="radio" name="stub-radio" tabIndex={tab(!!actionTypeId)} /> Three
              </label>
            </fieldset>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">User picker</span>
                <select className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} defaultValue="">
                  <option value="">— Choose user —</option>
                  <option value="stub-u1">Alex Chen</option>
                  <option value="stub-u2">Priya Shah</option>
                </select>
              </label>
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">URL</span>
                <input type="url" placeholder="https://…" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
            </div>
          </div>

          <div className="tree_accordion-dense__createflyout-actions">
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              tabIndex={tab(!!actionTypeId)}
              onClick={() => setActionTypeId("")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--sm btn--primary"
              tabIndex={tab(!!actionTypeId)}
            >
              + Create {actionTypeLabel ?? "artefact"}
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
      <BulkActionBar selectedIds={selectedIds} onClear={clearSelection} />
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
        columns={config.columns}
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
        selection={{ mode: "multi", selectedIds, onSelectionChange: setSelectedIds }}
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
