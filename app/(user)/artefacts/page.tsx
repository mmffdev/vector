"use client";

// /artefacts — cloned from /scope for the Value rail. It uses the same
// GridExecution assembler so the behaviour stays identical while the route
// settles into its own product surface.

import React from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import Panel from "@/app/components/Panel";
import { GridExecution } from "../scope/GridExecution";

export default function ArtefactsPage() {
  const { full } = usePageTitle();

  return (
    <PageContent>
      <PageDescription>
        The artefact hierarchy for this workspace, on the new Grid primitive -
        server-driven parentage via the audited <code>/work-items/query</code>{" "}
        read-gateway, with the real ArtefactInlineForm in each row&apos;s
        flyout-below. {full}
      </PageDescription>

      <Panel
        name="artefacts_grid_tree"
        title="Artefacts"
        description="The artefact hierarchy for this workspace - parent -> child, collapsed by default."
      >
        <GridExecution />
      </Panel>
    </PageContent>
  );
}
