"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";

const TABS = ["work_items", "portfolio_items", "tasks", "defects", "risks"] as const;
type TabKey = typeof TABS[number];

// Tab key → URL path segment (only overrides where they differ)
const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  work_items:      "work-items",
  portfolio_items: "portfolio-items",
};

// URL path segment → tab key
const SEG_TO_KEY: Record<string, TabKey> = {
  "work-items":      "work_items",
  "portfolio-items": "portfolio_items",
  tasks:             "tasks",
  defects:           "defects",
  risks:             "risks",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function CustomFieldsLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  // Active tab = segment immediately after `custom-fields`.
  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("custom-fields");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "work_items";

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/workspace-settings/custom-fields/${segmentForKey(key)}`);
  }

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="Custom field artefact types"
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "work_items",      label: "Work Items",      sortKey: "Work Items" },
          { key: "portfolio_items", label: "Portfolio Items", sortKey: "Portfolio Items" },
          { key: "tasks",           label: "Tasks",           sortKey: "Tasks" },
          { key: "defects",         label: "Defects",         sortKey: "Defects" },
          { key: "risks",           label: "Risks",           sortKey: "Risks" },
        ]}
      />
      {children}
    </>
  );
}
