"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { useHasPermission } from "@/app/contexts/AuthContext";
import { useTenantName } from "@/app/contexts/TenantContext";

const TABS = ["tenant_details", "artefact_types", "flow_states", "work_items", "topology", "topology_map"] as const;
type TabKey = typeof TABS[number];

const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  tenant_details: "tenant-details",
  artefact_types: "artefact-types",
  flow_states:    "flow-states",
  work_items:     "work-items",
  topology_map:   "topology-map",
};

const SEG_TO_KEY: Record<string, TabKey> = {
  "tenant-details": "tenant_details",
  "artefact-types": "artefact_types",
  "flow-states":    "flow_states",
  "work-items":     "work_items",
  topology:         "topology",
  "topology-map":   "topology_map",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function CustomisationLayout({ children }: { children: React.ReactNode }) {
  const router          = useRouter();
  const pathname        = usePathname();
  const tenantName      = useTenantName();
  const canManageFlows  = useHasPermission("flows.manage");

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("customisation");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "tenant_details";

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/customisation/${segmentForKey(key)}`);
  }

  const detailsLabel = tenantName ? `${tenantName} Details` : "Tenant Details";

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="Vector Admin sections"
        reorderable
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "tenant_details" as const, label: detailsLabel,     sortKey: "Tenant Details" },
          { key: "artefact_types" as const, label: "Artefact Types",  sortKey: "Artefact Types" },
          { key: "flow_states"    as const, label: "Flow States",     sortKey: "Flow States" },
          ...(canManageFlows ? [{ key: "work_items" as const, label: "Work Items", sortKey: "Work Items" }] : []),
          { key: "topology"       as const, label: "Topology",        sortKey: "Topology" },
          { key: "topology_map"   as const, label: "Topology Map",    sortKey: "Topology Map" },
        ]}
      />
      {children}
    </>
  );
}
