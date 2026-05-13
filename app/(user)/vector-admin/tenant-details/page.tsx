"use client";

import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function TenantDetailsPage() {
  const { full } = usePageTitle();
  return (
    <PageContent>
    <PageHeading level={1} title={full} subtitle="Review and manage tenant-level configuration and details." />
    <Panel
      name="panel_tenant_details_header"
      className="page-panel-heading"
      title="Tenant Details"
      description="View and update tenant configuration, identifiers, and administrative settings."
    />
    <div className="settings-panel">
      <p className="form__hint">Tenant details — coming soon.</p>
    </div>
    </PageContent>
  );
}
