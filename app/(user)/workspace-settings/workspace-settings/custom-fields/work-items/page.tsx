"use client";

import CustomFieldsWorkItemsBody from "@/app/components/CustomFieldsWorkItemsBody";

// Workspace-settings variant (legacy URL family). Body lives in
// app/components/CustomFieldsWorkItemsBody.tsx — see TD-WORKITEMS-DUPE
// pay-down (2026-05-16).
export default function CustomFieldsWorkItemsPage() {
  return <CustomFieldsWorkItemsBody subtitle="Configure work item type definitions and workflow settings." />;
}
