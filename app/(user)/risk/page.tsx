"use client";

// PLA-0052 Story 12 — /risk page rewrite.
//
// Replaces the 112-line hardcoded fixture (RSK-0001/0002/0003) with a real
// ObjectTree mounted on /work-items?item_type=risk. The page is a filtered
// secondary surface for the same `artefacts` data — Risk-as-row primary
// surface stays on /work-items.
//
// Summary header reads /_site/risks/summary (PLA-0052 Story 10) which
// returns severity × likelihood aggregates. Frontend renders the open count
// + per-severity totals as PageSummaryHeader cells; the 3×3 matrix is
// available in the payload for a later widget (out of Story 12 scope).
//
// Pattern mirrors /work-items/page.tsx; differences:
//   - No sprint filter (Risk has no sprint concept).
//   - Different wizard sidecar (p_wizard_risks.json) + different filter chips.
//   - Summary endpoint + cell labels reflect risk-domain semantics.
//   - No realtime push subscription yet — risk creation is low-frequency
//     and the polling-on-mount is enough; add useRefetchOnPush in a future
//     story if needed.

import React, { useState, useCallback, useEffect, useMemo } from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import PageSummaryHeader from "@/app/components/PageSummaryHeader";
import { apiSite } from "@/app/lib/api";
import ObjectTree, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTree/p_ObjectTree";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import { resolveSlotRefs } from "@/app/lib/sidecarSlotResolver";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { RisksPanelHeader, RisksFilterChips } from "@/app/components/risk-tree-config";
import risksWizardJson from "@/app/components/ObjectTree/configs/p_wizard_risks.json";

interface RisksSummary {
  total: number;
  open: number;
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  by_likelihood: {
    high: number;
    medium: number;
    low: number;
  };
  matrix: number[][];
}

const EMPTY_SUMMARY: RisksSummary = {
  total: 0,
  open: 0,
  by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  by_likelihood: { high: 0, medium: 0, low: 0 },
  matrix: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
};

export default function RiskPage() {
  const { full } = usePageTitle();
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [summary, setSummary] = useState<RisksSummary | null>(null);

  // PLA-0054 / story 00592 — resolve sidecar slot refs ("wrk_risk")
  // to per-tenant UUIDs at mount, so the rendered ObjectTree's
  // resourceUrl carries `?item_type_id=<uuid>` instead of the legacy
  // `?item_type=risk` slug. Catalogue is loaded by the provider in
  // app/layout.tsx; on first render before the catalogue resolves,
  // the URL keeps its raw form and the chip is empty — the
  // useMemo re-runs when `types` populates.
  const { types } = useArtefactTypeCatalogue();
  const wizardConfig = useMemo<ObjectTreeDataConfig>(() => {
    const resolvedSlots = resolveSlotRefs(
      risksWizardJson as unknown as Record<string, unknown>,
      types,
    );
    const resolved = resolveWizardConfig(resolvedSlots as any);
    const funcs = buildWorkItemsFunctions();
    return {
      ...resolved,
      getParentId: funcs.getParentId,
      getChildrenCount: funcs.getChildrenCount,
      searchAccessor: funcs.searchAccessor,
      panelHeader: resolved.panelHeaderComponent === "RisksPanelHeader" ? <RisksPanelHeader /> : undefined,
      filterChips: resolved.filterChipsComponent === "RisksFilterChips" ? <RisksFilterChips /> : undefined,
    } as ObjectTreeDataConfig;
  }, [types]);

  const refetch = useCallback(() => {
    return apiSite<RisksSummary>("/risks/summary")
      .then((r) => setSummary(r))
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const summaryCells = useMemo(() => {
    const s = summary ?? EMPTY_SUMMARY;
    // PageSummaryHeader's SummaryCellTone is currently `neutral | warning`
    // only — critical-severity is collapsed into the same warning tone for
    // now. When the Page Summary Header gains a `danger` tone, split it out.
    return [
      { label: "TOTAL RISKS", value: s.total },
      { label: "OPEN",        value: s.open,                 tone: "warning" as const, glyph: "issue" as const },
      { label: "CRITICAL",    value: s.by_severity.critical, tone: "warning" as const, glyph: "issue" as const },
      { label: "HIGH SEV",    value: s.by_severity.high,     tone: "warning" as const },
      { label: "HIGH LIK",    value: s.by_likelihood.high,   tone: "warning" as const },
    ];
  }, [summary]);

  return (
    <PageContent>
      <>
        <PageHeading
          level={1}
          title={full}
          subtitle="Risk identification, scoring, and mitigation across the workspace."
        />
        <Panel
          name="panel_risk_header"
          className="page-panel-heading"
          title="Risk"
          description="Identify, score, and track mitigation actions for risks across the workspace."
        />
        <PageSummaryHeader cells={summaryCells} />

        <Panel name="risk_grid_tree_ll" title="Risk register">
          <ObjectTree
            selectedId={selectedItem?.id ?? null}
            onSelect={setSelectedItem}
            onPatched={(body) => {
              const needsRefetch = "status" in body || "title" in body;
              if (needsRefetch) void refetch();
            }}
            wizardConfig={wizardConfig}
          />
        </Panel>
      </>
    </PageContent>
  );
}
