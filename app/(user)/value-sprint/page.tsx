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
import { useNextSprint, useUpcomingSprints } from "@/app/hooks/useNextSprint";
import { workItems } from "@/app/lib/apiSite";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

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
  } = useSentinel();
  const activeNodeId = sentinel_focus_node;
  const direction = sentinel_scope_down ? "descend" : sentinel_scope_up ? "ascend" : "none";

  // Slice 1 — live "next sprint" lookup for the top panel. Workspace ID
  // comes from the JWT-derived sentinel_user (matches the sprints page);
  // the topology focus node is passed so the backend's slice-5B ancestor
  // walk fires when the user is viewing a child node of a propagated
  // sprint, same as TimeboxObjectTree's reload().
  const workspaceId = sentinel_user?.workspace_id ?? null;
  const { sprint: nextSprint, refetch: refetchNextSprint } = useNextSprint(
    workspaceId,
    activeNodeId,
  );
  // Slice 5 — feeds the "Target Sprint" radial picker (up to 8 sprints
  // sorted by start_date asc, including the active one if any).
  const { sprints: upcomingSprints } = useUpcomingSprints(
    workspaceId,
    activeNodeId,
    8,
  );

  const [filters] = useState({ sprint_id: "" });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  // Slice 3 — backlog multi-select. p_ObjectTree owns the live Set and
  // mirrors it here on each change so the page can drive bulk-action
  // chrome of its own (slice 6 wires the buttons; slice 3 just plumbs).
  const [backlogSelectedIds, setBacklogSelectedIds] = useState<Set<string>>(new Set());

  // Slice 5 — imperative handle so the page can force the backlog tree
  // to refetch its window after an out-of-band PATCH (the row buttons
  // hit apiSite.workItems.patch directly; the tree's internal patch
  // wrapper isn't involved).
  const backlogRefetchRef = useRef<(() => Promise<void>) | null>(null);

  // Slice 5 — radial picker open state. We track BOTH the row id and the
  // anchor button element so the menu glues to the right button. Closing
  // clears both.
  const [targetMenu, setTargetMenu] = useState<{
    rowId: string;
    anchor: HTMLElement | null;
  } | null>(null);

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
  const { types } = useArtefactTypeCatalogue();
  const wizardConfig = useMemo<ObjectTreeDataConfig>(() => {
    const ALLOWED_SLOTS = ["wrk_story", "wrk_defect"] as const;
    // Resolve allowed slot → UUID from the catalogue.
    const bySlot = new Map(types.map((t) => [t.slot, t.id]));
    const allowedIds = ALLOWED_SLOTS
      .map((s) => bySlot.get(s))
      .filter((id): id is string => !!id);
    // Build a narrowed sidecar before slot resolution so the resolver
    // doesn't promote the full slot list into createableTypeIds.
    const baseSidecar = {
      ...(workItemsWizardJson as unknown as Record<string, unknown>),
      createableTypeSlots: [...ALLOWED_SLOTS],
    };
    const resolvedSlots = resolveSlotRefs(baseSidecar, types);
    const resolved = resolveWizardConfig(resolvedSlots as any);
    const funcs = buildWorkItemsFunctions();
    // Clamp the list query to story+defect at the wire. Append onto
    // resourceUrl with `&` if it already has params, `?` otherwise —
    // matches the same sep logic in useObjectTreeWindow.
    const baseUrl = (resolved.resourceUrl as string | undefined) ?? "/work-items";
    const sep = baseUrl.includes("?") ? "&" : "?";
    const clampedUrl = allowedIds.length
      ? `${baseUrl}${sep}item_type_id=${allowedIds.join(",")}`
      : baseUrl;
    return {
      ...resolved,
      resourceUrl: clampedUrl,
      // Private filter/sort prefs namespace — without this, the backlog
      // grid shares `workitems.filters` with /work-items, so a type-chip
      // narrowing there would leak into this page (and vice versa).
      treeName: "valuesprintbacklog",
      getParentId: funcs.getParentId,
      getChildrenCount: funcs.getChildrenCount,
      searchAccessor: funcs.searchAccessor,
    } as ObjectTreeDataConfig;
  }, [types]);

  // Realtime refetch — same topic shape as Work Items so backlog stays
  // in sync when other clients mutate work items in this tenant. We also
  // refetch the sprint panel header so sprint name / date changes pushed
  // from another tab surface here without a manual reload.
  const refetch = useCallback(async () => {
    await refetchNextSprint();
    await backlogRefetchRef.current?.();
  }, [refetchNextSprint]);

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
  useEffect(() => {
    void refetch();
  }, [refetch, activeNodeId, direction]);

  // Slice 5 — per-row action buttons. "Add to Sprint" assigns the row
  // to the current next-sprint (disabled when none loaded). "Target
  // Sprint" opens the radial picker anchored to that button. The
  // callback closes over nextSprint + assignToSprint; each row's
  // buttons get fresh closures per render (cheap).
  const backlogRowButtons = useCallback(
    (row: WorkItem): RowButton[] => {
      const currentSprintId = nextSprint?.timeboxes_sprints_id ?? null;
      const currentSprintName =
        nextSprint?.timeboxes_sprints_name ?? "current sprint";
      return [
        {
          key: "add-to-sprint",
          label: "Add to Sprint",
          ariaLabel: currentSprintId
            ? `Add ${row.title ?? row.id} to ${currentSprintName}`
            : "No upcoming sprint to add to",
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
            setTargetMenu({ rowId: row.id, anchor: anchorEl });
          },
          variant: "secondary",
        },
      ];
    },
    [nextSprint, upcomingSprints.length, assignToSprint],
  );

  const subscriptionID = sentinel_tenant?.id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  return (
    <PageContent>
      <>
        <PageHeading
          level={1}
          title={full}
          subtitle={
            backlogSelectedIds.size > 0
              ? `${backlogSelectedIds.size} selected — bulk-action chrome lands in slice 6.`
              : "Plan the active sprint — drag items from the backlog into the sprint panel."
          }
        />
        <PageDescription>
          Manage the active sprint. The top panel holds the sprint scope; the bottom grid is the workspace backlog (same clamp as Work Items). Drag stories from the backlog onto the sprint to commit them.
        </PageDescription>

        {/* Top panel — target sprint drop zone (DnD wiring lands next).
            Title + description are now live from useNextSprint; if no
            planned/active sprint is found we show a "no upcoming sprint"
            placeholder rather than fabricating "Sprint 1". */}
        <Panel
          name="panel_value_sprint_target"
          className="page-panel-heading value-sprint__target"
          title={nextSprint?.timeboxes_sprints_name ?? "No upcoming sprint"}
          description={
            nextSprint
              ? `${nextSprint.timeboxes_sprints_date_start ?? "—"} → ${nextSprint.timeboxes_sprints_date_end ?? "—"} · status ${nextSprint.timeboxes_sprints_status ?? "—"}`
              : "Create a planned sprint to begin — the next future-dated sprint will surface here automatically."
          }
        >
          <div className="value-sprint__Dropzone" role="region" aria-label="Sprint drop zone">
            <div className="value-sprint__Dropzone_body">
              <strong className="value-sprint__Dropzone_title">Plan your sprint</strong>
              <p className="value-sprint__Dropzone_copy">
                Drag work items from the Backlog below, or create new ones to plan the work for this sprint. Select Start sprint when you&rsquo;re ready.
              </p>
            </div>
          </div>
        </Panel>

        {/* Bottom panel — workspace backlog (ObjectTreeV2, clamp = Work Items).
            Renders unconditionally; ObjectTree shows its own loader while the
            artefact-type catalogue resolves. Work Items keeps the types guard
            because its summary cells depend on the catalogue; we don't. */}
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
          refetchRef={backlogRefetchRef}
        />

        {/* Slice 5 — radial picker. Open state is page-owned so the same
            instance services every row's "Target Sprint" button. We
            re-bind onPick to the currently-open row id so a stale
            closure can't fire a PATCH against the wrong work item. */}
        <RadialPillMenu
          open={!!targetMenu}
          anchor={targetMenu?.anchor ?? null}
          items={upcomingSprints.map((s) => ({
            id: s.timeboxes_sprints_id,
            label: s.timeboxes_sprints_name ?? "Sprint",
          }))}
          maxItems={8}
          ariaLabel="Pick a target sprint"
          onPick={(sprintId) => {
            if (targetMenu) void assignToSprint(targetMenu.rowId, sprintId);
          }}
          onClose={() => setTargetMenu(null)}
        />
      </>
    </PageContent>
  );
}
