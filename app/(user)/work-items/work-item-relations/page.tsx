"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { WorkItemRelations } from "@/app/components/WorkItemRelations";

export default function WorkItemRelationsPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
    <PageHeading level={1} title={full} subtitle="View and manage relationships between work items." />
    <Panel
      name="panel_work_item_relations_header"
      className="page-panel-heading"
      title="Relations"
      description="Explore and manage dependency and relationship links between work items."
    />
    <Panel name="work_items_relations" title="Relations graph">
      <WorkItemRelations />
    </Panel>
    </PageContent>
  );
}
