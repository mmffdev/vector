"use client";

import { usePathname, useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";

const TABS = ["list", "relations", "settings"] as const;
type TabKey = typeof TABS[number];

const TAB_HEADERS: Record<TabKey, { title: string; subtitle: string }> = {
  list:     { title: "Work Items",         subtitle: "Epics, stories, and their custom fields" },
  relations:{ title: "Work Item Relations", subtitle: "3D graph of how items cluster across the tenant" },
  settings: { title: "Work Items Settings", subtitle: "Custom field library and item templates" },
};

const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  relations: "work-item-relations",
};

const SEG_TO_KEY: Record<string, TabKey> = {
  list: "list",
  "work-item-relations": "relations",
  settings: "settings",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function WorkItemsLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("work-items");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "list";

  const header = TAB_HEADERS[activeTab];

  function handleTabChange(key: TabKey) {
    router.push(`/work-items/${segmentForKey(key)}`);
  }

  return (
    <StrictRoute>
      <PageShell title={header.title} subtitle={header.subtitle} barTitle="Work Items">
        <SecondaryNavigation<TabKey>
          ariaLabel="Work items sections"
          pageId="work-items"
          reorderable
          active={activeTab}
          onChange={handleTabChange}
          items={[
            { key: "list",     label: "List",      sortKey: "List" },
            { key: "relations",label: "Relations", sortKey: "Relations" },
            { key: "settings", label: "Settings",  sortKey: "Settings" },
          ]}
        />
        {children}
      </PageShell>
    </StrictRoute>
  );
}
