"use client";

import { useParams } from "next/navigation";
import "@dev/styles/dev.css";
import "@dev/styles/dev-ui.css";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { usePageHeader } from "@/app/contexts/PageHeaderContext";
import DevSetupPage from "@dev/pages/DevPage";
import DevShortcutsPanel from "@dev/pages/DevShortcutsPanel";
import DevReportsPanel from "@dev/pages/DevReportsPanel";
import DevResearchPanel from "@dev/pages/DevResearchPanel";
import DevOperationsPanel from "@dev/pages/DevOperationsPanel";
import DevPlansPanel from "@dev/pages/DevPlansPanel";
import DevRetrosPanel from "@dev/pages/DevRetrosPanel";
import DevPageHelpPanel from "@dev/pages/DevPageHelpPanel";
import DevUiCatalogPanel from "@dev/pages/DevUiCatalogPanel";
import DevApiV2TestsPanel from "@dev/pages/DevApiV2TestsPanel";
import DevApiChangelogPanel from "@dev/pages/DevApiChangelogPanel";
import DevApiAuditPanel from "@dev/pages/DevApiAuditPanel";
import DevScopePanel from "@dev/pages/DevScopePanel";
import DevComponentsPanel from "@dev/pages/DevComponentsPanel";
import DevSecurityAuditsPanel from "@dev/pages/DevSecurityAuditsPanel";
import UiAppIconbrowser from "@dev/store/ui_apps/ui_app_iconbrowser/d_store_app_iconbrowser-index";

const TAB_TITLES: Record<string, string> = {
  setup:         "Setup",
  plans:         "Plans",
  retros:        "Retros",
  scope:         "Scope",
  research:      "Research",
  reports:       "Reports",
  shortcuts:     "Shortcuts",
  operations:    "Operations",
  "page-help":   "Page Help",
  "ui-catalog":  "UI Catalog",
  icons:         "Icons",
  "api-v2-tests":  "API v2 Tests",
  "api-changelog": "API Changelog",
  "api-audit":     "API Audit",
  "components":       "Components",
  "security-audits":  "Security Audits",
};

export default function DevTabPage() {
  const params = useParams<{ tab: string }>();
  const tab = params?.tab ?? "setup";
  const title = TAB_TITLES[tab] ?? "Dev";

  usePageHeader({
    title: `Dev Setup · ${title}`,
    subtitle: "Standalone diagnostic tool for monitoring and managing the local and remote development environment",
  });

  if (tab === "setup") return <DevSetupPage />;

  return (
    <StrictRoute>
      <div className="dev-root">
        {tab === "shortcuts"     && <DevShortcutsPanel />}
        {tab === "reports"       && <DevReportsPanel />}
        {tab === "research"      && <DevResearchPanel />}
        {tab === "operations"    && <DevOperationsPanel />}
        {tab === "plans"         && <DevPlansPanel />}
        {tab === "retros"        && <DevRetrosPanel />}
        {tab === "page-help"     && <DevPageHelpPanel />}
        {tab === "ui-catalog"    && <DevUiCatalogPanel />}
        {tab === "api-v2-tests"  && <DevApiV2TestsPanel />}
        {tab === "api-changelog" && <DevApiChangelogPanel />}
        {tab === "api-audit"     && <DevApiAuditPanel />}
        {tab === "scope"         && <DevScopePanel onTick={() => {}} />}
        {tab === "components"      && <DevComponentsPanel />}
        {tab === "security-audits" && <DevSecurityAuditsPanel />}
        {tab === "icons"           && (
          <div className="dui-icons-host">
            <UiAppIconbrowser />
          </div>
        )}
      </div>
    </StrictRoute>
  );
}
