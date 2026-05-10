"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { tenantSettingsApi } from "@/app/lib/tenantSettingsApi";

const TABS = ["tenant_details", "artefact_types", "flow_states"] as const;
type TabKey = typeof TABS[number];

const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  tenant_details: "tenant-details",
  artefact_types: "artefact-types",
  flow_states:    "flow-states",
};

const SEG_TO_KEY: Record<string, TabKey> = {
  "tenant-details": "tenant_details",
  "artefact-types": "artefact_types",
  "flow-states":    "flow_states",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function CustomisationLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [tenantName, setTenantName] = useState<string>("");

  useEffect(() => {
    tenantSettingsApi.get().then((s) => setTenantName(s.tenant_name)).catch(() => {});
  }, []);

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
        ariaLabel="Customisation sections"
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "tenant_details" as const, label: detailsLabel,    sortKey: "Tenant Details" },
          { key: "artefact_types" as const, label: "Artefact Types", sortKey: "Artefact Types" },
          { key: "flow_states"    as const, label: "Flow States",    sortKey: "Flow States" },
        ]}
      />
      {children}
    </>
  );
}
