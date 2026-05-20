"use client";

// /scope — ObjectTreeV2 harness page (slice 0 of the objecttree refactor).
//
// This page is the test bench for the V2 grid component. It is NOT a
// production user surface — the dropdown switches the mounted dataType
// across the five domains that need to share the same generic component
// (work-items, portfolio-items, sprints, releases, risks). Scope clamp
// is inherited from the user's normal ScopeContext — whatever node the
// user has picked in the global scope picker drives this page's data
// just like every other surface.
//
// V2 lives at @/app/components/ObjectTreeV2 and is initially a clone of
// the production <ObjectTree>. Subsequent slices in the refactor plan
// (docs/c_c_objecttree_refactor_plan.md) carve V2 toward the generic,
// JSON-driven, plugin-loaded shape. The original <ObjectTree> stays
// untouched and continues to power every real page.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useScope } from "@/app/contexts/ScopeContext";
import ObjectTreeV2, { type WorkItem, type ObjectTreeDataConfig } from "@/app/components/ObjectTreeV2/p_ObjectTree";
import { resolveWizardConfig, buildWorkItemsFunctions } from "@/app/lib/wizardLoader";
import { resolveSlotRefs } from "@/app/lib/sidecarSlotResolver";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { RisksFilterChips } from "@/app/components/risk-tree-config";
import workItemsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_workitems.json";
import portfolioWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_portfolio.json";
import risksWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_risks.json";

type Mode = "work_items" | "portfolio_items" | "sprints" | "releases" | "risks";

const MODES: Array<{ value: Mode; label: string; ready: boolean }> = [
  { value: "work_items", label: "Work items (execution)", ready: true },
  { value: "portfolio_items", label: "Portfolio items (strategic)", ready: true },
  { value: "risks", label: "Risks", ready: true },
  { value: "sprints", label: "Sprints (timebox)", ready: false },
  { value: "releases", label: "Releases (timebox)", ready: false },
];

const STORAGE_KEY = "scope.v2.mode";

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "work_items";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && MODES.some(m => m.value === v)) return v as Mode;
  } catch { /* localStorage disabled */ }
  return "work_items";
}

export default function ScopePage() {
  const { full } = usePageTitle();
  const { activeNodeId, activeGrant } = useScope();
  const { types } = useArtefactTypeCatalogue();

  const [mode, setMode] = useState<Mode>("work_items");
  // Read storage after first paint to avoid hydration mismatch.
  useEffect(() => { setMode(readStoredMode()); }, []);
  const onModeChange = useCallback((next: Mode) => {
    setMode(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
  }, []);

  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  // Resolve the wizard JSON for the current mode. Sprints/Releases
  // don't have a wizard config yet (they live behind TimeboxManager
  // today and will get their JSON in Slice 6 of the refactor plan);
  // for now they render a placeholder card explaining the gap.
  const wizardConfig = useMemo<ObjectTreeDataConfig | null>(() => {
    let raw: unknown = null;
    if (mode === "work_items") raw = workItemsWizardJson;
    else if (mode === "portfolio_items") raw = portfolioWizardJson;
    else if (mode === "risks") raw = risksWizardJson;
    if (!raw) return null;

    const resolvedSlots = resolveSlotRefs(raw as Record<string, unknown>, types);
    const resolved = resolveWizardConfig(resolvedSlots as any);
    const funcs = buildWorkItemsFunctions();
    return {
      ...resolved,
      getParentId: funcs.getParentId,
      getChildrenCount: funcs.getChildrenCount,
      searchAccessor: funcs.searchAccessor,
      filterChips: resolved.filterChipsComponent === "RisksFilterChips" ? <RisksFilterChips /> : undefined,
    } as ObjectTreeDataConfig;
  }, [mode, types]);

  const currentMode = MODES.find(m => m.value === mode);
  const scopeLabel = activeGrant?.label_override ?? activeGrant?.name ?? "(no scope clamp set)";

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="ObjectTreeV2 harness — swap dataType to validate the refactor against work-items / portfolio / risks / sprints / releases on the same component."
      />
      <PageDescription>
        Dev harness for the ObjectTree V2 refactor. Switch modes to mount different dataTypes
        through the same V2 component. Scope clamp inherits from the global scope picker —
        change it from the rail to see different topology slices. Real pages stay on the
        legacy ObjectTree until each slice is proven here.
      </PageDescription>

      <Panel
        name="panel_scope_v2_controls"
        className="page-panel-heading"
        title="Mode + scope"
        description="Pick which dataType to mount. Sprints and Releases land in Slice 6 of the refactor plan."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0" }}>
          <label htmlFor="scope-mode" style={{ fontWeight: 500 }}>Data type</label>
          <select
            id="scope-mode"
            className="form__input"
            value={mode}
            onChange={(e) => onModeChange(e.target.value as Mode)}
            style={{ minWidth: 240 }}
          >
            {MODES.map(m => (
              <option key={m.value} value={m.value} disabled={!m.ready}>
                {m.label}{m.ready ? "" : " — coming in Slice 6"}
              </option>
            ))}
          </select>

          <span style={{ marginLeft: 24, color: "var(--ink-muted)" }}>
            Active scope: <strong>{scopeLabel}</strong>
            {activeNodeId ? ` (${activeNodeId.slice(0, 8)}…)` : ""}
          </span>
        </div>
      </Panel>

      {wizardConfig && types.length > 0 && (
        <ObjectTreeV2
          key={mode}
          title={currentMode?.label ?? "Grid"}
          addressableName={`scope_v2_${mode}_grid`}
          subtitleBadge="V2"
          subtitle="Dense grid (V2 clone)"
          description="ObjectTreeV2 baseline — identical to the production ObjectTree at this slice. Future slices generalise this shell."
          selectedId={selectedItem?.id ?? null}
          onSelect={setSelectedItem}
          wizardConfig={wizardConfig}
        />
      )}

      {!wizardConfig && (
        <Panel
          name={`panel_scope_v2_${mode}_placeholder`}
          title={`${currentMode?.label ?? mode} — not yet wired`}
          description="Sprints and Releases live behind TimeboxManager today and get their wizard JSON in Slice 6 of the refactor plan. Pick a ready mode from the dropdown."
        />
      )}
    </PageContent>
  );
}
