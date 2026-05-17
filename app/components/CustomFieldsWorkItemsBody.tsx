"use client";

import CustomFieldsTree from "@/app/components/CustomFieldsTree";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

type Props = {
  subtitle: string;
};

export default function CustomFieldsWorkItemsBody({ subtitle }: Props) {
  const { full } = usePageTitle();

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle={subtitle} />
      <Panel
        name="panel_custom_fields_work_items_header"
        className="page-panel-heading"
        title="Work Item Fields"
        description="Configure custom fields that appear on all work items in this workspace."
      />
      <Panel
        name="panel_custom_fields_tree"
        title="Fields"
        description="Expand an artefact type to see its core fields and any custom fields. Core fields are read-only."
      >
        <CustomFieldsTree />
      </Panel>
    </PageContent>
  );
}
