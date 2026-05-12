"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { useTenantName } from "@/app/contexts/TenantContext";

const TABS = ["tenant_details", "topology", "topology_map", "api_manager"] as const;
type TabKey = typeof TABS[number];

const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  tenant_details: "tenant-details",
  topology_map:   "topology-map",
  api_manager:    "api-manager",
};

const SEG_TO_KEY: Record<string, TabKey> = {
  "tenant-details": "tenant_details",
  topology:         "topology",
  "topology-map":   "topology_map",
  "api-manager":    "api_manager",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function VectorAdminLayout({ children }: { children: React.ReactNode }) {
  const router     = useRouter();
  const pathname   = usePathname();
  const tenantName = useTenantName();

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("vector-admin");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "tenant_details";

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/vector-admin/${segmentForKey(key)}`);
  }

  const detailsLabel = tenantName ? `${tenantName} Details` : "Tenant Details";

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="Vector Admin sections"
        reorderable
        level="l3"
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "tenant_details" as const, label: detailsLabel,   sortKey: "Tenant Details" },
          { key: "topology"       as const, label: "Topology",     sortKey: "Topology" },
          { key: "topology_map"   as const, label: "Topology Map", sortKey: "Topology Map" },
          { key: "api_manager"    as const, label: "API Manager",  sortKey: "API Manager" },
        ]}
      />
      {children}
    </>
  );
}
