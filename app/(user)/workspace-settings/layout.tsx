"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";

const TABS = ["organization", "workspaces", "users", "permissions", "topology", "topology_map", "portfolio_model", "work_items", "custom_fields", "webhooks", "customisation"] as const;
type TabKey = typeof TABS[number];

const TAB_HEADERS: Record<TabKey, { title: string; subtitle: string }> = {
  organization:    { title: "Organization",    subtitle: "Workspace identity, region, and support contact" },
  workspaces:      { title: "Workspaces",      subtitle: "Active and archived workspaces in this tenant" },
  users:           { title: "Users",           subtitle: "Invite, manage, and assign roles to tenant members" },
  permissions:     { title: "Permissions",     subtitle: "Capabilities granted to each role in this tenant" },
  topology:        { title: "Topology",        subtitle: "Federated org canvas — offices, teams, and reporting lines" },
  topology_map:    { title: "Topology Map",    subtitle: "3D map of how work items cluster across the tenant" },
  portfolio_model: { title: "Portfolio Model", subtitle: "Adopt a model or preview your subscription's adopted bundle" },
  work_items:      { title: "Work Items",      subtitle: "Flows for system, portfolio, and custom artefact types" },
  custom_fields:   { title: "Custom Fields",   subtitle: "Tenant-defined fields available on work items and portfolio artefacts" },
  webhooks:        { title: "Webhooks",        subtitle: "Manage webhook subscriptions for work item and sprint events" },
  customisation:   { title: "Customisation",   subtitle: "Branding, themes, and display preferences for this workspace" },
};

// Tab key → URL path segment (only overrides where they differ)
const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  topology_map:    "topology-map",
  portfolio_model: "portfolio-model",
  work_items:      "work-items",
  custom_fields:   "custom-fields",
};

// URL path segment → tab key
const SEG_TO_KEY: Record<string, TabKey> = {
  organization:    "organization",
  workspaces:      "workspaces",
  users:           "users",
  permissions:     "permissions",
  topology:        "topology",
  "topology-map":  "topology_map",
  "portfolio-model": "portfolio_model",
  "work-items":    "work_items",
  "custom-fields": "custom_fields",
  webhooks:        "webhooks",
  customisation:   "customisation",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

// Per-tab third-level (tertiary) sub-tab labels, keyed by URL segment.
// Used to extend the page title (e.g. "Custom Fields // Defects") when a
// top-level tab introduces its own nested routes.
const SUB_TAB_LABELS: Partial<Record<TabKey, Record<string, string>>> = {
  custom_fields: {
    "work-items":      "Work Items",
    "portfolio-items": "Portfolio Items",
    tasks:             "Tasks",
    defects:           "Defects",
    risks:             "Risks",
  },
  customisation: {
    "tenant-details": "Tenant Details",
    "artefact-types": "Artefact Types",
    "flow-states":    "Flow States",
  },
};

export default function WorkspaceSettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const canAdminWorkspace = useHasPermission("workspace.archive");
  const canAccessSettings = useHasPermission("workspace.create") || useHasPermission("workspace.archive");
  const canManageFlows    = useHasPermission("flows.manage");
  const router            = useRouter();
  const pathname          = usePathname();

  useEffect(() => {
    if (user && !canAccessSettings) {
      router.replace("/dashboard");
      return;
    }

    // If at /workspace-settings with no tab, redirect to first accessible tab
    const segments = pathname.split("/").filter(Boolean);
    const rootIdx  = segments.indexOf("workspace-settings");
    const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";

    if (!tabSeg) {
      // Determine first accessible tab for this user
      const firstTab = canAdminWorkspace ? "organization" : "portfolio_model";
      router.replace(`/workspace-settings/${segmentForKey(firstTab)}`);
    }
  }, [user, canAccessSettings, canAdminWorkspace, pathname, router]);

  if (!user || !canAccessSettings) return null;

  // Derive active tab from the segment immediately after `workspace-settings`.
  // (Reading the *last* segment would break when a tab adds its own sub-routes,
  // e.g. /workspace-settings/custom-fields/work-items.)
  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("workspace-settings");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "portfolio_model";

  const header = TAB_HEADERS[activeTab];

  // Extend title with the active tertiary sub-tab label when present.
  const subSeg    = rootIdx >= 0 ? segments[rootIdx + 2] ?? "" : "";
  const subLabel  = SUB_TAB_LABELS[activeTab]?.[subSeg];
  const fullTitle = subLabel ? `${header.title} // ${subLabel}` : header.title;

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/${segmentForKey(key)}`);
  }

  return (
    <PageShell title={fullTitle} subtitle={header.subtitle} barTitle="Workspace Settings">
      <SecondaryNavigation<TabKey>
        ariaLabel="Workspace settings sections"
        pageId="workspace-settings"
        reorderable
        active={activeTab}
        onChange={handleTabChange}
        items={[
          ...(canAdminWorkspace ? [
            { key: "organization"    as const, label: "Organization",    sortKey: "Organization" },
            { key: "workspaces"      as const, label: "Workspaces",      sortKey: "Workspaces" },
            { key: "users"           as const, label: "Users",           sortKey: "Users" },
            { key: "permissions"     as const, label: "Permissions",     sortKey: "Permissions" },
            { key: "topology"        as const, label: "Topology",        sortKey: "Topology" },
            { key: "topology_map"    as const, label: "Topology Map",    sortKey: "Topology Map" },
          ] : []),
          { key: "portfolio_model"   as const, label: "Portfolio Model", sortKey: "Portfolio Model" },
          ...(canManageFlows ? [{ key: "work_items" as const, label: "Work Items", sortKey: "Work Items" }] : []),
          { key: "custom_fields"     as const, label: "Custom Fields",   sortKey: "Custom Fields" },
          { key: "webhooks"          as const, label: "Webhooks",        sortKey: "Webhooks" },
          { key: "customisation"     as const, label: "Customisation",   sortKey: "Customisation" },
        ]}
      />
      {children}
    </PageShell>
  );
}
