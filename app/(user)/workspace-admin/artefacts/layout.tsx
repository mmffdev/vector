"use client";

import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";

const TABS = ["artefact-types", "transition-rules", "flow-states-v2"] as const;
type TabKey = typeof TABS[number];

const SEG_TO_KEY: Record<string, TabKey> = {
  "artefact-types":  "artefact-types",
  "transition-rules": "transition-rules",
  "flow-states-v2":  "flow-states-v2",
};

export default function ArtefactsLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("artefacts");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "artefact-types";

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-admin/artefacts/${key}`);
  }

  return (
    <>
      <SecondaryNavigation<TabKey>
        ariaLabel="Artefacts sections"
        level="l3"
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "artefact-types",   label: "Artefact Types",   sortKey: "Artefact Types"   },
          { key: "transition-rules", label: "Transition Rules",  sortKey: "Transition Rules"  },
          { key: "flow-states-v2",   label: "Flow States",       sortKey: "Flow States"       },
        ]}
      />
      {children}
    </>
  );
}
