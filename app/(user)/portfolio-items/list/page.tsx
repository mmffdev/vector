"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import Panel from "@/app/components/Panel";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import { apiV2 } from "@/app/lib/api";
import ObjectTree, { type WorkItem } from "@/app/components/ObjectTree/p_ObjectTree";
import { useRefetchOnPush } from "@/app/hooks/useRefetchOnPush";
import { rankTopic } from "@/app/hooks/useRealtimeSubscription";
import { useAuth } from "@/app/contexts/AuthContext";
import { useHintOnce } from "@/app/lib/hints";

export default function PortfolioItemsListPage() {
  const { user } = useAuth();
  useHintOnce("PORTFOLIO_ITEMS_FIRST_VISIT");
  const [filters] = useState({});
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    themes: number;
    objectives: number;
    features: number;
  } | null>(null);

  const refetchSummary = useCallback(() => {
    return apiV2<{
      total: number;
      themes: number;
      objectives: number;
      features: number;
    }>(`/portfolio-items/summary`)
      .then((r) => setSummary(r))
      .catch(() => setSummary(null));
  }, []);

  const refetch = useCallback(() => {
    return refetchSummary();
  }, [refetchSummary]);

  useEffect(() => {
    void refetchSummary();
  }, [refetchSummary]);

  const subscriptionID = user?.subscription_id ?? null;
  const topic = subscriptionID
    ? rankTopic("portfolio_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  const summaryCells = useMemo(() => {
    const s = summary ?? { total: 0, themes: 0, objectives: 0, features: 0 };
    return [
      { label: "TOTAL ITEMS", value: s.total },
      { label: "THEMES", value: s.themes },
      { label: "OBJECTIVES", value: s.objectives },
      { label: "FEATURES", value: s.features },
    ];
  }, [summary]);

  return (
    <>
      <PageSummaryHeader cells={summaryCells} />

      <Panel name="portfolio_items_grid_tree" title="Portfolio items">
        <ObjectTree
          selectedId={selectedItem?.id ?? null}
          onSelect={setSelectedItem}
          onPatched={(body) => {
            const needsRefetch = "title" in body;
            if (needsRefetch) void refetch();
          }}
          mode="portfolio_items"
        />
      </Panel>
    </>
  );
}
