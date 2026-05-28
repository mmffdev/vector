"use client";

// Custom Fields admin — list page. The reusable body lives at
// app/components/CustomFields/CustomFieldsPageBody.tsx so both this
// route and /[id] can mount the same grid (Next.js page.tsx files
// can't export named components — only `default` and the route-config
// known names).

import { CustomFieldsPageBody } from "@/app/components/CustomFields/CustomFieldsPageBody";

export default function CustomFieldsPage() {
  return <CustomFieldsPageBody />;
}
