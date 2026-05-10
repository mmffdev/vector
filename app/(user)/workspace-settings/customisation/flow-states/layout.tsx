"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { flowStatesApi, type FlowGroup } from "@/app/lib/flowStatesApi";

export default function FlowStatesLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [groups, setGroups] = useState<FlowGroup[] | null>(null);

  useEffect(() => {
    flowStatesApi.list().then((resp) => {
      // Work types first, then strategy types; within each, sort by type name.
      const work     = resp.work.sort((a, b) => a.type_name.localeCompare(b.type_name));
      const strategy = resp.strategy.sort((a, b) => a.type_name.localeCompare(b.type_name));
      setGroups([...work, ...strategy]);
    });
  }, []);

  // Active tab = segment immediately after `flow-states`.
  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("flow-states");
  const activeId = rootIdx >= 0 ? (segments[rootIdx + 1] ?? "") : "";

  function handleTabChange(typeId: string) {
    router.push(`/workspace-settings/customisation/flow-states/${typeId}`);
  }

  // Redirect to first group once loaded, if no typeId in URL.
  useEffect(() => {
    if (groups && groups.length > 0 && !activeId) {
      router.replace(
        `/workspace-settings/customisation/flow-states/${groups[0].type_id}`,
      );
    }
  }, [groups, activeId, router]);

  if (!groups) {
    return (
      <div className="settings-panel">
        <p className="form__hint">Loading flow states…</p>
      </div>
    );
  }

  return (
    <>
      <SecondaryNavigation<string>
        ariaLabel="Artefact type flows"
        active={activeId || (groups[0]?.type_id ?? "")}
        onChange={handleTabChange}
        items={groups.map((g) => ({
          key:     g.type_id,
          label:   g.type_name,
          sortKey: g.type_name,
        }))}
      />
      {children}
    </>
  );
}
