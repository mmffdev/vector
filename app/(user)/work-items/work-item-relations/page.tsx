"use client";

import Panel from "@/app/components/Panel";
import { WorkItemRelations } from "@/app/components/WorkItemRelations";

export default function WorkItemRelationsPage() {
  return (
    <Panel name="work_items_relations" title="Relations graph">
      <WorkItemRelations />
    </Panel>
  );
}
