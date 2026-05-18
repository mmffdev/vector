"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import { apiSite } from "@/app/lib/api";
import ObjectTree, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTree/p_ObjectTree";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useAuth } from "@/app/contexts/AuthContext";
import { useHintOnce } from "@/app/lib/hints";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import workItemsWizardJson from "@/app/components/ObjectTree/configs/p_wizard_workitems.json";

export default function WorkItemsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
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

  const wizardConfig = useMemo<ObjectTreeDataConfig>(() => {
    const resolved = resolveWizardConfig(workItemsWizardJson as any);
    const funcs = buildWorkItemsFunctions();
    return {
      ...resolved,
      getParentId: funcs.getParentId,
      getChildrenCount: funcs.getChildrenCount,
      searchAccessor: funcs.searchAccessor,
      // filterChips is provided by ObjectTree itself based on
      // filterChipsComponent — page no longer wires the React element.
    } as ObjectTreeDataConfig;
  }, []);

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

  useEffect(() => {
    void refetchSummary();
  }, [refetchSummary]);

  const subscriptionID = user?.subscription_id ?? null;
  const sprintID = filters.sprint_id || null;
  const topic = subscriptionID
    ? sprintID
      ? rankTopic("work_item", subscriptionID, "sprint", sprintID)
      : rankTopic("work_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  const summaryCells = useMemo(() => {
    const s = summary ?? { total: 0, blocked: 0, by_type: {} };
    const byType = s.by_type ?? {};
    return [
      { label: "TOTAL ITEMS", value: s.total },
      { label: "EPICS", value: byType.epic ?? 0 },
      { label: "TASKS", value: byType.task ?? 0 },
      { label: "DEFECTS", value: byType.defect ?? 0, tone: "warning" as const },
      { label: "RISKS", value: byType.risk ?? 0, tone: "warning" as const, glyph: "issue" as const }, // PLA-0052
      { label: "BLOCKED", value: s.blocked, tone: "warning" as const, glyph: "issue" as const },
    ];
  }, [summary]);

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
    </>
    </PageContent>
  );
}
