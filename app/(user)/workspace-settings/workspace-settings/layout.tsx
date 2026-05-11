"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";

const TABS = ["organisation", "workspaces", "custom_fields", "portfolio_model"] as const;
type TabKey = typeof TABS[number];

const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  custom_fields:   "custom-fields",
  portfolio_model: "portfolio-model",
};

const SEG_TO_KEY: Record<string, TabKey> = {
  organisation:      "organisation",
  workspaces:        "workspaces",
  "custom-fields":   "custom_fields",
  "portfolio-model": "portfolio_model",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function WorkspaceSettingsSubLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("workspace-settings");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 2] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "organisation";

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/workspace-settings/${segmentForKey(key)}`);
  }

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="Workspace Settings sections"
        reorderable
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "organisation"    as const, label: "Organisation",    sortKey: "Organisation" },
          { key: "workspaces"      as const, label: "Workspaces",      sortKey: "Workspaces" },
          { key: "custom_fields"   as const, label: "Custom Fields",   sortKey: "Custom Fields" },
          { key: "portfolio_model" as const, label: "Portfolio Model", sortKey: "Portfolio Model" },
        ]}
      />
      {children}
    </>
  );
}
