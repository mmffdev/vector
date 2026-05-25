"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function ValueFlow() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Flow metrics — throughput, cycle time, work in progress, and value flow efficiency." />
      <PageDescription>
        Visualise the flow of value through the system — throughput, cycle time, WIP, and bottlenecks.
      </PageDescription>
      <Panel
        name="panel_value_flow_header"
        className="page-panel-heading"
        title="Flow"
        description="Flow metrics across the value stream: throughput, cycle time, WIP, and efficiency."
      />
    </PageContent>
  );
}
