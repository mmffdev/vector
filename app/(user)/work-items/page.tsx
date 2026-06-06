"use client";

// /work-items — Grid-based surface. Swapped off the retiring ObjectTreeV2 onto
// the Grid primitive via <GridWorkItems> (an independent copy of /scope's
// GridExecution). See docs/superpowers/specs/2026-06-06-work-items-grid-swap-design.md.
//
// The rich page chrome (heading + KPI summary strip + visualisation petals) is
// preserved from the old page — only the grid BODY changed (ObjectTreeV2 →
// Grid). The summary fetch below drives PageSummaryHeader + VisualisationPanel;
// GridWorkItems owns the tree itself (rows, filters, detail flyout, the
// Dependencies button that the old ObjectTreeV2 body left unwired).
//
// The original ObjectTreeV2 page is preserved verbatim at /work-items-2 as a
// safety net while this surface is finished.

import React, { useState, useCallback, useEffect, useMemo } from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import VisualisationPanel from "@/app/components/VisualisationPanel";
import { apiSite } from "@/app/lib/api";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useSentinel } from "@/app/sentinel";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { useHintOnce } from "@/app/lib/hints";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";
import { GridWorkItems } from "./GridWorkItems";

export default function WorkItemsPage() {
  const { full } = usePageTitle();
  // PLA062 S10: identity + tenant + scope come from Sentinel. `direction` is
  // derived from sentinel_scope_up / sentinel_scope_down (Rally idiom).
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
  // TD-WORKITEMS-GENERIC pay-down (2026-05-16): /work-items/summary ships every
  // per-type count via by_type[<lowercased type name>].
  const [summary, setSummary] = useState<{
    total: number;
    blocked: number;
    by_type: Record<string, number>;
  } | null>(null);

  const { types } = useArtefactTypeCatalogue();

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

  // Re-fire on scope change — ?meg= URL state + sentinel focus both drive the
  // wire-request scope clamp; the effect must depend on the latter.
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
  useRefetchOnPush({ topic, refetch: refetchSummary });

  // Single source of truth for "which artefact types this page surfaces" — the
  // wizard's createableTypeSlots resolved through the catalogue. Drives both the
  // summary cells AND the visualisation petals so they can't drift.
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

      <GridWorkItems />
    </>
    </PageContent>
  );
}
