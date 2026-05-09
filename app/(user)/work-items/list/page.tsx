"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import Panel from "@/app/components/Panel";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import { apiV2 } from "@/app/lib/api";
import ObjectTree, { type WorkItem } from "@/app/components/p_ObjectTree";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useAuth } from "@/app/contexts/AuthContext";
import { useHintOnce } from "@/app/lib/hints";

export default function WorkItemsListPage() {
  const { user } = useAuth();
  useHintOnce("WORK_ITEMS_FIRST_VISIT");
  const [filters] = useState({ sprint_id: "" });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    epics: number;
    stories: number;
    tasks: number;
    defects: number;
    blocked: number;
  } | null>(null);

  const refetchSummary = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.sprint_id) params.set("sprint_id", filters.sprint_id);
    const qs = params.toString();
    return apiV2<{
      total: number;
      epics: number;
      stories: number;
      tasks: number;
      defects: number;
      blocked: number;
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
    const s = summary ?? { total: 0, epics: 0, stories: 0, tasks: 0, defects: 0, blocked: 0 };
    return [
      { label: "TOTAL ITEMS", value: s.total },
      { label: "EPICS", value: s.epics },
      { label: "TASKS", value: s.tasks },
      { label: "DEFECTS", value: s.defects, tone: "warning" as const },
      { label: "BLOCKED", value: s.blocked, tone: "warning" as const, glyph: "issue" as const },
    ];
  }, [summary]);

  return (
    <>
      <PageSummaryHeader cells={summaryCells} />

      <Panel name="work_items_grid_tree_ll" title="Work items">
        <ObjectTree
          selectedId={selectedItem?.id ?? null}
          onSelect={setSelectedItem}
          onPatched={(body) => {
            const needsRefetch = "story_points" in body || "title" in body;
            if (needsRefetch) void refetch();
          }}
          mode="work_items"
        />
      </Panel>
    </>
  );
}
