"use client";

// /scope — component POC harness.
//
// Mounts the <DataGrid> wired to live GET /work-items via apiSite()
// (inheriting the production ?meg= + Sentinel scope clamp). The row
// flyout opens the REAL ArtefactInlineForm — same component the OTV2
// surface uses — populated from live tenant data. Proves the grid + the
// production inline form work together against real data.

import React from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import DataGrid from "@/app/components/DataGrid/p_DataGrid";
import { workItemsDataGridConfig } from "@/app/(user)/work-items/p_workItems_dataGridConfig";

export default function ScopePage() {
  const { full } = usePageTitle();

  return (
    <PageContent>
      <PageDescription>
        Component POC harness — mounts <code>&lt;DataGrid&gt;</code> wired to
        live <code>/work-items</code> data, with the real ArtefactInlineForm
        in the row flyout. {full}
      </PageDescription>

      <Panel name="real_data_poc" title="Real-data PoC — ArtefactInlineForm over live /work-items" helpable={false}>
        <DataGrid config={workItemsDataGridConfig} />
      </Panel>
    </PageContent>
  );
}
