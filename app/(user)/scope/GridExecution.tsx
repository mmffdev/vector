"use client";

// GridExecution — Layer 2. The per-page assembler for /scope. A thin assembly
// with NO row markup of its own: it mounts the primitive (Grid__Tree + useTree)
// with the /scope column config and the ONE reference extension
// (expandable-rows-with-flyout-below). Future pages get their own assembler
// (GridStrategic, GridRisk, …) over the same primitive — this file is the
// template.
//
// What it owns:
//   • roots state          — loaded once via the audited POST gateway
//                            (fetchScopeRoots → workItems.query({page})).
//   • useTree({expandable}) — the headless core; fetchChildren resolves a row's
//                            TRUE direct children via workItems.query({parentId}).
//   • openDetailId         — which row currently has its flyout-below open
//                            (the expandable extension's open-state).
//
// The tree's OWN title (title + subtitle) is passed straight into <GridTree>;
// the page-level title lives on <DataContainer> in page.tsx. Neither passes
// through the other — the frame and the tree are wired independently.
//
// What it does NOT own: the look (Grid__Tree), the connectors (CSS), the tree
// state machine (useTree), or the form body (Grid__Tree_Forms / ArtefactInlineForm).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GridTree } from "@/app/components/Grid/Grid__Tree";
import { GridTreeForms } from "@/app/components/Grid/Grid__Tree_Forms";
import type { ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
import type { TreeNode } from "@/app/components/Grid/types";
import { useTree } from "@/app/components/Grid/useTree";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import { useFlowStatesByType } from "@/app/components/useFlowStatesByType";
import { workItems, type WorkItemsSummary } from "@/app/lib/apiSite";
import { apiSite } from "@/app/lib/api";
import { useSentinel } from "@/app/sentinel";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useArtefactPriorityCatalogue } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import { useObjectTreeFacets } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeFacets";
import {
  workItemsCanReparent,
  workItemsGetCandidateIds,
} from "@/app/components/ObjectTreeV2/configs/workItemsReparentRules";
import {
  useWorkItemsFilters,
  WorkItemsFilterChips,
} from "@/app/components/work-items-tree-config";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";
import { makeScopeColumns } from "./scopeColumns";
import {
  fetchScopeRoots,
  fetchScopeChildren,
  type ScopeNode,
  type ScopeTreeFilters,
} from "./scopeTreeData";

const SCOPE_FILTER_PREF_KEY = "scope.workitems.filters";
const WORK_ITEM_CREATEABLE_SLOTS = new Set(
  [
    ...((workItemsWizardJson as { createableTypeSlots?: string[] })
      .createableTypeSlots ?? []),
    "wrk_risk",
  ],
);
const TASK_TYPE_SLOT = "wrk_task";
const DEFAULT_SCOPE_TYPE_SLOT = "wrk_epic";

function pluralTypeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "Type";
  if (/y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  if (/s$/i.test(trimmed)) return trimmed;
  return `${trimmed}s`;
}

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

function reparentableScopeRow(row: ScopeNode) {
  return {
    id: row.uuid,
    parent_id: row.parentUuid,
    type_prefix: row.type,
  };
}

function collectDescendantUuids(node: TreeNode<ScopeNode>): string[] {
  const out: string[] = [];
  const walk = (children: TreeNode<ScopeNode>[]) => {
    for (const child of children) {
      out.push(child.row.uuid);
      walk(child.children);
    }
  };
  walk(node.children);
  return out;
}

// useTree wiring isolated to keep the assembler's JSX declarative.
// ScopeNode.id is the human id ("US-17357") — stable + unique per row, the
// React key + the expansion-set key. The hook now OWNS the paged root window:
// fetchRoots loads a page (the canopy), fetchChildren resolves a row's true
// direct children via the POST gateway (by UUID in the body, never the URL).
function useTreeScope(autoLoad: boolean, filters: ScopeTreeFilters) {
  const fetchRoots = useCallback(
    (page: { limit: number; offset: number }) =>
      fetchScopeRoots(page, filters),
    [filters],
  );
  const fetchChildren = useCallback(
    (row: ScopeNode) => fetchScopeChildren(row.uuid, filters),
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

export function GridExecution() {
  const router = useRouter();
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nodeSummary, setNodeSummary] = useState<WorkItemsSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const { sentinel_focus_node, sentinel_loading, sentinel_tenant } = useSentinel();
  const { filters } = useWorkItemsFilters(SCOPE_FILTER_PREF_KEY);

  // Creatable work-scope artefact types → one pie wedge each. Source the same
  // sidecar allow-list as /work-items so Create New and the Type filter expose
  // the same declared work-item surface (Story / Defect / Task / Epic today).
  const workTypeOptions = useChipTypeOptions("work");
  const createTypes = useMemo(
    () =>
      workTypeOptions.filter((t) =>
        t.slot ? WORK_ITEM_CREATEABLE_SLOTS.has(t.slot) : false,
      ),
    [workTypeOptions],
  );
  const filterTypeOptions = useMemo(
    () => createTypes.filter((t) => t.slot !== TASK_TYPE_SLOT),
    [createTypes],
  );
  const selectedTypeId = useMemo(() => {
    if (filterTypeOptions.length === 0) return null;
    const allowed = new Set(filterTypeOptions.map((t) => t.value));
    const current = filters.type.find((id) => allowed.has(id));
    if (current) return current;
    return (
      filterTypeOptions.find((t) => t.slot === DEFAULT_SCOPE_TYPE_SLOT)
        ?.value ?? filterTypeOptions[0]?.value ?? null
    );
  }, [filterTypeOptions, filters.type]);
  const selectedTypeOption = useMemo(
    () => filterTypeOptions.find((t) => t.value === selectedTypeId) ?? null,
    [filterTypeOptions, selectedTypeId],
  );
  const selectedTypeLabel = selectedTypeOption
    ? pluralTypeLabel(selectedTypeOption.label)
    : "Type";
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

  // Tasks are children-only on the scope tree. They remain visible through
  // expansion, but they are not a top-level Type filter option. /scope uses
  // the Type chip as a single view selector: one primary artefact type at a
  // time, defaulting to Epic when no valid type has been chosen.
  const gridFilters = useMemo<ScopeTreeFilters>(() => {
    if (!selectedTypeId) {
      return filters;
    }
    return {
      ...filters,
      type: [selectedTypeId],
    };
  }, [filters, selectedTypeId]);

  // The headless core owns the paged window (loadMore / jumpToPage / refresh).
  // /scope waits for Sentinel before its first root load so POST /work-items/query
  // carries the active ?meg= from the start instead of doing a scope-less mount read.
  const tree = useTreeScope(false, gridFilters);
  const { refresh } = tree;
  const { refreshPreservingExpansion } = tree;
  const { updateRow } = tree;

  // Rally-style live rank sync: reorder a Prio in ANY tab or client (same
  // workspace) → every other open /scope grid refetches and re-renders the new
  // order. Source of truth is the WebSocket realtime hub: a /rank/move writes
  // artefacts_position → the rank_changed DB trigger (mig 176) pg_notifies →
  // StartRankListener republishes to this topic → useRefetchOnPush fires a
  // 150ms-debounced refreshPreservingExpansion. Topic MUST match the trigger's
  // emitted shape exactly: scope="backlog", scope_id=null (Prio is a workspace-
  // global dense rank, one namespace per subscription — not per-sprint). Prio
  // is a computed ROW_NUMBER over the filtered set, so one move reshuffles many
  // rows; a full list refetch is the only correct reconciliation (no single-cell
  // patch is possible). Null topic until the tenant is known → hook no-ops.
  const rankSyncTopic = sentinel_tenant?.id
    ? rankTopic("work_item", sentinel_tenant.id, "backlog", null)
    : null;
  useRefetchOnPush({ topic: rankSyncTopic, refetch: refreshPreservingExpansion });
  const rowByUuid = useMemo(() => {
    const out = new Map<string, ScopeNode>();
    for (const node of tree.flatNodes) out.set(node.row.uuid, node.row);
    return out;
  }, [tree.flatNodes]);
  const nodeByUuid = useMemo(() => {
    const out = new Map<string, TreeNode<ScopeNode>>();
    for (const node of tree.flatNodes) out.set(node.row.uuid, node);
    return out;
  }, [tree.flatNodes]);
  const visibleTypeIds = useMemo(() => {
    const seen = new Set<string>();
    for (const node of tree.flatNodes) {
      if (node.row.artefactTypeId) seen.add(node.row.artefactTypeId);
    }
    return Array.from(seen);
  }, [tree.flatNodes]);
  const flowStatesByType = useFlowStatesByType(visibleTypeIds);
  const filterFingerprint = useMemo(
    () =>
      [
        gridFilters.type.join(","),
        gridFilters.status.join(","),
        gridFilters.priority.join(","),
        gridFilters.owner_id.join(","),
      ].join("|"),
    [gridFilters],
  );

  // React to topology scope AND filter chips. The sentinel focus node is the
  // request-time clamp the backend reads from the request context; the filters
  // ride in the POST body. Either change must reload the canopy immediately.
  //
  // This ALSO fixes the empty-grid-on-refresh: useTree's mount load can race the
  // sentinel resolving the focus from the JWT (an unresolved clamp returns no
  // rows). We initialise the tracker to `undefined` (distinct from a real null
  // or string focus) so the FIRST time focus is actually known we refresh once,
  // re-issuing the roots fetch under the now-resolved clamp.
  const lastRequestRef = useRef<
    { focus: string | null; filters: string } | undefined
  >(undefined);
  useEffect(() => {
    if (sentinel_loading) return;
    const next = { focus: sentinel_focus_node, filters: filterFingerprint };
    const prev = lastRequestRef.current;
    if (prev?.focus === next.focus && prev.filters === next.filters) return;
    lastRequestRef.current = next;
    refresh();
  }, [sentinel_loading, sentinel_focus_node, filterFingerprint, refresh]);

  const refetchNodeSummary = useCallback(() => {
    if (sentinel_loading || !sentinel_focus_node) {
      setNodeSummary(null);
      return Promise.resolve();
    }
    return workItems
      .summary()
      .then((next) => setNodeSummary(next))
      .catch(() => setNodeSummary(null));
  }, [sentinel_focus_node, sentinel_loading]);

  useEffect(() => {
    void refetchNodeSummary();
  }, [refetchNodeSummary]);

  const { priorityIds: facetPriorityIds } =
    useObjectTreeFacets("/work-items", sentinel_focus_node ?? null);
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
      ariaLabel: "Work item actions",
      create: {
        label: "Create new",
        types: createTypes.map((t) => ({
          id: t.value,
          label: t.label,
          color: t.color,
        })),
        // Part 4b will open a create flyout for the picked type; for now the
        // radial pick is wired but the create form is not yet built.
        onCreate: (typeId: string) => {
          // eslint-disable-next-line no-console
          console.log("[scope] create type picked:", typeId);
        },
      },
      search: {
        placeholder: "Search work items…",
        value: search,
        onChange: setSearch,
      },
      filterChips: (
        <WorkItemsFilterChips
          prefKey={SCOPE_FILTER_PREF_KEY}
          typeOptions={filterTypeOptions}
          priorityOptions={priorityOptions}
          typeSelectionMode="single"
          typeSelected={selectedTypeId ? [selectedTypeId] : []}
          typeLabel={selectedTypeLabel}
          typeCloseOnPick
        />
      ),
    }),
    [
      createTypes,
      filterTypeOptions,
      priorityOptions,
      search,
      selectedTypeId,
      selectedTypeLabel,
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
        await workItems.patch(uuid, { colour: hex ?? "" });
        refreshPreservingExpansion();
      } catch (e) {
        console.error("scope colour patch failed", e);
      }
    },
    [refreshPreservingExpansion],
  );

  // Columns close over the form-open trigger so the type badge can open the
  // flyout (OTV2 parity). Memoised so the column identity is stable.
  const columns = useMemo(
    () => makeScopeColumns(openForm, flowStatesByType, patchColour),
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

  const canReparent = useCallback(
    (moverUuid: string, targetUuid: string): boolean => {
      const mover = rowByUuid.get(moverUuid);
      const target = rowByUuid.get(targetUuid);
      if (!mover || !target) return false;
      return workItemsCanReparent(
        reparentableScopeRow(mover),
        reparentableScopeRow(target),
      );
    },
    [rowByUuid],
  );

  const getDragCandidateIds = useCallback(
    (moverUuid: string): string[] => {
      const mover = rowByUuid.get(moverUuid);
      if (!mover) return [];
      return workItemsGetCandidateIds(
        reparentableScopeRow(mover),
        tree.flatNodes.map((node) => reparentableScopeRow(node.row)),
      );
    },
    [rowByUuid, tree.flatNodes],
  );

  const getDescendantUuids = useCallback(
    (row: ScopeNode): string[] => {
      const node = nodeByUuid.get(row.uuid);
      return node ? collectDescendantUuids(node) : [];
    },
    [nodeByUuid],
  );

  const reparentArtefact = useCallback(
    async (
      moverUuid: string,
      targetUuid: string,
      intent: "onto" | "above" | "below",
    ) => {
      const mover = rowByUuid.get(moverUuid);
      const target = rowByUuid.get(targetUuid);
      if (!mover || !target) return;

      let newParentUuid: string | null = target.uuid;
      if (
        intent === "above" ||
        intent === "below" ||
        !workItemsCanReparent(
          reparentableScopeRow(mover),
          reparentableScopeRow(target),
        )
      ) {
        newParentUuid = target.parentUuid;
      }
      if (!newParentUuid || mover.parentUuid === newParentUuid) return;

      try {
        await workItems.patch(mover.uuid, { parent_artefact_id: newParentUuid });
      } catch (e) {
        console.error("scope reparent failed", e);
        return;
      }
      refreshPreservingExpansion();
    },
    [refreshPreservingExpansion, rowByUuid],
  );

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

      const pinTo = artefact.topology_node_id ?? sentinel_focus_node;
      if (!pinTo) {
        console.error("scope duplicate: missing topology focus");
        return;
      }

      let created: ArtefactDetail;
      try {
        created = await apiSite<ArtefactDetail>(
          `/work-items?meg=${encodeURIComponent(pinTo)}`,
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
          await workItems.patch(created.id, patchBody);
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
        await workItems.archive(artefact.id);
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

  return (
    <GridTree<ScopeNode>
      title={selectedTypeLabel}
      subtitle={`These are your selected ${selectedTypeLabel.toLowerCase()}, you can navigate through their ancestry, create new, duplicate, remove and edit.`}
      badge=""
      statsPanel={statsPanel}
      actionBar={actionBar}
      tree={tree}
      columns={columns}
      defaultSort={null}
      loadingStyle="barberpole"
      dnd={{
        resourceType: "work_item",
        rowIdOf: (row) => row.uuid,
        canReparent,
        getCandidateIds: getDragCandidateIds,
        getDescendants: getDescendantUuids,
        onReparent: reparentArtefact,
        onMoved: () => refreshPreservingExpansion(),
        onError: () => refreshPreservingExpansion(),
      }}
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
          resourceUrl="/work-items"
          scope="work"
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
      empty={<p className="grid__Empty">No work items in scope.</p>}
    />
  );
}
