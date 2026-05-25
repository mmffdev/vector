"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function ValueStatus() {
  const { full } = usePageTitle();
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Realised value, leading indicators, and the value pipeline at a glance." />
      <PageDescription>
        Default landing for the Value bucket. Outcomes and value-stream health summarised across active work.
      </PageDescription>
      <Panel
        name="panel_value_status_header"
        className="page-panel-heading"
        title="Value Status"
        description="Track delivered value, in-flight outcomes, and value-stream signals at a glance."
      />
    </PageContent>
  );
}
