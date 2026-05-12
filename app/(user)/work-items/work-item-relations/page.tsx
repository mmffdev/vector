"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import { WorkItemRelations } from "@/app/components/WorkItemRelations";

export default function WorkItemRelationsPage() {
  return (
    <PageContent>
    <Panel name="work_items_relations" title="Relations graph">
      <WorkItemRelations />
    </Panel>
    </PageContent>
  );
}
