"use client";

import CustomFieldsWorkItemsBody from "@/app/components/CustomFieldsWorkItemsBody";

// Workspace-admin variant. Body lives in
// app/components/CustomFieldsWorkItemsBody.tsx — see TD-WORKITEMS-DUPE
// pay-down (2026-05-16). The only per-page divergence was the subtitle.
export default function CustomFieldsWorkItemsPage() {
  return <CustomFieldsWorkItemsBody subtitle="Custom fields configured for work items." />;
}
