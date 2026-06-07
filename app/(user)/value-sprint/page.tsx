"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import ObjectTree, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTreeV2/p_ObjectTree";
import type { RowButton } from "@/app/components/ResourceTree";
import RadialPillMenu from "@/app/components/RadialPillMenu/p_RadialPillMenu";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useSentinel } from "@/app/sentinel";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import { resolveSlotRefs } from "@/app/lib/sidecarSlotResolver";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useNextSprint, type SprintWireRow } from "@/app/hooks/useNextSprint";
import { workItems, sprints as sprintsApi, ranking } from "@/app/lib/apiSite";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { MdChevronLeft, MdChevronRight, MdOutlineFlag } from "react-icons/md";
import { BsCalendar3 } from "react-icons/bs";
import { usePageSavedViews } from "@/app/components/SavedViews/PageSavedViewsControl";
import { usePageHeader } from "@/app/contexts/PageHeaderContext";
import { GridSprintBoundary } from "@/app/components/Grid/Grid__SprintBoundary";
import { useTree } from "@/app/components/Grid/useTree";
import { fetchSprintRoots } from "@/app/components/Grid/sprintBoundaryTreeData";
import type { ScopeNode } from "@/app/(user)/scope/scopeTreeData";
import { makeScopeColumns } from "@/app/(user)/scope/scopeColumns";
import type { SprintBoundaryDelta } from "@/app/components/Grid/useSprintBoundary";
import type { WorkItemFlowState } from "@/app/components/useWorkItemFlowStates";

// Column drops for the value-sprint trees. The rowButtons column adds
// ~244px of horizontal chrome (Add to Sprint + Target Sprint chips),
// which pushes the right-edge columns past the table's overflow:hidden
// clamp. Sprint planning doesn't need Parent (the panel tree already
// shows hierarchy via indent), Due (sprint commitment is the date
// here), or Priority (deferred from this surface).
//
// Backlog drops Sprint on top — rows there are by definition unassigned;
// the column would only ever read "—". The page's whole task is to
// assign them, so the Add-to-Sprint / Target-Sprint chips ARE the
// affordance and the column is dead weight.
const PANEL_DROP_COLS   = ["parent", "due", "priority"] as const;
const BACKLOG_DROP_COLS = ["parent", "due", "priority", "sprint"] as const;

// Display rule for sprint identifiers — matches the backend's projection
// (backend/internal/timeboxsprints/sql.go and artefactitems/sql.go):
//   "<name> — <suffix>"  when suffix is non-empty
//   "<name>"             otherwise
// Backend stores name + suffix separately so renames don't disturb the
// numeric series; the UI joins them everywhere a sprint is identified.
function formatSprintLabel(s: SprintWireRow | null | undefined): string {
  if (!s) return "";
  const name = s.timeboxes_sprints_name ?? "";
  const suffix = (s.timeboxes_sprints_suffix ?? "").trim();
  return suffix ? `${name} — ${suffix}` : name;
}

// Page-level saved-views target. One view applies across both grids
// on this page (panel + backlog). Body shape:
//   { grids: { panel: { visible_columns }, backlog: { visible_columns } } }
// See app/components/SavedViews/PageSavedViewsControl.tsx for the
// design + partial-body rule.
const SAVED_VIEW_TARGET_PAGE = "page:value_sprint";

export default function ValueSprint() {
  const { full } = usePageTitle();

  // Sentinel clamp — copied verbatim from app/(user)/work-items/page.tsx.
  // Identity + tenant + scope flow through Sentinel; `direction` is derived
  // from sentinel_scope_up / sentinel_scope_down (Rally idiom).
  const {
    sentinel_tenant,
    sentinel_focus_node,
    sentinel_scope_up,
    sentinel_scope_down,
    sentinel_user,
    sentinel_can,
  } = useSentinel();
  const activeNodeId = sentinel_focus_node;
  const direction = sentinel_scope_down ? "descend" : sentinel_scope_up ? "ascend" : "none";

  // Page-level saved views — single dropdown rendered in the shell
  // header (left of the personal nav pill). Drives both grids' column
  // sets via the bind() helpers spread onto each ObjectTree mount.
  const savedViewGrids = useMemo(() => ["panel", "backlog"], []);
  const pageSavedViews = usePageSavedViews({
    target: SAVED_VIEW_TARGET_PAGE,
    grids: savedViewGrids,
    currentUserID: sentinel_user?.id ?? "",
    currentNodeID: activeNodeId,
    currentWorkspaceID: sentinel_user?.workspace_id ?? "",
    canShareToNode: !!activeNodeId,
    // Proxy: workspace.archive stands in for "can share to workspace
    // scope" until a dedicated workspace.share_views code exists. Same
    // TD as the per-grid SavedViewsControl — TD-SAVEDVIEWS-WORKSPACE-SHARE-PERM-CODE.
    canShareToWorkspace: sentinel_can("workspace.archive"),
  });
  const panelBind = pageSavedViews.bind("panel");
  const backlogBind = pageSavedViews.bind("backlog");
  usePageHeader({
    title: full,
    actions: pageSavedViews.node,
  });

  // Slice 1 — live "next sprint" lookup for the top panel. The wire's
  // workspace_id is the tenant/subscription root UUID (see the live
  // /timeboxes/sprints response: timeboxes_sprints_id_workspace =
  // 00000000-0000-0000-0000-000000000001 on the dev seed). That maps to
  // sentinel_user.tenant_id, NOT sentinel_user.workspace_id — they are
  // distinct fields on SentinelUser, and the working /sprints page
  // (app/(user)/sprints/page.tsx) confirms tenant_id is the correct one
  // for this endpoint. The topology focus node is passed so the
  // backend's slice-5B ancestor walk fires when the user is viewing a
  // child node of a propagated sprint, same as TimeboxObjectTree's
  // reload().
  const workspaceId = sentinel_user?.tenant_id ?? null;
  // PERF (2026-05-28) — single hook returns both the picked next sprint
  // AND the next-up-to-8 upcoming sprints (for the "Target Sprint"
  // radial picker). Was two hooks firing /timeboxes/sprints twice with
  // identical params; collapsed to one fetch.
  const {
    sprint: nextSprint,
    upcoming: upcomingSprints,
    chronological: allSprints,
    refetch: refetchNextSprint,
  } = useNextSprint(workspaceId, activeNodeId, 8);

  const [filters] = useState({ sprint_id: "" });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  // Slice 7 — separate selection state for the sprint-panel tree so a
  // click on a panel row doesn't flip the backlog tree's open inline
  // form (and vice versa).
  const [panelSelectedItem, setPanelSelectedItem] = useState<WorkItem | null>(null);
  // Slice 3 — backlog multi-select. p_ObjectTree owns the live Set and
  // mirrors it here on each change so the page can drive bulk-action
  // chrome of its own (slice 6 wires the buttons; slice 3 just plumbs).
  const [backlogSelectedIds, setBacklogSelectedIds] = useState<Set<string>>(new Set());

  // Slice 5 — imperative handle so the page can force the backlog tree
  // to refetch its window after an out-of-band PATCH (the row buttons
  // hit apiSite.workItems.patch directly; the tree's internal patch
  // wrapper isn't involved).
  const backlogRefetchRef = useRef<(() => Promise<void>) | null>(null);

  // Slice 5/6/7 — radial picker open state. Single shared instance,
  // mode-tagged so onPick knows what to do with the picked sprint id:
  //
  //   { mode: "row-backlog",    rowId, anchor }    — per-row "Target Sprint"
  //                                                  on the backlog (slice 5)
  //   { mode: "row-panel",      rowId, anchor }    — per-row "Move to Sprint"
  //                                                  on the sprint panel (slice 7)
  //   { mode: "bulk-backlog",   anchor }           — bulk on backlog (slice 6)
  //   { mode: "bulk-panel",     anchor }           — bulk on sprint panel (slice 7)
  //   { mode: "switch-panel",   anchor }           — Switch Sprint affordance
  //                                                  on the sprint panel header (slice 7)
  //   { mode: "status-panel",   anchor }           — Sprint Status picker
  //                                                  (planned / active / completed).
  //                                                  Backend enforces forward-only
  //                                                  transitions; pills for illegal
  //                                                  transitions render disabled.
  type TargetMenuMode =
    | { mode: "row-backlog"; rowId: string; anchor: HTMLElement | null }
    | { mode: "row-panel"; rowId: string; anchor: HTMLElement | null }
    | { mode: "bulk-backlog"; anchor: HTMLElement | null }
    | { mode: "bulk-panel"; anchor: HTMLElement | null }
    | { mode: "switch-panel"; anchor: HTMLElement | null }
    | { mode: "status-panel"; anchor: HTMLElement | null };
  const [targetMenu, setTargetMenu] = useState<TargetMenuMode | null>(null);
  // Slice 6 — anchor ref for the bulk "Target Sprint" button in the
  // BulkActionBar. We can't grab activeElement at click-time the way
  // row buttons do (the bar's children are inside a host-owned subtree
  // we can't bind a ref into); instead we look up the button by its
  // data-action attribute once on click, which BulkActionBar stamps for
  // every leading button.
  const bulkBarRef = useRef<HTMLDivElement | null>(null);
  // Track which selection set this batch is operating against so a
  // racy click (selection changed mid-flight) doesn't quietly mutate
  // newer-selected rows.
  const bulkSelectionRef = useRef<Set<string>>(new Set());

  // Slice 7 — sprint-panel tree state. The panel shows the work items
  // assigned to a specific sprint. `panelSprintIdOverride` lets the
  // user pick a different sprint via the Switch Sprint affordance;
  // when null we fall through to useNextSprint's pick. Selection +
  // refetch + bulk snapshot mirror the backlog tree.
  const [panelSprintIdOverride, setPanelSprintIdOverride] = useState<string | null>(null);
  const [panelSelectedIds, setPanelSelectedIds] = useState<Set<string>>(new Set());
  const panelRefetchRef = useRef<(() => Promise<void>) | null>(null);
  // bulkSelectionRef (declared above) is REUSED for both backlog and
  // panel bulk paths — radial menu's bulk-* modes both read it on pick.
  // A separate ref isn't needed because only one bulk operation can be
  // in flight at a time (radial menu is a singleton).
  // Wrap the sprint-panel ObjectTree in its own ref'd div so the bulk
  // Move-to-Sprint button can locate itself via [data-action="…"]
  // without colliding with the backlog tree's bulk bar.
  const panelBulkBarRef = useRef<HTMLDivElement | null>(null);

  // Resolved sprint id for the panel — override wins, else fall back
  // to useNextSprint's pick. The matching SprintWireRow comes from the
  // upcomingSprints list (which already covers planned + active).
  const panelSprintId =
    panelSprintIdOverride ?? nextSprint?.timeboxes_sprints_id ?? null;
  // Resolve from `allSprints` first so Prev/Next navigation into completed
  // sprints (which are excluded from `upcomingSprints`) still surfaces the
  // correct title / dates / status. Fall back to upcoming + nextSprint
  // for the initial render path where allSprints hasn't loaded yet.
  const panelSprint = useMemo(
    () =>
      allSprints.find((s) => s.timeboxes_sprints_id === panelSprintId) ??
      upcomingSprints.find((s) => s.timeboxes_sprints_id === panelSprintId) ??
      nextSprint,
    [allSprints, upcomingSprints, panelSprintId, nextSprint],
  );

  // Date-driven "current" sprint — today's date falls within the
  // sprint's [start, end] window. Powers the "Current sprint" jump
  // button. Wire dates are ISO YYYY-MM-DD with no time component, so a
  // string compare against today's local-date ISO works without
  // timezone juggling. Returns null when today doesn't fall in any
  // sprint's window (e.g. between two planned sprints).
  const currentSprint = useMemo<SprintWireRow | null>(() => {
    if (allSprints.length === 0) return null;
    const t = new Date();
    const todayISO = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return (
      allSprints.find((s) => {
        const start = s.timeboxes_sprints_date_start;
        const end = s.timeboxes_sprints_date_end;
        if (!start || !end) return false;
        return start <= todayISO && todayISO <= end;
      }) ?? null
    );
  }, [allSprints]);
  // Hide the button when the panel is already on the current sprint
  // (no-op affordance reads as clutter), or when there's no current
  // sprint to jump to.
  const showCurrentSprintBtn =
    !!currentSprint &&
    currentSprint.timeboxes_sprints_id !== panelSprintId;

  // Switch-sprint button anchor ref. Lives on the panel header so the
  // user can flip between sprints without scrolling away.
  const switchSprintBtnRef = useRef<HTMLButtonElement | null>(null);
  // Prev/Next sprint navigators walk the `upcoming` list by index, anchored
  // to their own buttons. They're index-only — no menu opens — so no
  // anchor is strictly needed, but refs make focus-after-click hygienic.
  const prevSprintBtnRef = useRef<HTMLButtonElement | null>(null);
  const nextSprintBtnRef = useRef<HTMLButtonElement | null>(null);
  // Sprint Status button anchor — opens the radial picker with the three
  // lifecycle states (Planning / In Flight / Completed). The picker
  // greys-out illegal transitions; the backend re-enforces them.
  const statusSprintBtnRef = useRef<HTMLButtonElement | null>(null);

  // ObjectTreeV2 sidecars — base config is the Work Items wizard, but
  // the value-sprint backlog is intentionally narrower: stories +
  // defects only (no epics, no tasks). We override two fields after
  // slot→UUID resolution:
  //   1. createableTypeSlots → just story/defect, so the "Add" picker
  //      and create-flyout match the visible row set.
  //   2. resourceUrl → append ?item_type_id=<story_uuid>,<defect_uuid>
  //      so the backend `/work-items` handler clamps the LIST query
  //      with ANY($N::uuid[]) — same shape used by the user-facing
  //      type chip.
  const { types, loading: catalogueLoading } = useArtefactTypeCatalogue();
  // PERF (2026-05-28) — gate both ObjectTree mounts on the catalogue
  // being resolved. Without this gate, the page mounts the backlog tree
  // with `types=[]` (allowedIds resolves to empty, wizardConfig builds a
  // URL with NO item_type clamp), fires a throwaway /work-items + prefs
  // GET, then re-mounts a moment later when `types` populates — that
  // second mount fires the GETs AGAIN with the proper clamp. Net: 3
  // extra round-trips per page load (one throwaway list call + one
  // duplicate prefs + one duplicate facets, all serial). The gate
  // collapses both trees into a single correct mount once catalogue is
  // ready.
  const catalogueReady = !catalogueLoading && types.length > 0;

  // Slice 7 — factored sidecar resolver. Both the backlog tree and the
  // sprint-panel tree share the same base wizard (story + defect + risk)
  // but want different wire clamps:
  //   backlog: ?item_type_id=<ids>&sprint_id=__none__
  //                                         — items NOT yet in any sprint
  //   panel:   ?item_type_id=<ids>&sprint_id=<sprintId>
  //                                         — items assigned to the panel sprint
  //
  // The __none__ sentinel is the backend handler convention
  // (artefactitems/handler.go) for IS NULL on artefacts_id_timebox_sprint;
  // ensures backlog and sprint-panel are mutually exclusive views (an
  // item is either in the backlog OR in a sprint, never both).
  //
  // Epics and tasks are excluded by design — sprint planning is at the
  // story/defect/risk granularity. Epics group stories above the sprint
  // boundary; tasks are sub-story execution. Adding either to a sprint
  // would mis-shape the burn-down and the velocity model.
  //
  // The factory takes optional extra params + a treeName so each tree
  // gets its own private filter/sort prefs namespace.
  const buildWizardConfig = useCallback(
    (treeName: string, extraParams: string | null): ObjectTreeDataConfig => {
      const ALLOWED_SLOTS = ["wrk_story", "wrk_defect", "wrk_risk"] as const;
      const bySlot = new Map(types.map((t) => [t.slot, t.id]));
      const allowedIds = ALLOWED_SLOTS
        .map((s) => bySlot.get(s))
        .filter((id): id is string => !!id);
      const baseSidecar = {
        ...(workItemsWizardJson as unknown as Record<string, unknown>),
        createableTypeSlots: [...ALLOWED_SLOTS],
      };
      const resolvedSlots = resolveSlotRefs(baseSidecar, types);
      const resolved = resolveWizardConfig(resolvedSlots as any);
      const funcs = buildWorkItemsFunctions();
      const baseUrl = (resolved.resourceUrl as string | undefined) ?? "/work-items";
      const sep1 = baseUrl.includes("?") ? "&" : "?";
      let url = allowedIds.length
        ? `${baseUrl}${sep1}item_type_id=${allowedIds.join(",")}`
        : baseUrl;
      if (extraParams) {
        const sep2 = url.includes("?") ? "&" : "?";
        url = `${url}${sep2}${extraParams}`;
      }
      return {
        ...resolved,
        resourceUrl: url,
        treeName,
        getParentId: funcs.getParentId,
        getChildrenCount: funcs.getChildrenCount,
        searchAccessor: funcs.searchAccessor,
      } as ObjectTreeDataConfig;
    },
    [types],
  );

  // Backlog clamp: ?sprint_id=__none__ — backend sentinel for
  // artefacts_id_timebox_sprint IS NULL. Items move out of the backlog
  // the moment they're assigned to any sprint, and re-appear here when
  // removed from a sprint. The realtime refetch already wired to PATCHes
  // re-pulls both trees so the move is reflected without a manual reload.
  const wizardConfig = useMemo<ObjectTreeDataConfig>(
    () => buildWizardConfig("valuesprintbacklog", "sprint_id=__none__"),
    [buildWizardConfig],
  );

  // Slice 7 — sprint-panel wizard. Clamps to ?sprint_id=<panelSprintId>
  // so the tree only shows work items currently assigned to the panel
  // sprint. When panelSprintId is null we still mount the tree (with a
  // sentinel-empty clamp), so the user gets a "no sprint loaded" empty
  // state inside the panel rather than an unmounted void.
  // Only built when a real sprint id is loaded. The tree below is
  // gated on the same panelSprintId — no point asking the backend
  // for "sprint = none" (an earlier sentinel value of __none__ tripped
  // a 500 on the work-items handler's UUID parse).
  const panelWizardConfig = useMemo<ObjectTreeDataConfig | null>(
    () =>
      panelSprintId
        ? buildWizardConfig(
            "valuesprintplanned",
            `sprint_id=${panelSprintId}`,
          )
        : null,
    [buildWizardConfig, panelSprintId],
  );

  // Realtime refetch — same topic shape as Work Items so backlog stays
  // in sync when other clients mutate work items in this tenant. We also
  // refetch the sprint panel header so sprint name / date changes pushed
  // from another tab surface here without a manual reload.
  const refetch = useCallback(async () => {
    await refetchNextSprint();
    await backlogRefetchRef.current?.();
    await panelRefetchRef.current?.();
  }, [refetchNextSprint]);

  // ── POC: sprint boundary-drag (mounted above the legacy panels) ───────────
  // Two useTree instances over the SAME audited POST gateway the Grid pages
  // use, clamped by filters.sprintId. Sprint section = the panel sprint;
  // backlog section = unassigned (__none__). expandable:false — sprint planning
  // is a flat story/defect/risk list (no child expansion in the POC).
  const pocSprintId = panelSprintId ?? "";
  const pocSprintTree = useTree<ScopeNode>({
    fetchRoots: useCallback(
      (page: { limit: number; offset: number }) =>
        fetchSprintRoots(page, pocSprintId),
      [pocSprintId],
    ),
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: () => 0,
    fetchChildren: async () => [],
    autoLoad: !!pocSprintId,
    expandable: false,
  });
  const pocBacklogTree = useTree<ScopeNode>({
    fetchRoots: useCallback(
      (page: { limit: number; offset: number }) =>
        fetchSprintRoots(page, "__none__"),
      [],
    ),
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: () => 0,
    fetchChildren: async () => [],
    autoLoad: true,
    expandable: false,
  });

  // Columns for the POC list. Status pills + colour/form affordances are
  // intentionally inert here (this is a membership-only POC); pass no-op
  // callbacks. flowStatesByType drives the status pill rendering — an empty Map
  // makes the status pills read-only (each row shows its current status, not
  // editable: StatusCell synthesizes a pill from the row's own
  // flowStateId/flowStateName when the map is empty).
  const pocColumns = useMemo(
    () =>
      makeScopeColumns(
        () => {},
        new Map<string, WorkItemFlowState[]>(),
        () => {},
      ),
    [],
  );

  // Commit-on-drop: PATCH each crossed row's sprint_id (uuid-keyed), in
  // parallel, then refetch both POC trees + the page's existing surfaces.
  // "" removes from sprint (backend convention).
  const pocCommit = useCallback(
    async (delta: SprintBoundaryDelta) => {
      const calls: Promise<unknown>[] = [
        ...delta.toSprint.map((uuid) =>
          workItems.patch(uuid, { sprint_id: pocSprintId }),
        ),
        ...delta.toBacklog.map((uuid) =>
          workItems.patch(uuid, { sprint_id: "" }),
        ),
      ];
      const results = await Promise.allSettled(calls);
      const failed = results.filter((r) => r.status === "rejected").length;
      pocSprintTree.refresh();
      pocBacklogTree.refresh();
      await refetch();
      if (failed === 0) notify.success("Sprint membership updated.");
      else notify.error(`${failed} of ${calls.length} updates failed.`);
    },
    [pocSprintId, pocSprintTree, pocBacklogTree, refetch],
  );

  // Slice 5 — single-row assignment. PATCH work-item with the target
  // sprint_id, then refetch the backlog window + sprint panel so the
  // moved row drops out of the backlog clamp (when slice 7 clamps it)
  // and the panel's counters refresh. Tolerates 4xx/5xx by toasting
  // the API error verbatim — server stays the gate.
  const assignToSprint = useCallback(
    async (workItemId: string, sprintId: string | null) => {
      try {
        await workItems.patch(workItemId, { sprint_id: sprintId ?? "" });
        // Refetch both surfaces. Order doesn't matter — they're independent.
        await refetch();
        notify.success(
          sprintId ? "Added to sprint." : "Removed from sprint.",
        );
      } catch (err) {
        notify.apiError(err as ApiError, "Failed to update sprint assignment.");
      }
    },
    [refetch],
  );

  // Cross-tree drop landing handler. Steps:
  //   1. PATCH sprint_id to put the row in the destination scope (sprint
  //      cohort or backlog cohort — the rank service partitions by
  //      artefacts_id_timebox_sprint, so the moved row must be in the
  //      destination scope BEFORE the /rank/move call, otherwise the
  //      service returns ErrScopeMismatch).
  //   2. POST /rank/move with `before` / `after` to place the row at
  //      the exact landing slot the drop indicator showed. If no
  //      landing slot was captured (drop landed in empty space below
  //      the rows), fall back to `to_bottom` for sprint targets and
  //      `to_top` for backlog targets — backlog gets top-of-list so the
  //      removed row is immediately visible to the user (matches the
  //      "lands at the top" behaviour requested for sprint → backlog).
  //   3. Refetch both trees so the row leaves the source and appears
  //      at the new slot.
  const placeOnSprint = useCallback(
    async (
      workItemId: string,
      sprintId: string | null,
      landing: { targetId: string; pos: "above" | "below" } | undefined,
    ) => {
      try {
        await workItems.patch(workItemId, { sprint_id: sprintId ?? "" });
        const moveBody: Record<string, unknown> = {
          resource_type: "work_item",
          row_id: workItemId,
        };
        if (landing) {
          if (landing.pos === "above") moveBody.before = landing.targetId;
          else moveBody.after = landing.targetId;
        } else if (sprintId) {
          moveBody.to_bottom = true;
        } else {
          moveBody.to_top = true;
        }
        await ranking.move(moveBody);
        await refetch();
        notify.success(
          sprintId ? "Added to sprint." : "Removed from sprint.",
        );
      } catch (err) {
        notify.apiError(err as ApiError, "Failed to place row at landing slot.");
      }
    },
    [refetch],
  );
  useEffect(() => {
    void refetch();
  }, [refetch, activeNodeId, direction]);

  // Slice 6 — bulk equivalent of assignToSprint. Iterates over the
  // selected ids and fires PATCHes in parallel via Promise.all so the
  // user doesn't wait n × RTT. Failures are surfaced individually as
  // toasts; a partial-failure mode (some succeed, some don't) is
  // honest about it rather than blocking the whole batch on the first
  // error. The selection set is captured at call time so a racy
  // selection change mid-flight doesn't widen the operation.
  const assignManyToSprint = useCallback(
    async (ids: string[], sprintId: string | null) => {
      if (!ids.length) return;
      const results = await Promise.allSettled(
        ids.map((id) => workItems.patch(id, { sprint_id: sprintId ?? "" })),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      await refetch();
      if (failed === 0) {
        notify.success(
          sprintId
            ? `Added ${ids.length} item${ids.length === 1 ? "" : "s"} to sprint.`
            : `Removed ${ids.length} item${ids.length === 1 ? "" : "s"} from sprint.`,
        );
      } else if (failed === ids.length) {
        notify.error(`Failed to update ${ids.length} item${ids.length === 1 ? "" : "s"}.`);
      } else {
        notify.error(
          `Updated ${ids.length - failed} of ${ids.length} — ${failed} failed.`,
        );
      }
    },
    [refetch],
  );

  // Prev/Next sprint navigation. Walks the `chronological` list (all
  // statuses, sorted ascending by start_date) so users can step BACK into
  // completed sprints to reflect or move unfinished work forward. The
  // step-target is computed from the currently-displayed sprint id, not
  // from a local pointer, so out-of-band changes (a sprint deleted in
  // another tab, the chronological list refetched) settle correctly on
  // the next render. Disabled state is computed inline below the refs.
  const stepSprint = useCallback(
    (dir: -1 | 1) => {
      if (!panelSprintId || allSprints.length === 0) return;
      const i = allSprints.findIndex(
        (s) => s.timeboxes_sprints_id === panelSprintId,
      );
      if (i < 0) return;
      const next = allSprints[i + dir];
      if (!next) return;
      setPanelSprintIdOverride(next.timeboxes_sprints_id);
    },
    [panelSprintId, allSprints],
  );

  const sprintNavState = useMemo(() => {
    const i = panelSprintId
      ? allSprints.findIndex((s) => s.timeboxes_sprints_id === panelSprintId)
      : -1;
    return {
      hasPrev: i > 0,
      hasNext: i >= 0 && i < allSprints.length - 1,
    };
  }, [allSprints, panelSprintId]);

  // Sprint Status transitions. The backend is the gate: `planned → active`
  // via /sprints/{id}/start, `active → completed` via /sprints/{id}/close.
  // No path back: a started sprint cannot be un-started, a completed
  // sprint cannot be re-opened. The radial picker renders illegal
  // transitions disabled (mirror state below), and this callback also
  // refuses no-ops + illegal moves with a toast — defence-in-depth in
  // case a stale render somehow fires through.
  const setSprintStatus = useCallback(
    async (target: "planned" | "active" | "completed") => {
      if (!panelSprint || !workspaceId || !activeNodeId) return;
      const scopeParams = new URLSearchParams({
        workspace_id: workspaceId,
        org_node_id: activeNodeId,
      }).toString();
      const current = panelSprint.timeboxes_sprints_status ?? "";
      if (current === target) return;
      try {
        if (current === "planned" && target === "active") {
          await sprintsApi.start(panelSprint.timeboxes_sprints_id, scopeParams);
          notify.success("Sprint started.");
        } else if (current === "active" && target === "completed") {
          await sprintsApi.close(panelSprint.timeboxes_sprints_id, scopeParams);
          notify.success("Sprint completed.");
        } else {
          notify.error(
            `Cannot move sprint from "${current}" to "${target}".`,
          );
          return;
        }
        await refetch();
      } catch (err) {
        notify.apiError(err as ApiError, "Failed to change sprint status.");
      }
    },
    [panelSprint, workspaceId, activeNodeId, refetch],
  );

  // Slice 5 — per-row action buttons. "Add to Sprint" assigns the row
  // to the sprint CURRENTLY IN FOCUS on the panel above (panelSprint),
  // not the auto-picked next sprint — otherwise the Switch Sprint
  // affordance is a lie. Disabled when no panel sprint loaded.
  // "Target Sprint" opens the radial picker anchored to that button.
  const backlogRowButtons = useCallback(
    (row: WorkItem): RowButton[] => {
      const currentSprintId = panelSprint?.timeboxes_sprints_id ?? null;
      const currentSprintName = panelSprint
        ? formatSprintLabel(panelSprint)
        : "current sprint";
      return [
        {
          key: "add-to-sprint",
          label: "Add to Sprint",
          ariaLabel: currentSprintId
            ? `Add ${row.title ?? row.id} to ${currentSprintName}`
            : "No sprint in focus to add to",
          disabled: !currentSprintId,
          onClick: () => {
            if (currentSprintId) void assignToSprint(row.id, currentSprintId);
          },
          variant: "primary",
        },
        {
          key: "target-sprint",
          label: "Target Sprint",
          ariaLabel: `Pick a sprint to target for ${row.title ?? row.id}`,
          disabled: upcomingSprints.length === 0,
          onClick: () => {
            // Capture the anchoring element from the event-time
            // document focus / activeElement target. We use the
            // matching DOM node via the row's data-selection-row-id
            // hook is brittle — instead grab the currentTarget at
            // click time via the surrounding button. Stored on the
            // RowButton handler so the event captures it directly.
            // Pull the anchor off the activeElement once the click
            // fires; React already focused the button.
            const anchorEl =
              (document.activeElement as HTMLElement | null) ?? null;
            setTargetMenu({ mode: "row-backlog", rowId: row.id, anchor: anchorEl });
          },
          variant: "secondary",
        },
      ];
    },
    [panelSprint, upcomingSprints.length, assignToSprint],
  );

  // Slice 6 — bulk action buttons surfaced on the BulkActionBar (left
  // side). "Add to Sprint" runs assignManyToSprint targeting the sprint
  // IN FOCUS on the panel above (panelSprint), not the auto-picked
  // next sprint — same correctness reason as backlogRowButtons.
  // "Target Sprint" opens the same radial picker as the per-row button,
  // but with rowId: null so the onPick path knows to operate over the
  // captured selection set rather than a single row.
  const bulkLeadingButtons = useMemo(() => {
    if (backlogSelectedIds.size === 0) return undefined;
    const currentSprintId = panelSprint?.timeboxes_sprints_id ?? null;
    return [
      {
        key: "bulk-add-to-sprint",
        label: `Add ${backlogSelectedIds.size} to Sprint`,
        ariaLabel: currentSprintId
          ? `Add ${backlogSelectedIds.size} selected item${backlogSelectedIds.size === 1 ? "" : "s"} to ${panelSprint ? formatSprintLabel(panelSprint) : "sprint"}`
          : "No sprint in focus to add to",
        disabled: !currentSprintId,
        onClick: currentSprintId
          ? () => {
              const ids = Array.from(backlogSelectedIds);
              void assignManyToSprint(ids, currentSprintId);
            }
          : undefined,
        variant: "primary" as const,
      },
      {
        key: "bulk-target-sprint",
        label: "Target Sprint",
        ariaLabel: `Pick a target sprint for ${backlogSelectedIds.size} selected item${backlogSelectedIds.size === 1 ? "" : "s"}`,
        disabled: upcomingSprints.length === 0,
        onClick:
          upcomingSprints.length === 0
            ? undefined
            : () => {
                // Snapshot the selection at click time. The radial
                // menu callback later reads bulkSelectionRef so a
                // selection change between click and pick doesn't
                // widen the batch.
                bulkSelectionRef.current = new Set(backlogSelectedIds);
                const btn = bulkBarRef.current?.querySelector(
                  '[data-action="bulk-target-sprint"]',
                ) as HTMLElement | null;
                setTargetMenu({ mode: "bulk-backlog", anchor: btn });
              },
        variant: "secondary" as const,
      },
    ];
  }, [
    backlogSelectedIds,
    panelSprint,
    upcomingSprints.length,
    assignManyToSprint,
  ]);

  // Slice 7 — per-row buttons for the SPRINT PANEL tree. Mirrors the
  // backlog tree's buttons but in reverse: "Remove from Sprint" pushes
  // the row back to the backlog (sprint_id = ""), and "Move to Sprint"
  // re-targets it to a different sprint via the same radial picker.
  const panelRowButtons = useCallback(
    (row: WorkItem): RowButton[] => {
      return [
        {
          key: "remove-from-sprint",
          label: "Remove",
          ariaLabel: `Remove ${row.title ?? row.id} from this sprint`,
          onClick: () => void assignToSprint(row.id, null),
          variant: "secondary",
        },
        {
          key: "move-to-sprint",
          label: "Move to Sprint",
          ariaLabel: `Pick a different sprint for ${row.title ?? row.id}`,
          disabled: upcomingSprints.length === 0,
          onClick: () => {
            const anchorEl =
              (document.activeElement as HTMLElement | null) ?? null;
            setTargetMenu({ mode: "row-panel", rowId: row.id, anchor: anchorEl });
          },
          variant: "ghost",
        },
      ];
    },
    [assignToSprint, upcomingSprints.length],
  );

  // Slice 7 — bulk-leading buttons for the SPRINT PANEL tree.
  // "Remove from Sprint Backlog" clears sprint_id on every selected row.
  // "Move to Sprint" opens the radial picker in bulk-panel mode.
  const panelBulkLeadingButtons = useMemo(() => {
    if (panelSelectedIds.size === 0) return undefined;
    return [
      {
        key: "panel-bulk-remove",
        label: `Remove ${panelSelectedIds.size} from Sprint Backlog`,
        ariaLabel: `Remove ${panelSelectedIds.size} selected item${panelSelectedIds.size === 1 ? "" : "s"} from sprint`,
        onClick: () => {
          const ids = Array.from(panelSelectedIds);
          void assignManyToSprint(ids, null);
        },
        variant: "secondary" as const,
      },
      {
        key: "panel-bulk-move",
        label: "Move to Sprint",
        ariaLabel: `Pick a target sprint for ${panelSelectedIds.size} selected item${panelSelectedIds.size === 1 ? "" : "s"}`,
        disabled: upcomingSprints.length === 0,
        onClick:
          upcomingSprints.length === 0
            ? undefined
            : () => {
                // bulkSelectionRef is reused by the radial onPick handler
                // for bulk-panel mode (same callback shape as bulk-backlog).
                bulkSelectionRef.current = new Set(panelSelectedIds);
                const btn = panelBulkBarRef.current?.querySelector(
                  '[data-action="panel-bulk-move"]',
                ) as HTMLElement | null;
                setTargetMenu({ mode: "bulk-panel", anchor: btn });
              },
        variant: "primary" as const,
      },
    ];
  }, [panelSelectedIds, upcomingSprints.length, assignManyToSprint]);

  const subscriptionID = sentinel_tenant?.id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  // Keep the POC trees reconciled with realtime pushes + legacy-panel edits.
  // The page's primary useRefetchOnPush refreshes the LEGACY surfaces via
  // `refetch`; this second subscription (same topic) refreshes the POC trees so
  // a membership edit made in the legacy panel below — or pushed from another
  // tab — is reflected in the boundary list above. This is what makes the
  // "both editable, realtime reconciles" design actually hold.
  const pocRefetch = useCallback(async () => {
    pocSprintTree.refresh();
    pocBacklogTree.refresh();
  }, [pocSprintTree, pocBacklogTree]);
  useRefetchOnPush({ topic, refetch: pocRefetch });

  return (
    <PageContent className="value-sprint">
      <>
        <PageHeading
          level={1}
          title={full}
          subtitle={
            backlogSelectedIds.size > 0
              ? `${backlogSelectedIds.size} selected — use the bulk bar to add or target a sprint.`
              : "Plan the active sprint — drag items from the backlog into the sprint panel."
          }
        />
        <PageDescription>
          Manage the active sprint. The grid below is the workspace backlog (same clamp as Work Items). Drag stories onto the sprint to commit them.
        </PageDescription>

        {/* ── POC: Jira-style sprint boundary-drag (above the legacy panels) ──
            New build per docs/superpowers/specs/2026-06-07-sprint-boundary-drag-design.md.
            Membership-only, commit-on-drop. The two legacy panels below remain
            fully editable; a dedicated realtime subscription (pocRefetch)
            refreshes this POC list when membership changes there or in another
            tab. */}
        {catalogueReady && panelSprintId && (
          <Panel
            name="panel_value_sprint_boundary_poc"
            className="page-panel-heading value-sprint__boundary-poc"
            title="Sprint planning (boundary-drag POC)"
            description="Drag the divider down to commit backlog rows into the sprint; drag up to release them. Membership saves on release."
          >
            <GridSprintBoundary
              sprintTree={pocSprintTree}
              backlogTree={pocBacklogTree}
              columns={pocColumns}
              commit={pocCommit}
            />
          </Panel>
        )}

        {/* Top panel — sprint scope. Title + description reflect the
            currently-displayed sprint (which defaults to useNextSprint's
            pick but can be overridden via the Switch Sprint button).
            The body is now a live ObjectTreeV2 clamped to the sprint's
            work items rather than a static drop-zone placeholder. */}
        <Panel
          name="panel_value_sprint_target"
          className="page-panel-heading value-sprint__target"
          title={panelSprint ? formatSprintLabel(panelSprint) : "No upcoming sprint"}
          description={
            panelSprint ? (
              <>
                <BsCalendar3 aria-hidden /> {panelSprint.timeboxes_sprints_date_start ?? "—"} → {panelSprint.timeboxes_sprints_date_end ?? "—"} · status {panelSprint.timeboxes_sprints_status ?? "—"}
              </>
            ) : (
              "Create a planned sprint to begin — the next future-dated sprint will surface here automatically."
            )
          }
        >
          {/* Sprint-backlog tree renders BARE (no title / addressableName)
              so it doesn't nest a Panel inside this outer Panel. The
              outer Panel owns the chrome; the tree owns the table.
              Mounted only when a sprint is loaded — see panelWizardConfig
              for the rationale.

              Switch Sprint affordance is injected onto the ActionBar via
              actionBarLeading so it sits before "Create New" with the
              same chip styling. Disabled when fewer than two upcoming
              sprints exist (no point switching away from the only
              candidate). */}
          {catalogueReady && panelWizardConfig && (
            <div ref={panelBulkBarRef}>
              <ObjectTree
                title="Sprint backlog"
                subtitleBadge="00"
                subtitle="Sprint scope"
                description="Load artefacts here for the target sprint"
                selectedId={panelSelectedItem?.id ?? null}
                onSelect={setPanelSelectedItem}
                wizardConfig={panelWizardConfig}
                multiSelectEnabled
                onSelectionChange={setPanelSelectedIds}
                rowButtons={panelRowButtons}
                hideCogMenu
                hideExpanders
                urlPrefix="panel"
                dropColumnKeys={PANEL_DROP_COLS}
                refetchRef={panelRefetchRef}
                bulkLeadingButtons={panelBulkLeadingButtons}
                onExternalDrop={(rowId, landing) => {
                  if (!panelSprintId) return;
                  void placeOnSprint(rowId, panelSprintId, landing);
                }}
                actionBarLeading={
                  <>
                    {sprintNavState.hasPrev && (
                      <button
                        ref={prevSprintBtnRef}
                        type="button"
                        className="btn"
                        onClick={() => stepSprint(-1)}
                        aria-label="Previous sprint"
                        title="Previous sprint"
                      >
                        <span className="btn__icon">
                          <MdChevronLeft size={14} />
                        </span>
                        <span>Prev</span>
                      </button>
                    )}
                    {sprintNavState.hasNext && (
                      <button
                        ref={nextSprintBtnRef}
                        type="button"
                        className="btn"
                        onClick={() => stepSprint(1)}
                        aria-label="Next sprint"
                        title="Next sprint"
                      >
                        <span>Next</span>
                        <span className="btn__icon">
                          <MdChevronRight size={14} />
                        </span>
                      </button>
                    )}
                    {showCurrentSprintBtn && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          if (currentSprint) {
                            setPanelSprintIdOverride(
                              currentSprint.timeboxes_sprints_id,
                            );
                          }
                        }}
                        aria-label="Jump to the current sprint (today's date)"
                        title="Jump to the sprint that today's date falls within"
                      >
                        <span className="btn__icon">
                          <BsCalendar3 aria-hidden />
                        </span>
                        <span>Current sprint</span>
                      </button>
                    )}
                    <button
                      ref={switchSprintBtnRef}
                      type="button"
                      className="btn"
                      disabled={upcomingSprints.length < 2}
                      onClick={() =>
                        setTargetMenu({
                          mode: "switch-panel",
                          anchor: switchSprintBtnRef.current,
                        })
                      }
                      aria-label="Switch the displayed sprint"
                    >
                      <span>Switch sprint</span>
                    </button>
                    <button
                      ref={statusSprintBtnRef}
                      type="button"
                      className="btn"
                      disabled={!panelSprint}
                      onClick={() =>
                        setTargetMenu({
                          mode: "status-panel",
                          anchor: statusSprintBtnRef.current,
                        })
                      }
                      aria-label={`Sprint status — ${panelSprint?.timeboxes_sprints_status ?? "—"}`}
                      title="Change sprint status"
                    >
                      <span className="btn__icon">
                        <MdOutlineFlag size={14} />
                      </span>
                      <span>Sprint Status</span>
                    </button>
                  </>
                }
                columnsControlRef={panelBind.columnsControlRef}
                onColumnsChange={panelBind.onColumnsChange}
              />
            </div>
          )}
        </Panel>

        {/* Bottom panel — workspace backlog (ObjectTreeV2, clamp = Work Items).
            Renders unconditionally; ObjectTree shows its own loader while the
            artefact-type catalogue resolves. Work Items keeps the types guard
            because its summary cells depend on the catalogue; we don't. */}
        {/* Wrap the backlog ObjectTree in a ref'd div so the bulk
            "Target Sprint" button click handler can locate itself via
            [data-action="bulk-target-sprint"] for the radial menu's
            anchor. The data-action attribute is stamped on every leading
            button by BulkActionBar. */}
        <div ref={bulkBarRef}>
          {catalogueReady && (
            <ObjectTree
              title="Backlog"
              addressableName="value_sprint_backlog_tree_ll"
              subtitleBadge="00"
              subtitle="Workspace backlog"
              description="All work items in scope. Drag rows onto the sprint above to commit them."
              selectedId={selectedItem?.id ?? null}
              onSelect={setSelectedItem}
              wizardConfig={wizardConfig}
              multiSelectEnabled
              onSelectionChange={setBacklogSelectedIds}
              rowButtons={backlogRowButtons}
              hideCogMenu
              urlPrefix="backlog"
              dropColumnKeys={BACKLOG_DROP_COLS}
              refetchRef={backlogRefetchRef}
              bulkLeadingButtons={bulkLeadingButtons}
              columnsControlRef={backlogBind.columnsControlRef}
              onColumnsChange={backlogBind.onColumnsChange}
              onExternalDrop={(rowId, landing) => {
                // Reverse direction: dropping a sprint-panel row on the
                // backlog removes it from the current sprint (sprint_id="")
                // and places at the captured slot — or at the TOP when
                // dropped on empty space, so the removed row surfaces
                // immediately in the user's view.
                void placeOnSprint(rowId, null, landing);
              }}
            />
          )}
        </div>

        {/* Slice 5 — radial picker. Open state is page-owned so the same
            instance services every row's "Target Sprint" button AND the
            Sprint Status picker. Items + aria-label switch on mode; the
            onPick id is a sprint UUID for sprint-target modes and one of
            "planned"/"active"/"completed" for the status-panel mode. We
            re-bind onPick to the currently-open row id so a stale
            closure can't fire a PATCH against the wrong work item. */}
        <RadialPillMenu
          open={!!targetMenu}
          anchor={targetMenu?.anchor ?? null}
          items={
            targetMenu?.mode === "status-panel"
              ? (() => {
                  // Backend state machine (timeboxsprints/sql.go):
                  //   planned → active   via /sprints/{id}/start
                  //   active  → completed via /sprints/{id}/close
                  // No reverse paths; PATCH on status is also blocked
                  // for these transitions. The pill list always shows
                  // all 3 states so the user has the full mental model,
                  // but illegal moves render disabled.
                  const cur = panelSprint?.timeboxes_sprints_status ?? "";
                  const legal = (target: string): boolean => {
                    if (cur === target) return false;
                    if (cur === "planned" && target === "active") return true;
                    if (cur === "active" && target === "completed") return true;
                    return false;
                  };
                  return [
                    { id: "planned", label: "Planning", disabled: !legal("planned"), current: cur === "planned" },
                    { id: "active", label: "In Flight", disabled: !legal("active"), current: cur === "active" },
                    { id: "completed", label: "Completed", disabled: !legal("completed"), current: cur === "completed" },
                  ];
                })()
              : upcomingSprints.map((s) => ({
                  id: s.timeboxes_sprints_id,
                  label: formatSprintLabel(s) || "Sprint",
                }))
          }
          maxItems={8}
          ariaLabel={
            targetMenu?.mode === "status-panel"
              ? "Pick a sprint status"
              : "Pick a target sprint"
          }
          onPick={(pickedId) => {
            if (!targetMenu) return;
            switch (targetMenu.mode) {
              case "row-backlog":
                void assignToSprint(targetMenu.rowId, pickedId);
                break;
              case "row-panel":
                // Move from one sprint to another — same PATCH, just
                // anchored on a panel row.
                void assignToSprint(targetMenu.rowId, pickedId);
                break;
              case "bulk-backlog": {
                const ids = Array.from(bulkSelectionRef.current);
                void assignManyToSprint(ids, pickedId);
                break;
              }
              case "bulk-panel": {
                const ids = Array.from(bulkSelectionRef.current);
                void assignManyToSprint(ids, pickedId);
                break;
              }
              case "switch-panel":
                // Slice 7 — switch the panel's currently-displayed
                // sprint. Local state only; the data hook on the
                // sprint-backlog ObjectTree re-fires when resourceUrl
                // changes (it carries panelSprintId).
                setPanelSprintIdOverride(pickedId);
                break;
              case "status-panel":
                // pickedId is the target lifecycle state, not a UUID.
                if (pickedId === "planned" || pickedId === "active" || pickedId === "completed") {
                  void setSprintStatus(pickedId);
                }
                break;
            }
          }}
          onClose={() => setTargetMenu(null)}
        />
      </>
    </PageContent>
  );
}
