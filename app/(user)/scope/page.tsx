"use client";

// /scope — the work-item hierarchy, rendered on the new Grid primitive.
//
// Layers, top to bottom:
//   • <Panel>          — the card + MAIN HEADER (title + help hex + addressable),
//                        the same primitive OTV2 uses. The .panel:has(.grid) CSS
//                        rule gives it the bordered, 10px-radius, overflow-hidden
//                        card so the grid's bands run edge to edge and the
//                        pagination footer clips to the rounded corners.
//                        (TEMP: the tree is wrapped in <Panel> while the card +
//                        main header are retrofitted into Grid__Tree itself;
//                        once that lands this wrapper is removed.)
//   • <GridExecution>  — the per-page assembler: wires useTree() + Grid__Tree +
//                        the /scope columns + the expandable-flyout extension.
//   • the primitive    — useTree() (headless core) + Grid__Tree (canonical skin)
//                        + the pure-CSS connector system.
//
// Parentage is SERVER-DRIVEN through the audited POST read-gateway
// (workItems.query — roots with no parentId, true children by parentId, all
// workspace-clamped by Sentinel).

import React from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import Panel from "@/app/components/Panel";
import { GridExecution } from "./GridExecution";

export default function ScopePage() {
  const { full } = usePageTitle();

  return (
    <PageContent>
      <PageDescription>
        The work-item hierarchy for this workspace, on the new Grid primitive —
        server-driven parentage via the audited <code>/work-items/query</code>{" "}
        read-gateway, with the real ArtefactInlineForm in each row&apos;s
        flyout-below. {full}
      </PageDescription>

      <Panel
        name="scope_grid_tree"
        title="Scope"
        description="The work-item hierarchy for this workspace — parent → child, collapsed by default."
      >
        <GridExecution />
      </Panel>
    </PageContent>
  );
}
