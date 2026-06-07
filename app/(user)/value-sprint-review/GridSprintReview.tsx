"use client";

// hook-allow-url-query: cross-route deep-link to /dependencies?meg=&ash= (the
// dependency-map viewport) — identical to /scope's GridExecution; meg is the
// shareable scope-identity param (shareableParams allow-list) and ash is the
// artefact deep-link segment. The wire apiSite("/work-items?meg=") call is a
// fetch, not address-bar state.

// GridSprintReview — the per-page assembler for /value-sprint-review's sprint
// backlog, over the canonical Grid primitive (Grid__Tree + useTree). Sibling of
// /scope's GridExecution; same template, three differences:
//
//   1. Roots are clamped to the PANEL SPRINT + the story tier (Story / Defect /
//      Risk + any custom story-tier work type) — see sprintReviewTreeData.
//   2. Status pills are INTERACTIVE here (the sprint board drives flow-state),
//      where /scope's are read-only.
//   3. The form's onSaved REFRESHES the canopy when a timebox-membership field
//      (sprint / release / milestone) changes, so a row reassigned out of the
//      clamped sprint disappears. This is the structural fix for the bug that
//      started this work ("changing a sprint on the expander form didn't take" —
//      the old ObjectTreeV2 path never refetched a sprint-clamped tree).
//
// The sprint Prev / Next / Current / Switch / Sprint-Status buttons are owned by
// the page and injected via the action bar's `leading` slot — this assembler is
// agnostic to what they do.
//
// What it does NOT own: the look (Grid__Tree), connectors (CSS), tree state
// (useTree), or the form body (Grid__Tree_Forms / ArtefactInlineForm).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GridTree } from "@/app/components/Grid/Grid__Tree";
import { GridTreeForms } from "@/app/components/Grid/Grid__Tree_Forms";
import type { ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
import type { TreeNode } from "@/app/components/Grid/types";
import { useTree } from "@/app/components/Grid/useTree";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import {
  useFlowStatesByType,
  invalidateFlowStatesByType,
} from "@/app/components/useFlowStatesByType";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { workItems } from "@/app/lib/apiSite";
import { apiSite, ApiError } from "@/app/lib/api";
import { useSentinel } from "@/app/sentinel";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useArtefactPriorityCatalogue } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import { useObjectTreeFacets } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeFacets";
import {
  buildReparentMap,
  workItemsCanReparent,
  workItemsGetCandidateIds,
} from "@/app/components/ObjectTreeV2/configs/workItemsReparentRules";
import {
  useWorkItemsFilters,
  WorkItemsFilterChips,
} from "@/app/components/work-items-tree-config";
import { makeScopeColumns } from "@/app/(user)/scope/scopeColumns";
import {
  fetchSprintReviewRoots,
  fetchSprintReviewChildren,
  type ScopeNode,
  type ScopeTreeFilters,
} from "./sprintReviewTreeData";

// The story tier — work types at the same level as User Story. Story + Defect +
// Risk are the leaf work types that are neither Epic (above) nor Task (below).
// Resolved slot → type-UUID via the workspace catalogue so gadmin renames + any
// custom tenant type carrying these slots survive. (Custom non-slot types at the
// same tier are not auto-included — see TD-SPRINTREVIEW-STORY-TIER-STATIC.)
const STORY_TIER_SLOTS = ["wrk_story", "wrk_defect", "wrk_risk"] as const;

const FILTER_PREF_KEY = "value_sprint_review.workitems.filters";

function pluralTypeLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "Type";
  if (/y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  if (/s$/i.test(trimmed)) return trimmed;
  return `${trimmed}s`;
}

function reviewRowAnchor(rowId: string): string {
  return `sprint-review-${rowId}`;
}

function reparentableRow(row: ScopeNode) {
  return { id: row.uuid, parent_id: row.parentUuid, type_prefix: row.type };
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

function patchRowFromArtefact(row: ScopeNode, a: ArtefactDetail): ScopeNode {
  return {
    ...row,
    summary: a.title,
    artefactTypeId: a.artefact_type_id,
    flowStateId: a.flow_state_id,
    flowStateName: a.flow_state_name,
    flowStateCode: a.flow_state_code,
    points: a.story_points,
    owner: a.owner?.display_name ?? row.owner,
    parent: a.parent
      ? `${a.parent.type_prefix}-${a.parent.key_num} — ${a.parent.title}`
      : null,
    parentId: a.parent ? `${a.parent.type_prefix}-${a.parent.key_num}` : null,
    parentUuid: a.parent?.id ?? null,
    sprint: a.sprint?.alias ?? null,
    due: a.due_date,
    colour: a.colour ?? null,
  };
}

// Membership fields whose change must drop/keep a row in the sprint-clamped
// canopy. A PATCH that touches any of these means the row may no longer belong
// to the displayed sprint → full canopy refresh (vs. an in-place row patch).
const MEMBERSHIP_KEYS = ["sprint_id", "release_id", "milestone_id"] as const;

export interface GridSprintReviewProps {
  /** Panel sprint UUID — the canopy clamp. Null while resolving. */
  panelSprintId: string | null;
  /**
   * Sprint nav/status buttons (Prev / Next / Current / Switch / Status),
   * page-owned, rendered at the start of the grid's action bar.
   */
  actionBarLeading?: React.ReactNode;
  /**
   * Fired after a mutation that can change the sprint's membership or points
   * (sprint reassignment, delete, duplicate, flow-state). The page uses it to
   * refresh the burndown.
   */
  onMembershipChanged?: () => void;
}

export function GridSprintReview({
  panelSprintId,
  actionBarLeading,
  onMembershipChanged,
}: GridSprintReviewProps) {
  const router = useRouter();
  const { sentinel_focus_node, sentinel_loading, sentinel_tenant } = useSentinel();
  const { types } = useArtefactTypeCatalogue();
  const { filters } = useWorkItemsFilters(FILTER_PREF_KEY);

  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Allowed-parent map for drag-reparent, derived from the live types'
  // execution_parent_slots (replaces the retired PARENT_PREFIX_MAP).
  const reparentMap = useMemo(() => buildReparentMap(types), [types]);

  // Story-tier type-UUIDs from the workspace catalogue.
  const storyTierTypeIds = useMemo(() => {
    const bySlot = new Map(types.map((t) => [t.slot, t.id]));
    return STORY_TIER_SLOTS.map((s) => bySlot.get(s)).filter(
      (id): id is string => !!id,
    );
  }, [types]);

  // Type-filter options = the story tier only, so the Type chip never offers a
  // type outside the clamp. Drives the single-select Type chip.
  const workTypeOptions = useChipTypeOptions("work");
  const filterTypeOptions = useMemo(
    () =>
      workTypeOptions.filter((t) =>
        t.slot ? (STORY_TIER_SLOTS as readonly string[]).includes(t.slot) : false,
      ),
    [workTypeOptions],
  );
  const selectedTypeId = useMemo(() => {
    if (filterTypeOptions.length === 0) return null;
    const allowed = new Set(filterTypeOptions.map((t) => t.value));
    const current = filters.type.find((id) => allowed.has(id));
    return current ?? null; // null ⇒ whole tier (no single-type narrowing)
  }, [filterTypeOptions, filters.type]);
  const selectedTypeLabel = useMemo(() => {
    const opt = filterTypeOptions.find((t) => t.value === selectedTypeId);
    return opt ? pluralTypeLabel(opt.label) : "Items";
  }, [filterTypeOptions, selectedTypeId]);

  // The clamp the data layer always carries (sprint + tier).
  const clamp = useMemo(
    () => ({ sprintId: panelSprintId, typeIds: storyTierTypeIds }),
    [panelSprintId, storyTierTypeIds],
  );

  // Chip filters intersected with the tier: a single in-tier Type selection
  // narrows; otherwise the whole tier shows.
  const chipFilters = useMemo<ScopeTreeFilters>(
    () =>
      selectedTypeId
        ? { ...filters, type: [selectedTypeId] }
        : { ...filters, type: [] },
    [filters, selectedTypeId],
  );

  // ── Tree core ──────────────────────────────────────────────────────────────
  const fetchRoots = useCallback(
    (page: { limit: number; offset: number }) =>
      fetchSprintReviewRoots(page, clamp, chipFilters),
    [clamp, chipFilters],
  );
  const fetchChildren = useCallback(
    (row: ScopeNode) => fetchSprintReviewChildren(row.uuid),
    [],
  );
  const tree = useTree<ScopeNode>({
    fetchRoots,
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: (r) => r.childrenCount,
    fetchChildren,
    autoLoad: false,
    expandable: true,
  });
  const { refresh, refreshPreservingExpansion, updateRow } = tree;

  // First load + reload on clamp / filter / focus change. Gated on a resolved
  // sprint so the POST carries the sprint clamp from the first read (an
  // unresolved clamp returns nothing). The fingerprint folds in every input
  // that changes the canopy.
  const fingerprint = useMemo(
    () =>
      [
        panelSprintId ?? "",
        storyTierTypeIds.join(","),
        selectedTypeId ?? "",
        chipFilters.status.join(","),
        chipFilters.priority.join(","),
        chipFilters.owner_id.join(","),
        sentinel_focus_node ?? "",
      ].join("|"),
    [
      panelSprintId,
      storyTierTypeIds,
      selectedTypeId,
      chipFilters,
      sentinel_focus_node,
    ],
  );
  const lastFingerprintRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sentinel_loading) return;
    if (!panelSprintId) return;
    if (lastFingerprintRef.current === fingerprint) return;
    lastFingerprintRef.current = fingerprint;
    refresh();
  }, [sentinel_loading, panelSprintId, fingerprint, refresh]);

  // ── Realtime: wake on sprint-scoped rank pushes for this tenant + sprint ─────
  const rankSyncTopic =
    sentinel_tenant?.id && panelSprintId
      ? rankTopic("work_item", sentinel_tenant.id, "sprint", panelSprintId)
      : null;
  useRefetchOnPush({ topic: rankSyncTopic, refetch: refreshPreservingExpansion });

  // ── Lookups for DnD + per-type flow rendering ───────────────────────────────
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

  // ── Priority chip options (facet ids × workspace catalogue) ──────────────────
  const { priorityIds: facetPriorityIds } = useObjectTreeFacets(
    "/work-items",
    sentinel_focus_node ?? null,
  );
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

  // ── Mutations ────────────────────────────────────────────────────────────────
  const closeDetail = useCallback(() => {
    setOpenDetailId(null);
    setDuplicateOfId(null);
  }, []);

  const openForm = useCallback(
    (id: string) => {
      const next = openDetailId === id ? null : id;
      if (next !== duplicateOfId) setDuplicateOfId(null);
      setOpenDetailId(next);
    },
    [duplicateOfId, openDetailId],
  );

  const patchColour = useCallback(
    async (uuid: string, hex: string | null) => {
      try {
        await workItems.patch(uuid, { colour: hex ?? "" });
        refreshPreservingExpansion();
      } catch (e) {
        console.error("sprint-review colour patch failed", e);
      }
    },
    [refreshPreservingExpansion],
  );

  // Status pill commit — flow-state rolls up to ancestors, so refresh (not just
  // an in-place patch) keeps parents correct; also nudges the burndown.
  const commitStatus = useCallback(
    async (uuid: string, flowStateId: string) => {
      try {
        await workItems.patch(uuid, { flow_state_id: flowStateId });
        refreshPreservingExpansion();
        onMembershipChanged?.();
      } catch (e) {
        // A 400 "flow_state_id not found" means the cached flow states are
        // stale — a flow was edited/reseeded underneath the open page, so the
        // pill committed a now-deleted state id. Self-heal: bust the cache for
        // this row's type and refetch so the pills repaint with live state ids,
        // rather than forcing a manual reload.
        if (e instanceof ApiError && e.status === 400) {
          const typeId = rowByUuid.get(uuid)?.artefactTypeId;
          invalidateFlowStatesByType(typeId ? [typeId] : undefined);
        }
        console.error("sprint-review status patch failed", e);
        refreshPreservingExpansion();
      }
    },
    [refreshPreservingExpansion, onMembershipChanged, rowByUuid],
  );

  const columns = useMemo(
    () => makeScopeColumns(openForm, flowStatesByType, patchColour, commitStatus),
    [openForm, flowStatesByType, patchColour, commitStatus],
  );

  // ── DnD ──────────────────────────────────────────────────────────────────────
  const canReparent = useCallback(
    (moverUuid: string, targetUuid: string): boolean => {
      const mover = rowByUuid.get(moverUuid);
      const target = rowByUuid.get(targetUuid);
      if (!mover || !target) return false;
      return workItemsCanReparent(
        reparentableRow(mover),
        reparentableRow(target),
        reparentMap,
      );
    },
    [rowByUuid, reparentMap],
  );
  const getDragCandidateIds = useCallback(
    (moverUuid: string): string[] => {
      const mover = rowByUuid.get(moverUuid);
      if (!mover) return [];
      return workItemsGetCandidateIds(
        reparentableRow(mover),
        tree.flatNodes.map((node) => reparentableRow(node.row)),
        reparentMap,
      );
    },
    [rowByUuid, tree.flatNodes, reparentMap],
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
          reparentableRow(mover),
          reparentableRow(target),
          reparentMap,
        )
      ) {
        newParentUuid = target.parentUuid;
      }
      if (!newParentUuid || mover.parentUuid === newParentUuid) return;
      try {
        await workItems.patch(mover.uuid, { parent_artefact_id: newParentUuid });
      } catch (e) {
        console.error("sprint-review reparent failed", e);
        return;
      }
      refreshPreservingExpansion();
    },
    [refreshPreservingExpansion, rowByUuid, reparentMap],
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
        console.error("sprint-review duplicate: missing topology focus");
        return;
      }
      let created: ArtefactDetail;
      try {
        created = await apiSite<ArtefactDetail>(
          `/work-items?meg=${encodeURIComponent(pinTo)}`,
          { method: "POST", body: JSON.stringify(createBody) },
        );
      } catch (e) {
        console.error("sprint-review duplicate: create failed", e);
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
          console.error("sprint-review duplicate: patch failed", e);
        }
      }
      const newRowId = `${created.type_prefix}-${created.key_num}`;
      setDuplicateOfId(newRowId);
      setOpenDetailId(newRowId);
      refresh();
      onMembershipChanged?.();
    },
    [refresh, sentinel_focus_node, onMembershipChanged],
  );

  const deleteArtefact = useCallback(
    async (artefact: ArtefactDetail) => {
      try {
        await workItems.archive(artefact.id);
      } catch (e) {
        console.error("sprint-review delete: archive failed", e);
        return;
      }
      closeDetail();
      refresh();
      onMembershipChanged?.();
    },
    [closeDetail, refresh, onMembershipChanged],
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

  // ── Action bar ───────────────────────────────────────────────────────────────
  const actionBar = useMemo(
    () => ({
      ariaLabel: "Sprint backlog actions",
      leading: actionBarLeading,
      search: {
        placeholder: "Search work items…",
        value: search,
        onChange: setSearch,
      },
      filterChips: (
        <WorkItemsFilterChips
          prefKey={FILTER_PREF_KEY}
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
      actionBarLeading,
      search,
      filterTypeOptions,
      priorityOptions,
      selectedTypeId,
      selectedTypeLabel,
    ],
  );

  return (
    <GridTree<ScopeNode>
      title="Sprint backlog"
      subtitle="Work items committed to this sprint, with full hierarchy. State rolls up."
      badge=""
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
      rowAnchorOf={(node) => reviewRowAnchor(node.id)}
      renderRowDetail={(node) => (
        <GridTreeForms
          artefactId={node.row.uuid}
          resourceUrl="/work-items"
          scope="work"
          onClose={closeDetail}
          onSaved={(body, artefact) => {
            // A membership change (sprint/release/milestone) can drop this row
            // from the clamped canopy → full refresh. Otherwise an in-place row
            // patch is enough and keeps the user's expansion state.
            const membershipChanged = MEMBERSHIP_KEYS.some(
              (k) => k in (body ?? {}),
            );
            if (membershipChanged) {
              refresh();
            } else if (artefact) {
              updateRow(node.id, (row) => patchRowFromArtefact(row, artefact));
            }
            onMembershipChanged?.();
          }}
          onDuplicate={duplicateArtefact}
          onDependencies={openDependencyMap}
          onDelete={deleteArtefact}
          isDuplicate={node.id === duplicateOfId}
        />
      )}
      empty={<p className="grid__Empty">No work items in this sprint.</p>}
    />
  );
}
