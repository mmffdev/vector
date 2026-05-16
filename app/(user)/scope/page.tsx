"use client";

import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function ScopePage() {
  const { full } = usePageTitle();

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Track and manage the active feature scope for this workspace." />
      <Panel
        name="panel_scope_header"
        className="page-panel-heading"
        title="Scope"
        description="Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore."
      />
    </PageContent>
  );
}
