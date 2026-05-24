"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import VisualisationPanel from "@/app/components/VisualisationPanel";
import { apiSite } from "@/app/lib/api";
import ObjectTree, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTreeV2/p_ObjectTree";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useSentinel } from "@/app/sentinel";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { useHintOnce } from "@/app/lib/hints";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import { resolveSlotRefs } from "@/app/lib/sidecarSlotResolver";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";

export default function WorkItemsPage() {
  const { full } = usePageTitle();
  // PLA062 S10: this page reads identity + tenant + scope from Sentinel.
  // The `direction` field that ScopeContext used to expose is derived
  // here from sentinel_scope_up / sentinel_scope_down (Rally idiom).
  const {
    sentinel_tenant,
    sentinel_focus_node,
    sentinel_scope_up,
    sentinel_scope_down,
  } = useSentinel();
  const activeNodeId = sentinel_focus_node;
  const direction = sentinel_scope_down ? "descend" : sentinel_scope_up ? "ascend" : "none";
  useHintOnce("WORK_ITEMS_FIRST_VISIT");
  const [filters] = useState({ sprint_id: "" });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  // TD-WORKITEMS-GENERIC pay-down (2026-05-16): backend dropped the fixed
  // per-type fields on /work-items/summary; everything ships via by_type.
  // Frontend reads by_type[<lowercased type name>] for per-type counts.
  const [summary, setSummary] = useState<{
    total: number;
    blocked: number;
    by_type: Record<string, number>;
  } | null>(null);

  // ObjectTreeV2 sidecars carry createableTypeSlots (e.g. ["wrk_story",
  // "wrk_defect", "wrk_task", "wrk_epic"]) which resolveSlotRefs rewrites
  // to createableTypeIds at mount. On first render before the catalogue
  // resolves, the slot list stays unresolved and the grid waits.
  const { types } = useArtefactTypeCatalogue();
  const wizardConfig = useMemo<ObjectTreeDataConfig>(() => {
    const resolvedSlots = resolveSlotRefs(
      workItemsWizardJson as unknown as Record<string, unknown>,
      types,
    );
    const resolved = resolveWizardConfig(resolvedSlots as any);
    const funcs = buildWorkItemsFunctions();
    return {
      ...resolved,
      getParentId: funcs.getParentId,
      getChildrenCount: funcs.getChildrenCount,
      searchAccessor: funcs.searchAccessor,
      // filterChips is provided by ObjectTree itself based on
      // filterChipsComponent — page no longer wires the React element.
    } as ObjectTreeDataConfig;
  }, [types]);

  const refetchSummary = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.sprint_id) params.set("sprint_id", filters.sprint_id);
    const qs = params.toString();
    return apiSite<{
      total: number;
      blocked: number;
      by_type: Record<string, number>;
    }>(`/work-items/summary${qs ? "?" + qs : ""}`)
      .then((r) => setSummary(r))
      .catch(() => setSummary(null));
  }, [filters.sprint_id]);

  const refetch = useCallback(() => {
    return refetchSummary();
  }, [refetchSummary]);

  // Re-fire on scope change — see portfolio-items/page.tsx for the full
  // rationale (?meg= URL state + ScopeContext.activeNodeId both drive
  // the wire-request scope clamp; effect must depend on the latter).
  useEffect(() => {
    void refetchSummary();
  }, [refetchSummary, activeNodeId, direction]);

  const subscriptionID = sentinel_tenant?.id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  // Single source of truth for "which artefact types this page surfaces"
  // — the wizard's createableTypeSlots resolved through the catalogue.
  // Drives both the summary cells AND the visualisation petals, so a
  // sidecar edit (add Story, drop Defect, etc.) ripples through both
  // and they can't drift. Order follows catalogue sort_order, matching
  // the create-new dropdown and the filter chips.
  const surfacedTypes = useMemo(() => {
    const slots = (workItemsWizardJson as { createableTypeSlots?: string[] })
      .createableTypeSlots ?? [];
    const bySlot = new Map(types.map((t) => [t.slot, t]));
    return slots
      .map((slot) => bySlot.get(slot))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [types]);

  const summaryCells = useMemo(() => {
    const s = summary ?? { total: 0, blocked: 0, by_type: {} };
    const byType = s.by_type ?? {};
    const typeCells = surfacedTypes.map((t) => ({
      label: t.name.toUpperCase(),
      value: byType[t.name.toLowerCase()] ?? 0,
    }));
    return [
      { label: "TOTAL ITEMS", value: s.total },
      ...typeCells,
      { label: "BLOCKED", value: s.blocked, tone: "warning" as const, glyph: "issue" as const },
    ];
  }, [summary, surfacedTypes]);

  const petalKeys = useMemo(
    () => surfacedTypes.map((t) => ({ key: t.name.toLowerCase(), label: t.name })),
    [surfacedTypes],
  );

  return (
    <PageContent>
    <>
      <PageHeading level={1} title={full} subtitle="Browse and manage work items across the workspace." />
      <Panel
        name="panel_work_items_header"
        className="page-panel-heading"
        title="Work Items"
        description="View, filter, sort, and manage all work items tracked in this workspace."
      />
      <PageSummaryHeader cells={summaryCells} />
      <VisualisationPanel
        pageKey="work_items"
        petalKeys={petalKeys}
        total={summary?.total ?? 0}
        byType={summary?.by_type ?? {}}
        treeResourceUrl="/work-items"
      />

      {types.length > 0 && (
        <ObjectTree
          title="Work items"
          addressableName="work_items_grid_tree_ll"
          subtitleBadge="05"
          subtitle="Dense grid"
          description="Spreadsheet-fast. 28px rows, single-character status, mono ID column."
          selectedId={selectedItem?.id ?? null}
          onSelect={setSelectedItem}
          onPatched={(body) => {
            const needsRefetch = "story_points" in body || "title" in body;
            if (needsRefetch) void refetch();
          }}
          wizardConfig={wizardConfig}
        />
      )}
    </>
    </PageContent>
  );
}
