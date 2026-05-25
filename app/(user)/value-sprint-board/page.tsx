"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function ValueSprintBoard() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Sprint board — visualise work by column and track progress to done." />
      <PageDescription>
        Kanban-style board for the active sprint. Move items across columns to track flow and surface blockers.
      </PageDescription>
      <Panel
        name="panel_value_sprint_board_header"
        className="page-panel-heading"
        title="Sprint Board"
        description="Visualise sprint work as a board — columns by status, items as cards."
      />
    </PageContent>
  );
}
