"use client";

// <FormBuilderLaunchPanel> — entry point for the Form Layout Builder.
// Renders a Panel with a grouped artefact-type dropdown: choosing a type
// IS the launch (no third click) — it opens the fullscreen FormBuilderShell
// for the current scope node + that type. Types are discovered live from
// the tenant's artefact-type catalogue and grouped Strategic / Execution by
// their scope. The builder opens the existing layout for (node, type) if one
// exists, else a blank canvas.

import React, { useEffect, useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import { useSentinel } from "@/app/sentinel";
import { artefactTypesApi, type ArtefactType } from "@/app/lib/artefactTypesApi";
import { FormBuilderShell } from "./FormBuilderShell";

export function FormBuilderLaunchPanel() {
  const { sentinel_focus_node, sentinel_grants } = useSentinel();
  const [types, setTypes] = useState<ArtefactType[] | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    artefactTypesApi
      .list()
      .then((t) => { if (!cancelled) setTypes(t); })
      .catch((e) => { if (!cancelled) setLoadErr(e instanceof Error ? e.message : "Failed to load types"); });
    return () => { cancelled = true; };
  }, []);

  // Live, scope-grouped catalogue. Strategic types first (scope=strategy),
  // then Execution (scope=work). Each group ordered by sort_order. Renders
  // tenant renames automatically (we key by id, label by name).
  const { strategic, execution } = useMemo(() => groupByScope(types ?? []), [types]);

  // Node: prefer the focus node; fall back to the first grant's node.
  const nodeId = sentinel_focus_node ?? sentinel_grants[0]?.node_id ?? null;
  const nodeName =
    sentinel_grants.find((g) => g.node_id === nodeId)?.name ??
    sentinel_grants.find((g) => g.node_id === nodeId)?.label_override ??
    undefined;

  const selectedType = useMemo(
    () => (types ?? []).find((t) => t.id === selectedTypeId) ?? null,
    [types, selectedTypeId],
  );

  const hasTypes = strategic.length + execution.length > 0;
  const reason = !nodeId
    ? "No active scope node — pick a location in the scope rail first."
    : !types
    ? "Loading artefact types…"
    : !hasTypes
    ? "No artefact types found in this workspace."
    : null;

  function onPick(id: string) {
    setSelectedTypeId(id);
    if (id && nodeId) setOpen(true);
  }

  return (
    <>
      <Panel
        name="form_layout_builder_launch"
        title="Form Layout Builder"
        description="Design the form layout teams see when they create or edit an artefact on this node. Pick a type to start: the sidebar shows only the fields that belong to that type. The layout travels with each artefact across team hand-offs."
      >
        <div className="flb-launch">
          <div className="flb-launch__Meta">
            <span className="flb-launch__Meta_Item">
              <span className="flb-launch__Meta_Label">Node</span>
              <span className="flb-launch__Meta_Value">{nodeName ?? (nodeId ? "current node" : "—")}</span>
            </span>
          </div>
          <div className="flb-typepick">
            <label className="flb-typepick__Label" htmlFor="flb-typepick-select">
              Create new form
            </label>
            <select
              id="flb-typepick-select"
              className="flb-typepick__Select"
              disabled={!nodeId || !hasTypes}
              value={selectedTypeId}
              onChange={(e) => onPick(e.target.value)}
            >
              <option value="">Select an artefact type…</option>
              {strategic.length > 0 && (
                <optgroup label="Strategic">
                  {strategic.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              {execution.length > 0 && (
                <optgroup label="Execution">
                  {execution.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {(reason || loadErr) && <p className="flb-launch__Reason">{loadErr ?? reason}</p>}
        </div>
      </Panel>

      {open && nodeId && selectedType && (
        <FormBuilderShell
          key={`${selectedType.id}:${savedTick}`}
          nodeId={nodeId}
          nodeName={nodeName}
          artefactTypeId={selectedType.id}
          artefactTypeLabel={selectedType.name}
          onClose={() => { setOpen(false); setSelectedTypeId(""); }}
          onSaved={() => setSavedTick((t) => t + 1)}
        />
      )}
    </>
  );
}

// groupByScope splits the live catalogue into Strategic (scope=strategy) and
// Execution (scope=work) buckets, each ordered to mirror the portfolio
// hierarchy: highest-altitude type at the TOP, lowest at the BOTTOM.
//
// The DB's artefacts_types_sort_order encodes altitude ASCENDING from the
// floor of each stack (Feature=0 … Portfolio Runway=40 for strategy;
// Story=10 … Epic=40 for work). The portfolio stack reads the other way —
// Portfolio Runway above Feature, Epic above Story — so we render each group
// in DESCENDING sort_order. Pure presentation; the catalogue data is
// unchanged. Archived types are excluded.
function groupByScope(types: ArtefactType[]): {
  strategic: ArtefactType[];
  execution: ArtefactType[];
} {
  const live = types.filter((t) => !t.archived_at);
  // Descending sort_order = top-of-stack first. Tie-break by name so equal
  // sort_order tiers (e.g. placeholder "Test Type …" rows at 100) stay
  // deterministic rather than relying on insertion order.
  const byStackDesc = (a: ArtefactType, b: ArtefactType) =>
    b.sort_order - a.sort_order || a.name.localeCompare(b.name);
  return {
    strategic: live.filter((t) => t.scope === "strategy").sort(byStackDesc),
    execution: live.filter((t) => t.scope === "work").sort(byStackDesc),
  };
}
