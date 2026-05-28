"use client";

// /workspace-admin/custom-fields/[id] — route-segment deep link.
//
// Bookmark survives. The route mounts the list body and primes the
// adapter's flyout for the linked field id (or create-mode when the
// segment is "new"). No URL query reads (PLA-0053 path-only rule); all
// state flows via the body's component-level props.
//
// The legacy 424-line editor at this path is GONE — the inline two-
// column flyout (CustomFieldEditForm + TypeBindingsPicker) replaces it.
// Form state machine lives in CustomFieldEditForm; this route is just
// the deep-link landing.

import { useParams } from "next/navigation";
import { CustomFieldsPageBody } from "@/app/components/CustomFields/CustomFieldsPageBody";

export default function CustomFieldDeepLinkPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  return (
    <CustomFieldsPageBody
      initialOpenId={isNew ? null : id}
      initialCreateMode={isNew}
    />
  );
}
