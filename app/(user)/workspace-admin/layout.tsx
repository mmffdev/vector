"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { useHasPermission } from "@/app/contexts/AuthContext";

const TABS = ["organisation", "workspaces", "artefact_types", "custom_fields", "flow_states", "flow_states_v2", "transition_rules", "portfolio_model"] as const;
type TabKey = typeof TABS[number];

const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  artefact_types:   "artefact-types",
  custom_fields:    "custom-fields",
  flow_states:      "flow-states",
  flow_states_v2:   "flow-states-v2",
  transition_rules: "transition-rules",
  portfolio_model:  "portfolio-model",
};

const SEG_TO_KEY: Record<string, TabKey> = {
  organisation:       "organisation",
  workspaces:         "workspaces",
  "artefact-types":   "artefact_types",
  "custom-fields":    "custom_fields",
  "flow-states":      "flow_states",
  "flow-states-v2":   "flow_states_v2",
  "transition-rules": "transition_rules",
  "portfolio-model":  "portfolio_model",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function WorkspaceSettingsSubLayout({ children }: { children: React.ReactNode }) {
  const router         = useRouter();
  const pathname       = usePathname();
  const canManageFlows = useHasPermission("flows.manage");

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("workspace-admin");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "organisation";

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-admin/${segmentForKey(key)}`);
  }

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="Workspace Settings sections"
        reorderable
        level="l3"
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "organisation"    as const, label: "Organisation",    sortKey: "Organisation" },
          { key: "workspaces"      as const, label: "Workspaces",      sortKey: "Workspaces" },
          { key: "artefact_types"  as const, label: "Artefact Types",  sortKey: "Artefact Types" },
          { key: "custom_fields"   as const, label: "Custom Fields",   sortKey: "Custom Fields" },
          ...(canManageFlows
            ? [
                { key: "flow_states"      as const, label: "Flow States",      sortKey: "Flow States" },
                { key: "flow_states_v2"   as const, label: "Flow States v2",   sortKey: "Flow States v2" },
                { key: "transition_rules" as const, label: "Transition Rules", sortKey: "Transition Rules" },
              ]
            : []),
          { key: "portfolio_model" as const, label: "Portfolio Model", sortKey: "Portfolio Model" },
        ]}
      />
      {children}
    </>
  );
}
