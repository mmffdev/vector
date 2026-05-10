"use client";

// Replaced 2026-05-09 — the per-type custom-field admin moved to
// /workspace-settings/custom-fields/work-items, which composes <CustomFieldManager>
// against the artefact-type binding model (no "templates" intermediary).
// This page is kept as a stable URL that redirects so existing bookmarks land
// on the live surface.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WorkItemsSettingsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workspace-settings/custom-fields/work-items");
  }, [router]);
  return null;
}
