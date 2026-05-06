"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";

const TABS = ["organization", "workspaces", "users", "permissions", "topology", "portfolio_model", "work_items"] as const;
type TabKey = typeof TABS[number];

const TAB_HEADERS: Record<TabKey, { title: string; subtitle: string }> = {
  organization:    { title: "Organization",    subtitle: "Workspace identity, region, and support contact" },
  workspaces:      { title: "Workspaces",      subtitle: "Active and archived workspaces in this tenant" },
  users:           { title: "Users",           subtitle: "Invite, manage, and assign roles to tenant members" },
  permissions:     { title: "Permissions",     subtitle: "Capabilities granted to each role in this tenant" },
  topology:        { title: "Topology",        subtitle: "Federated org canvas — offices, teams, and reporting lines" },
  portfolio_model: { title: "Portfolio Model", subtitle: "Adopt a model or preview your subscription's adopted bundle" },
  work_items:      { title: "Work Items",      subtitle: "Flows for system, portfolio, and custom artefact types" },
};

// Tab key → URL path segment (only overrides where they differ)
const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  portfolio_model: "portfolio-model",
  work_items:      "work-items",
};

// URL path segment → tab key
const SEG_TO_KEY: Record<string, TabKey> = {
  organization:    "organization",
  workspaces:      "workspaces",
  users:           "users",
  permissions:     "permissions",
  topology:        "topology",
  "portfolio-model": "portfolio_model",
  "work-items":    "work_items",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

export default function WorkspaceSettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const canAdminWorkspace = useHasPermission("workspace.archive");
  const canManageFlows    = useHasPermission("flows.manage");
  const router            = useRouter();
  const pathname          = usePathname();

  useEffect(() => {
    if (user && !canAdminWorkspace) router.replace("/dashboard");
  }, [user, canAdminWorkspace, router]);

  if (!user || !canAdminWorkspace) return null;

  // Derive active tab from the last path segment.
  const segments = pathname.split("/").filter(Boolean);
  const lastSeg  = segments[segments.length - 1] ?? "";
  const activeTab: TabKey = SEG_TO_KEY[lastSeg] ?? "organization";

  const header = TAB_HEADERS[activeTab];

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/${segmentForKey(key)}`);
  }

  return (
    <PageShell title={header.title} subtitle={header.subtitle} barTitle="Workspace Settings">
      <SecondaryNavigation<TabKey>
        ariaLabel="Workspace settings sections"
        pageId="workspace-settings"
        reorderable
        active={activeTab}
        onChange={handleTabChange}
        items={[
          { key: "organization",    label: "Organization",    sortKey: "Organization" },
          { key: "workspaces",      label: "Workspaces",      sortKey: "Workspaces" },
          { key: "users",           label: "Users",           sortKey: "Users" },
          { key: "permissions",     label: "Permissions",     sortKey: "Permissions" },
          { key: "topology",        label: "Topology",        sortKey: "Topology" },
          { key: "portfolio_model", label: "Portfolio Model", sortKey: "Portfolio Model" },
          ...(canManageFlows ? [{ key: "work_items" as const, label: "Work Items", sortKey: "Work Items" }] : []),
        ]}
      />
      {children}
    </PageShell>
  );
}
