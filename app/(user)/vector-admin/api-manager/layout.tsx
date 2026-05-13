"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";

const TABS = ["webhooks", "asset-register"] as const;
type TabKey = typeof TABS[number];

const SEG_TO_KEY: Record<string, TabKey> = {
  webhooks: "webhooks",
  "asset-register": "asset-register",
};

export default function ApiManagerLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("api-manager");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "webhooks";

  function handleTabChange(key: TabKey) {
    router.push(`/vector-admin/api-manager/${key}`);
  }

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="API Manager sections"
        reorderable
        level="l3"
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "webhooks" as const, label: "Webhooks", sortKey: "Webhooks" },
          { key: "asset-register" as const, label: "Asset Register", sortKey: "Asset Register" },
        ]}
      />
      {children}
    </>
  );
}
