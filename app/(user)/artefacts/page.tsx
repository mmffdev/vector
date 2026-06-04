"use client";

// /artefacts — cloned from /scope for the Value rail. It uses the same
// GridExecution assembler so the behaviour stays identical while the route
// settles into its own product surface.
//
// No <PageDescription> — the Panel title + description below own the page's
// heading + context, so a separate page-level description band is redundant.
// Exemption is recorded in dev/registries/page_description_exempt.json.

import React from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import { useSentinel } from "@/app/sentinel";
import { GridExecution } from "../scope/GridExecution";

export default function ArtefactsPage() {
  const { sentinel_focus_node, sentinel_grants } = useSentinel();
  const focusGrant = sentinel_grants.find(
    (g) => g.node_id === sentinel_focus_node,
  );
  const focusName =
    focusGrant?.label_override ?? focusGrant?.name ?? "this workspace";

  return (
    <PageContent>
      <Panel
        name="artefacts_grid_tree"
        title="ARTEFACTS"
        description={`Work item hierarchy for ${focusName}.`}
      >
        <GridExecution />
      </Panel>
    </PageContent>
  );
}
