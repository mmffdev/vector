"use client";

// hook-allow-url-query: openDependencyMap deep-links to /dependencies?meg=&ash=
//   — a verbatim copy of GridWorkItems/GridExecution. /dependencies reads ash+meg
//   off the URL (its established deep-link contract); meg is a SHAREABLE_PARAMS
//   entry for /portfolio-items. Not view-state in the address bar.
//
// GridPortfolioItems — Layer 2. The per-page assembler for /portfolio-items,
// swapping the retiring ObjectTreeV2 onto the Grid primitive (see
// docs/superpowers/specs/2026-06-07-portfolio-items-grid-swap-design.md). A
// verbatim copy of /work-items' GridWorkItems, re-scoped to strategy artefacts:
// the data bundle is portfolioItems (same artefactitems handler, scope=strategy),
// the create pills/filter chips/flyout run on scope="strategy", and the column
// set is trimmed (Sprint + Points dropped). An independent copy by design —
// per-page assembler, same primitive underneath.
//
// DnD reparent is DEFERRED here: strategy types chain through parent_type_id,
// not execution_parent_slots, so the work-items buildReparentMap returns nothing
// for strategy. The dnd prop is omitted until a strategy-ladder reparent rule
// lands (TD-PORTFOLIO-REPARENT).
//
// What it owns:
//   • roots state          — loaded once via the audited POST gateway
//                            (fetchScopeRoots → portfolioItems.query({page})).
//   • useTree({expandable}) — the headless core; fetchChildren resolves a row's
//                            TRUE direct children via portfolioItems.query({parentId}).
//   • openDetailId         — which row currently has its flyout-below open
//                            (the expandable extension's open-state).
//
// What it does NOT own: the look (Grid__Tree), the connectors (CSS), the tree
// state machine (useTree), or the form body (Grid__Tree_Forms / ArtefactInlineForm).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GridTree } from "@/app/components/Grid/Grid__Tree";
import { GridTreeForms } from "@/app/components/Grid/Grid__Tree_Forms";
import type { ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
import { useTree } from "@/app/components/Grid/useTree";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import { useFlowStatesByType } from "@/app/components/useFlowStatesByType";
import { portfolioItems, type WorkItemsSummary } from "@/app/lib/apiSite";
import { apiSite } from "@/app/lib/api";
import { useSentinel } from "@/app/sentinel";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useArtefactPriorityCatalogue } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import { useObjectTreeFacets } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeFacets";
import {
  useWorkItemsFilters,
  WorkItemsFilterChips,
} from "@/app/components/work-items-tree-config";
import { ArtefactCreateFlyout } from "@/app/components/ArtefactCreateFlyout";
import { makeScopeColumns } from "../scope/scopeColumns";
import {
  fetchScopeRoots,
  fetchScopeChildren,
  type ScopeNode,
  type ScopeTreeFilters,
} from "../scope/scopeTreeData";

// Distinct from /scope's "scope.workitems.filters" AND /work-items'
// "workitems.grid.filters" so this surface keeps independent chip state — a
// Type/Status selection on /portfolio-items must not bleed into the other grids.
const SCOPE_FILTER_PREF_KEY = "portfolioitems.grid.filters";

function scopeRowAnchor(rowId: string): string {
  return `scope-${rowId}`;
}

function selectScopeRowAnchor(rowId: string): void {
  const anchor = scopeRowAnchor(rowId);
  if (typeof window !== "undefined") {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${anchor}`,
    );
  }
  const scroll = () => {
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({
      block: "start",
      inline: "nearest",
    });
  };
  window.requestAnimationFrame(() => {
    scroll();
    window.requestAnimationFrame(scroll);
  });
  window.setTimeout(scroll, 120);
}

function patchScopeRowFromArtefact(
  row: ScopeNode,
  artefact: ArtefactDetail,
): ScopeNode {
  return {
    ...row,
    summary: artefact.title,
    artefactTypeId: artefact.artefact_type_id,
    flowStateId: artefact.flow_state_id,
    flowStateName: artefact.flow_state_name,
    flowStateCode: artefact.flow_state_code,
    points: artefact.story_points,
    owner: artefact.owner?.display_name ?? row.owner,
    parent: artefact.parent
      ? `${artefact.parent.type_prefix}-${artefact.parent.key_num} — ${artefact.parent.title}`
      : null,
    parentId: artefact.parent
      ? `${artefact.parent.type_prefix}-${artefact.parent.key_num}`
      : null,
    parentUuid: artefact.parent?.id ?? null,
    sprint: artefact.sprint?.alias ?? null,
    due: artefact.due_date,
    childrenCount: artefact.children_count ?? row.childrenCount,
    colour: artefact.colour ?? null,
  };
}

// useTree wiring isolated to keep the assembler's JSX declarative.
// ScopeNode.id is the human id ("FE-17357") — stable + unique per row, the
// React key + the expansion-set key. The hook now OWNS the paged root window:
// fetchRoots loads a page (the canopy), fetchChildren resolves a row's true
// direct children via the POST gateway (by UUID in the body, never the URL).
// The portfolioItems bundle is passed as the api arg so both reads hit the
// scope=strategy /portfolio-items/query handler.
function useTreeScope(autoLoad: boolean, filters: ScopeTreeFilters) {
  const fetchRoots = useCallback(
    (page: { limit: number; offset: number }) =>
      fetchScopeRoots(page, filters, portfolioItems),
    [filters],
  );
  const fetchChildren = useCallback(
    (row: ScopeNode) => fetchScopeChildren(row.uuid, filters, portfolioItems),
    [filters],
  );

  return useTree<ScopeNode>({
    fetchRoots,
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: (r) => r.childrenCount,
    fetchChildren,
    autoLoad,
    expandable: true,
  });
}

export function GridPortfolioItems() {
  const router = useRouter();
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  // Armed create type (artefact_type uuid). "" ⇒ create flyout closed. The
  // ActionBar's radial create-pick sets it; <ArtefactCreateFlyout> reads it.
  const [createTypeId, setCreateTypeId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [nodeSummary, setNodeSummary] = useState<WorkItemsSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const { sentinel_focus_node, sentinel_loading, sentinel_tenant } = useSentinel();
  const { filters } = useWorkItemsFilters(SCOPE_FILTER_PREF_KEY);

  // Creatable strategy artefact types → one pie wedge each. This sidecar has no
  // createableTypeSlots allow-list, so ALL live strategy types surface (the
  // hook is already scope=strategy-scoped) — no slot trim.
  const workTypeOptions = useChipTypeOptions("strategy");
  const createTypes = workTypeOptions;
  const filterTypeOptions = createTypes;
  const statsPanel = useMemo(() => {
    const summary = nodeSummary ?? { total: 0, blocked: 0, by_type: {} };
    const byType = summary.by_type ?? {};
    return {
      ariaLabel: "Current node artefact statistics",
      stats: [
        { key: "total", label: "TOTAL ITEMS", value: summary.total },
        ...createTypes.map((t) => ({
          key: t.value,
          label: t.label.toUpperCase(),
          value: byType[t.label.toLowerCase()] ?? 0,
        })),
        {
          key: "blocked",
          label: "BLOCKED",
          value: summary.blocked,
          tone: "warning" as const,
          glyph: "issue" as const,
        },
      ],
    };
  }, [createTypes, nodeSummary]);

  // /portfolio-items uses the Type chip as a MULTI-select filter (stack several
  // strategy layers at once). The raw chip selection (filters.type, possibly
  // empty = all types) drives the tree query directly.
  const gridFilters = useMemo<ScopeTreeFilters>(() => filters, [filters]);

  // The headless core owns the paged window (loadMore / jumpToPage / refresh).
  // Wait for Sentinel before the first root load so POST /portfolio-items/query
  // carries the active ?meg= from the start instead of a scope-less mount read.
  const tree = useTreeScope(false, gridFilters);
  const { refresh } = tree;
  const { refreshPreservingExpansion } = tree;
  const { updateRow } = tree;

  // Rally-style live rank sync: reorder a Prio in ANY tab or client (same
  // workspace) → every other open grid refetches and re-renders the new order.
  // Topic MUST match the trigger's emitted shape AND the page's summary topic
  // exactly: scope="backlog", scope_id=subscriptionID (portfolio's page uses
  // the subscription id as the 4th arg, NOT null). Null topic until the tenant
  // is known → hook no-ops.
  const rankSyncTopic = sentinel_tenant?.id
    ? rankTopic("portfolio_item", sentinel_tenant.id, "backlog", sentinel_tenant.id)
    : null;
  useRefetchOnPush({ topic: rankSyncTopic, refetch: refreshPreservingExpansion });
  const visibleTypeIds = useMemo(() => {
    const seen = new Set<string>();
    for (const node of tree.flatNodes) {
      if (node.row.artefactTypeId) seen.add(node.row.artefactTypeId);
    }
    return Array.from(seen);
  }, [tree.flatNodes]);
  const flowStatesByType = useFlowStatesByType(visibleTypeIds);

  // Reload the canopy whenever the clamp or filters change AND on every change
  // of `refresh` identity. `refresh` is rebuilt by useTree whenever its
  // `fetchRoots` changes — which is exactly when `gridFilters` (hence the POST
  // body / clamp closure) changes. Keying the load on `refresh` itself means we
  // can't miss a settled-state load.
  useEffect(() => {
    if (sentinel_loading) return;
    refresh();
  }, [sentinel_loading, refresh]);

  const refetchNodeSummary = useCallback(() => {
    if (sentinel_loading || !sentinel_focus_node) {
      setNodeSummary(null);
      return Promise.resolve();
    }
    return portfolioItems
      .summary()
      .then((next) => setNodeSummary(next))
      .catch(() => setNodeSummary(null));
  }, [sentinel_focus_node, sentinel_loading]);

  useEffect(() => {
    void refetchNodeSummary();
  }, [refetchNodeSummary]);

  const { priorityIds: facetPriorityIds } =
    useObjectTreeFacets("/portfolio-items", sentinel_focus_node ?? null);
  const { priorities: workspacePriorities } = useArtefactPriorityCatalogue();
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

  const actionBar = useMemo(
    () => ({
      ariaLabel: "Portfolio item actions",
      create: {
        label: "Create new",
        types: createTypes.map((t) => ({
          id: t.value,
          label: t.label,
          color: t.color,
        })),
        // Arm the create flyout for the picked type. <ArtefactCreateFlyout>
        // (rendered below the grid) opens whenever createTypeId is non-empty,
        // sources its own option lists, and POSTs+PATCHes on submit.
        onCreate: (typeId: string) => setCreateTypeId(typeId),
      },
      search: {
        placeholder: "Search portfolio items…",
        value: search,
        onChange: setSearch,
      },
      filterChips: (
        // /portfolio-items: multi-select Type chip so the user can stack
        // several strategy layers. The chip reads/writes its own filters.type
        // via SCOPE_FILTER_PREF_KEY.
        <WorkItemsFilterChips
          prefKey={SCOPE_FILTER_PREF_KEY}
          typeOptions={filterTypeOptions}
          priorityOptions={priorityOptions}
          typeSelectionMode="multi"
        />
      ),
    }),
    [
      createTypes,
      filterTypeOptions,
      priorityOptions,
      search,
    ],
  );

  const closeDetail = useCallback(() => {
    setOpenDetailId(null);
    setDuplicateOfId(null);
  }, []);

  // After a save/delete in the flyout, the server is the source of truth:
  // refresh() resets expansion + reloads the canopy from the top so the grid
  // reflects the mutation. Not a hack — the correct server-driven refresh.
  const refreshAfterMutation = useCallback(() => {
    refresh();
    void refetchNodeSummary();
  }, [refetchNodeSummary, refresh]);

  // OTV2 form trigger: clicking a row's type badge toggles the inline edit
  // flyout below it (single-open). Separate axis from caret expansion.
  const openForm = useCallback(
    (id: string) => {
      const next = openDetailId === id ? null : id;
      // Navigating away from the freshly-duplicated row clears its amber accent
      // — amber only applies to the row that just came back from Duplicate.
      if (next !== duplicateOfId) setDuplicateOfId(null);
      setOpenDetailId(next);
    },
    [duplicateOfId, openDetailId],
  );

  // Inline colour patch — fires from the grid's ColourBlockPicker. PATCH the
  // artefact's colour, then refreshPreservingExpansion so the row re-renders
  // with the new tint without collapsing the user's tree state.
  const patchColour = useCallback(
    async (uuid: string, hex: string | null) => {
      try {
        await portfolioItems.patch(uuid, { colour: hex ?? "" });
        refreshPreservingExpansion();
      } catch (e) {
        console.error("scope colour patch failed", e);
      }
    },
    [refreshPreservingExpansion],
  );

  // Columns close over the form-open trigger so the type badge can open the
  // flyout (OTV2 parity). Memoised so the column identity is stable. Strategy
  // trim: Sprint + Points dropped (always empty for strategy artefacts).
  const columns = useMemo(
    () =>
      makeScopeColumns(openForm, flowStatesByType, patchColour, undefined, {
        omit: ["points", "sprint"],
      }),
    [openForm, flowStatesByType, patchColour],
  );

  const openDetailVisible = useMemo(
    () =>
      openDetailId == null
        ? false
        : tree.flatNodes.some((node) => node.id === openDetailId),
    [openDetailId, tree.flatNodes],
  );

  useEffect(() => {
    if (!openDetailId || !openDetailVisible) return;
    selectScopeRowAnchor(openDetailId);
  }, [openDetailId, openDetailVisible]);

  const duplicateArtefact = useCallback(
    async (artefact: ArtefactDetail) => {
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
      // "Under original" — the duplicate sits directly beneath its source in the
      // Prio rank. Backend computes the midpoint position below artefact.id.
      createBody.rank_placement = "after";
      createBody.after_artefact_id = artefact.id;

      const pinTo = artefact.topology_node_id ?? sentinel_focus_node;
      if (!pinTo) {
        console.error("scope duplicate: missing topology focus");
        return;
      }

      let created: ArtefactDetail;
      try {
        created = await apiSite<ArtefactDetail>(
          `/portfolio-items?meg=${encodeURIComponent(pinTo)}`,
          {
            method: "POST",
            body: JSON.stringify(createBody),
          },
        );
      } catch (e) {
        console.error("scope duplicate: create failed", e);
        return;
      }

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

      if (Object.keys(patchBody).length > 0) {
        try {
          await portfolioItems.patch(created.id, patchBody);
        } catch (e) {
          console.error("scope duplicate: patch failed", e);
        }
      }

      const newRowId = `${created.type_prefix}-${created.key_num}`;
      setDuplicateOfId(newRowId);
      setOpenDetailId(newRowId);
      refreshAfterMutation();
    },
    [refreshAfterMutation, sentinel_focus_node],
  );

  const deleteArtefact = useCallback(
    async (artefact: ArtefactDetail) => {
      try {
        await portfolioItems.archive(artefact.id);
      } catch (e) {
        console.error("scope delete: archive failed", e);
        return;
      }
      closeDetail();
      refreshAfterMutation();
    },
    [closeDetail, refreshAfterMutation],
  );

  const openDependencyMap = useCallback(
    (artefact: ArtefactDetail) => {
      const params = new URLSearchParams();
      const nodeId = artefact.topology_node_id ?? sentinel_focus_node;
      if (nodeId) params.set("meg", nodeId);
      params.set("ash", artefact.id);
      router.push(`/dependencies?${params.toString()}`);
    },
    [router, sentinel_focus_node],
  );

  // Human label for the armed create type — drives the flyout heading +
  // submit-button copy. Sourced from the same createTypes the radial pick uses.
  const createTypeLabel = useMemo(
    () => createTypes.find((t) => t.value === createTypeId)?.label ?? null,
    [createTypes, createTypeId],
  );

  return (
    <GridTree<ScopeNode>
      title="Portfolio items"
      subtitle="Filter by one or more strategic layers, navigate their ancestry, and create, duplicate, remove or edit any portfolio item."
      badge=""
      statsPanel={statsPanel}
      actionBar={actionBar}
      tree={tree}
      columns={columns}
      defaultSort={null}
      loadingStyle="barberpole"
      selection={{ selectedIds, onSelectionChange: setSelectedIds }}
      rowIdText={(row) => row.id}
      onRowIdClick={(row) => openForm(row.id)}
      rowPrio={(row) => row.prio}
      selectedId={openDetailId}
      openDetailId={openDetailId}
      rowAnchorOf={(node) => scopeRowAnchor(node.id)}
      renderRowDetail={(node) => (
        <GridTreeForms
          artefactId={node.row.uuid}
          resourceUrl="/portfolio-items"
          scope="strategy"
          onClose={closeDetail}
          onSaved={(_, artefact) => {
            if (!artefact) return;
            updateRow(node.id, (row) => patchScopeRowFromArtefact(row, artefact));
            void refetchNodeSummary();
          }}
          onDuplicate={duplicateArtefact}
          onDependencies={openDependencyMap}
          onDelete={deleteArtefact}
          isDuplicate={node.id === duplicateOfId}
        />
      )}
      empty={<p className="grid__Empty">No portfolio items in scope.</p>}
      belowActionBar={
        <ArtefactCreateFlyout
          actionTypeId={createTypeId}
          actionTypeLabel={createTypeLabel}
          resourceUrl="/portfolio-items"
          scope="strategy"
          onClose={() => setCreateTypeId("")}
          onCreated={() => {
            // Pressing Create is "done": close the form and refresh so the new
            // row appears at its rank. We deliberately DO NOT open the new
            // row's edit flyout or scroll to it.
            setCreateTypeId("");
            refreshAfterMutation();
          }}
        />
      }
    />
  );
}
