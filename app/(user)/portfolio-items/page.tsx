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
import portfolioWizardJson from "@/app/components/ObjectTree/configs/p_wizard_portfolio.json";

export default function PortfolioItemsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  useHintOnce("PORTFOLIO_MODEL_FIRST_VISIT");
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    by_type: Record<string, number>;
  } | null>(null);

  const wizardConfig = useMemo<ObjectTreeDataConfig>(() => {
    const resolved = resolveWizardConfig(portfolioWizardJson as any);
    const funcs = buildWorkItemsFunctions();
    // filterChips is provided by ObjectTree itself based on
    // filterChipsComponent — page no longer wires the React element.
    return {
      ...resolved,
      getParentId: funcs.getParentId,
      getChildrenCount: funcs.getChildrenCount,
      searchAccessor: funcs.searchAccessor,
    } as ObjectTreeDataConfig;
  }, []);

  const refetchSummary = useCallback(() => {
    return apiSite<{
      total: number;
      by_type: Record<string, number>;
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
    const total = summary?.total ?? 0;
    const byType = summary?.by_type ?? {};
    const cells = [{ label: "TOTAL ITEMS", value: total }];
    Object.entries(byType).forEach(([key, count]) => {
      cells.push({ label: key.toUpperCase(), value: count });
    });
    return cells;
  }, [summary]);

  return (
    <PageContent>
    <>
      <PageHeading level={1} title={full} subtitle="Browse and manage portfolio items across all model layers." />
      <Panel
        name="panel_portfolio_items_header"
        className="page-panel-heading"
        title="Portfolio Items"
        description="View, filter, and manage portfolio items organised by the workspace portfolio model."
      />
      <PageSummaryHeader cells={summaryCells} />

      <ObjectTree
        title="Portfolio items"
        addressableName="portfolio_items_grid_tree"
        subtitleBadge="05"
        subtitle="Dense grid"
        description="Spreadsheet-fast. 28px rows, single-character status, mono ID column."
        selectedId={selectedItem?.id ?? null}
        onSelect={setSelectedItem}
        onPatched={(body) => {
          const needsRefetch = "title" in body;
          if (needsRefetch) void refetch();
        }}
        wizardConfig={wizardConfig}
      />
    </>
    </PageContent>
  );
}
