"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import SecondaryNavigation from "@/app/components/SecondaryNavigation";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { useTenantName } from "@/app/contexts/TenantContext";

const TABS = ["workspace_settings", "users", "permissions", "vector_admin"] as const;
type TabKey = typeof TABS[number];

const TAB_HEADERS: Record<TabKey, { title: string; subtitle: string }> = {
  workspace_settings: { title: "Workspace Settings", subtitle: "Workspaces and other workspace-level admin" },
  users:           { title: "Users",           subtitle: "Invite, manage, and assign roles to tenant members" },
  permissions:     { title: "Permissions",     subtitle: "Capabilities granted to each role in this tenant" },
  vector_admin:    { title: "Vector Admin",    subtitle: "Global preferences for Vector and <%tenant_name%>" },
};

// Tab key → URL path segment (only overrides where they differ)
const KEY_TO_SEG: Partial<Record<TabKey, string>> = {
  workspace_settings: "workspace-settings",
  vector_admin:       "vector-admin",
};

// URL path segment → tab key
const SEG_TO_KEY: Record<string, TabKey> = {
  "workspace-settings": "workspace_settings",
  users:           "users",
  permissions:     "permissions",
  "vector-admin":  "vector_admin",
};

function segmentForKey(key: TabKey): string {
  return KEY_TO_SEG[key] ?? key;
}

// Per-tab third-level (tertiary) sub-tab labels, keyed by URL segment.
// Used to extend the page title (e.g. "Custom Fields // Defects") when a
// top-level tab introduces its own nested routes.
const SUB_TAB_LABELS: Partial<Record<TabKey, Record<string, string>>> = {
  workspace_settings: {
    organisation:      "Organisation",
    workspaces:        "Workspaces",
    "custom-fields":   "Custom Fields",
    "portfolio-model": "Portfolio Model",
  },
  vector_admin: {
    "tenant-details": "Tenant Details",
    "artefact-types": "Artefact Types",
    "flow-states":    "Flow States",
    "work-items":     "Work Items",
    topology:         "Topology",
    "topology-map":   "Topology Map",
    "api-manager":    "API Manager",
  },
};

export default function WorkspaceSettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const canAdminWorkspace = useHasPermission("workspace.archive");
  const canAccessSettings = useHasPermission("workspace.create") || useHasPermission("workspace.archive");
  const router            = useRouter();
  const pathname          = usePathname();
  const tenantName        = useTenantName();

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
      // Determine first accessible tab for this user. Non-admins land on the
      // Portfolio Model surface (now nested under workspace_settings).
      if (canAdminWorkspace) {
        router.replace("/workspace-settings/vector-admin");
      } else {
        router.replace("/workspace-settings/workspace-settings/portfolio-model");
      }
    }
  }, [user, canAccessSettings, canAdminWorkspace, pathname, router]);

  if (!user || !canAccessSettings) return null;

  // Derive active tab from the segment immediately after `workspace-settings`.
  // (Reading the *last* segment would break when a tab adds its own sub-routes,
  // e.g. /workspace-settings/custom-fields/work-items.)
  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("workspace-settings");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeTab: TabKey = SEG_TO_KEY[tabSeg] ?? "workspace_settings";

  const header = TAB_HEADERS[activeTab];

  // Extend title with the active tertiary sub-tab label when present.
  const subSeg    = rootIdx >= 0 ? segments[rootIdx + 2] ?? "" : "";
  const subLabel  = SUB_TAB_LABELS[activeTab]?.[subSeg];
  const fullTitle = subLabel ? `${header.title} // ${subLabel}` : header.title;
  const subtitle  = header.subtitle.replace("<%tenant_name%>", tenantName || "this workspace");

  function handleTabChange(key: TabKey) {
    router.push(`/workspace-settings/${segmentForKey(key)}`);
  }

  return (
    <PageShell title={fullTitle} subtitle={subtitle} barTitle="Vector Settings">
      <SecondaryNavigation<TabKey>
        ariaLabel="Workspace settings sections"
        pageId="workspace-settings"
        reorderable
        active={activeTab}
        onChange={handleTabChange}
        items={[
          ...(canAdminWorkspace ? [
            { key: "workspace_settings" as const, label: "Workspace Settings", sortKey: "Workspace Settings" },
            { key: "users"           as const, label: "Users",           sortKey: "Users" },
            { key: "permissions"     as const, label: "Permissions",     sortKey: "Permissions" },
          ] : []),
          { key: "vector_admin"      as const, label: "Vector Admin",    sortKey: "Vector Admin" },
        ]}
      />
      {children}
    </PageShell>
  );
}
