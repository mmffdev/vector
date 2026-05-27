"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import { FlowBoard } from "@/app/components/FlowBoard/p_FlowBoard";
import workItemsBoardJson from "@/app/components/FlowBoard/configs/p_wizard_flowboard_workitems.json";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import type { FlowBoardConfig } from "@/app/components/FlowBoard/loader";

export default function ValueFlow() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="Drag work items across flow states; WIP limits and overage shown per column."
      />
      <PageDescription>
        Kanban board for the active topology node. Cards filtered by the selected artefact type.
      </PageDescription>
      <FlowBoard config={workItemsBoardJson as unknown as FlowBoardConfig} />
    </PageContent>
  );
}
