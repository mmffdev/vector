"use client";

// <FormBuilderLaunchPanel> — entry point for the Form Layout Builder.
// Renders a Panel with a "Launch Form Builder" button; clicking opens
// the fullscreen FormBuilderShell for the current scope node + the
// User Story artefact type.
//
// Type resolution: we resolve "User Story" by its project-locked slot
// `wrk_story` (survives gadmin renames), falling back to a prefix/name
// match. Node comes from the sentinel focus node.

import React, { useEffect, useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import { useSentinel } from "@/app/sentinel";
import { artefactTypesApi, type ArtefactType } from "@/app/lib/artefactTypesApi";
import { FormBuilderShell } from "./FormBuilderShell";

export function FormBuilderLaunchPanel() {
  const { sentinel_focus_node, sentinel_grants } = useSentinel();
  const [types, setTypes] = useState<ArtefactType[] | null>(null);
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

  const storyType = useMemo(() => resolveStoryType(types ?? []), [types]);

  // Node: prefer the focus node; fall back to the first grant's node.
  const nodeId = sentinel_focus_node ?? sentinel_grants[0]?.node_id ?? null;
  const nodeName =
    sentinel_grants.find((g) => g.node_id === nodeId)?.name ??
    sentinel_grants.find((g) => g.node_id === nodeId)?.label_override ??
    undefined;

  const ready = Boolean(nodeId && storyType);
  const reason = !nodeId
    ? "No active scope node — pick a location in the scope rail first."
    : !types
    ? "Loading artefact types…"
    : !storyType
    ? "No User Story type found in this workspace."
    : null;

  return (
    <>
      <Panel
        name="form_layout_builder_launch"
        title="Form Layout Builder"
        description="Design the form layout teams see when they create or edit a User Story on this node. Drag fields into a grid; the layout travels with each story across team hand-offs."
      >
        <div className="flb-launch">
          <div className="flb-launch__Meta">
            <span className="flb-launch__Meta_Item">
              <span className="flb-launch__Meta_Label">Node</span>
              <span className="flb-launch__Meta_Value">{nodeName ?? (nodeId ? "current node" : "—")}</span>
            </span>
            <span className="flb-launch__Meta_Item">
              <span className="flb-launch__Meta_Label">Type</span>
              <span className="flb-launch__Meta_Value">{storyType?.name ?? "User Story"}</span>
            </span>
          </div>
          <button
            type="button"
            className="flb-btn flb-btn-primary"
            disabled={!ready}
            onClick={() => setOpen(true)}
          >
            Launch Form Builder
          </button>
          {(reason || loadErr) && <p className="flb-launch__Reason">{loadErr ?? reason}</p>}
        </div>
      </Panel>

      {open && nodeId && storyType && (
        <FormBuilderShell
          key={savedTick}
          nodeId={nodeId}
          nodeName={nodeName}
          artefactTypeId={storyType.id}
          artefactTypeLabel={storyType.name}
          onClose={() => setOpen(false)}
          onSaved={() => setSavedTick((t) => t + 1)}
        />
      )}
    </>
  );
}

// resolveStoryType prefers the project-locked slot, then a prefix/name
// heuristic so a freshly-seeded workspace without slots still works.
function resolveStoryType(types: ArtefactType[]): ArtefactType | null {
  const bySlot = types.find((t) => t.slot === "wrk_story" && !t.archived_at);
  if (bySlot) return bySlot;
  const byPrefix = types.find((t) => t.prefix?.toUpperCase() === "US" && !t.archived_at);
  if (byPrefix) return byPrefix;
  const byName = types.find((t) => /story/i.test(t.name) && !t.archived_at);
  return byName ?? null;
}
