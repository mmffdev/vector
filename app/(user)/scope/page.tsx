"use client";

// /scope — the work-item hierarchy, rendered on the new Grid primitive.
//
// Three layers, top to bottom:
//   • <DataContainer>  (Layer 1) — the dumb frame: header band + zero-padding
//                       viewport. Knows nothing about trees.
//   • <GridExecution>  (Layer 2) — the per-page assembler: wires useTree() +
//                       Grid__Tree + the /scope columns + the expandable-flyout
//                       extension. Pushes the header strings UP via setHeader.
//   • the primitive    (Layer 3) — useTree() (headless core) + Grid__Tree
//                       (canonical skin) + the pure-CSS connector system.
//
// Parentage is SERVER-DRIVEN through the audited POST read-gateway
// (workItems.query — roots with no parentId, true children by parentId, all
// workspace-clamped by Sentinel). This replaces the old <DataGrid> + the
// client-side nestWindow() reconstruction that broke the tree connectors.

import React from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { DataContainer } from "@/app/components/DataContainer/DataContainer";
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

      <DataContainer>
        {(setHeader) => <GridExecution onHeader={setHeader} />}
      </DataContainer>
    </PageContent>
  );
}
