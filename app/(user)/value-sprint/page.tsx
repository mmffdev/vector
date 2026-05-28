"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import ObjectTree, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTreeV2/p_ObjectTree";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useSentinel } from "@/app/sentinel";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import { resolveSlotRefs } from "@/app/lib/sidecarSlotResolver";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useNextSprint } from "@/app/hooks/useNextSprint";

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

  const [filters] = useState({ sprint_id: "" });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

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
  }, [refetchNextSprint]);
  useEffect(() => {
    void refetch();
  }, [refetch, activeNodeId, direction]);

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
        <PageHeading level={1} title={full} subtitle="Plan the active sprint — drag items from the backlog into the sprint panel." />
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
        />
      </>
    </PageContent>
  );
}
