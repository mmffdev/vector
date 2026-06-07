"use client";

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
import { GridPortfolioItems } from "./GridPortfolioItems";

export default function PortfolioItemsPage() {
  const { full } = usePageTitle();
  // PLA062 S11: identity + tenant + scope via Sentinel.
  const {
    sentinel_tenant,
    sentinel_focus_node,
    sentinel_scope_up,
    sentinel_scope_down,
  } = useSentinel();
  const activeNodeId = sentinel_focus_node;
  const direction = sentinel_scope_down ? "descend" : sentinel_scope_up ? "ascend" : "none";
  useHintOnce("PORTFOLIO_MODEL_FIRST_VISIT");
  const [summary, setSummary] = useState<{
    total: number;
    by_type: Record<string, number>;
  } | null>(null);

  // Catalogue drives surfacedTypes (summary cells + visualisation petals);
  // GridPortfolioItems owns the tree itself.
  const { types } = useArtefactTypeCatalogue();

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

  // Re-fire on scope change — the scope picker mutates ?meg= and
  // ScopeContext.activeNodeId, both of which `withForwardedMeg` reads
  // into the wire request. Without this dep the Summary keeps showing
  // the count from whichever node was active on first mount.
  useEffect(() => {
    void refetchSummary();
  }, [refetchSummary, activeNodeId, direction]);

  const subscriptionID = sentinel_tenant?.id ?? null;
  const topic = subscriptionID
    ? rankTopic("portfolio_item", subscriptionID, "backlog", subscriptionID)
    : null;
  useRefetchOnPush({ topic, refetch });

  // Surfaced types = full scope=strategy catalogue, since this sidecar
  // has no createableTypeSlots allow-list. Drives both the summary
  // cells and the visualisation petals so empty buckets still render
  // a cell (value 0) instead of vanishing.
  const surfacedTypes = useMemo(() => {
    return types
      .filter((t) => t.scope === "strategy" && t.archived_at == null)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [types]);

  const summaryCells = useMemo(() => {
    const total = summary?.total ?? 0;
    const byType = summary?.by_type ?? {};
    const typeCells = surfacedTypes.map((t) => ({
      label: t.name.toUpperCase(),
      value: byType[t.name.toLowerCase()] ?? 0,
    }));
    return [{ label: "TOTAL ITEMS", value: total }, ...typeCells];
  }, [summary, surfacedTypes]);

  const petalKeys = useMemo(
    () => surfacedTypes.map((t) => ({ key: t.name.toLowerCase(), label: t.name })),
    [surfacedTypes],
  );

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
      <VisualisationPanel
        pageKey="portfolio_items"
        petalKeys={petalKeys}
        total={summary?.total ?? 0}
        byType={summary?.by_type ?? {}}
      />

      <GridPortfolioItems />
    </>
    </PageContent>
  );
}
