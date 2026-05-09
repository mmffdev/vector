"use client";

import { useCallback, useEffect, useState } from "react";
import "@dev/styles/dev.css";
import "@dev/styles/dev-ui.css";
import { useMasterDebug } from "@/app/contexts/MasterDebugContext";
import { useDevTab } from "@/app/contexts/DevTabContext";
import { usePageHeader } from "@/app/contexts/PageHeaderContext";
import { apiSite } from "@/app/lib/api";
import { getWorkspaceFields } from "@/app/lib/fieldsApi";
import { workspacesApi } from "@/app/lib/workspacesApi";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import ServiceHealthPanel from "@/app/components/ServiceHealthPanel";
import DevShortcutsPanel from "./DevShortcutsPanel";
import DevReportsPanel from "./DevReportsPanel";
import DevResearchPanel from "./DevResearchPanel";
import DevOperationsPanel from "./DevOperationsPanel";
import DevPlansPanel from "./DevPlansPanel";
import DevRetrosPanel from "./DevRetrosPanel";
import DevPageHelpPanel from "./DevPageHelpPanel";
import DevUiCatalogPanel from "./DevUiCatalogPanel";
import DevApiV2TestsPanel from "./DevApiV2TestsPanel";
import DevApiChangelogPanel from "./DevApiChangelogPanel";
import DevScopePanel from "./DevScopePanel";
import UiAppIconbrowser from "@dev/store/ui_apps/ui_app_iconbrowser/d_store_app_iconbrowser-index";
import DevTabNav, { type DevTab } from "@dev/components/DevTabNav";

const GROWTHBAR_MAX = 100;
const GROWTHBAR_KEY = "dev.scope.growthbar.v1";

function formatGrowthbarTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} : ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type GrowthbarSnapshot = { count: number; at: number | null };

function readGrowthbar(): GrowthbarSnapshot {
  if (typeof window === "undefined") return { count: 0, at: null };
  try {
    const raw = window.localStorage.getItem(GROWTHBAR_KEY);
    if (!raw) return { count: 0, at: null };
    const parsed = JSON.parse(raw) as Partial<GrowthbarSnapshot>;
    const count =
      typeof parsed.count === "number" && parsed.count >= 0 && parsed.count <= GROWTHBAR_MAX
        ? parsed.count
        : 0;
    const at = typeof parsed.at === "number" ? parsed.at : null;
    return { count, at };
  } catch {
    return { count: 0, at: null };
  }
}

function writeGrowthbar(snap: GrowthbarSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GROWTHBAR_KEY, JSON.stringify(snap));
  } catch {
    // quota exceeded / private mode — non-fatal
  }
}

const DEV_TABS: readonly DevTab[] = [
  { key: "plans",         label: "Plans" },
  { key: "retros",        label: "Retros" },
  { key: "setup",         label: "Setup" },
  { key: "shortcuts",     label: "Shortcuts" },
  { key: "reports",       label: "Reports" },
  { key: "research",      label: "Research" },
  { key: "operations",    label: "Operations" },
  { key: "icons",         label: "Icons" },
  { key: "page-help",     label: "Page Help" },
  { key: "ui-catalog",    label: "UI Catalog" },
  { key: "api-v2-tests",  label: "API v2 Tests" },
  { key: "api-changelog", label: "API Changelog" },
  { key: "scope",         label: "Scope" },
] as const;

const TAB_LABELS: Record<string, string> = Object.fromEntries(
  DEV_TABS.map((t) => [t.key, t.label])
);

export default function DevPage() {
  const { activeTab: tab, setActiveTab: setTab } = useDevTab();
  // Drives the global PageHeaderBar ("Vector + <tab>") and PageTitleRow.
  // Replaces the old inline <header className="dev-page-header">.
  usePageHeader({
    title: `Dev Setup · ${TAB_LABELS[tab] ?? "Setup"}`,
    subtitle: "Standalone diagnostic tool for monitoring and managing the local and remote development environment",
  });
  const [copied, setCopied] = useState(false);
  const { enabled: masterDebug, setEnabled: setMasterDebug } = useMasterDebug();
  const [resetLoading, setResetLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fieldsProbe, setFieldsProbe] = useState<{ ok: boolean; message: string } | null>(null);
  const [fieldsProbeLoading, setFieldsProbeLoading] = useState(false);
  const [tickCount, setTickCount] = useState(0);
  const [tickAt, setTickAt] = useState<Date | null>(null);

  useEffect(() => {
    const snap = readGrowthbar();
    setTickCount(snap.count);
    setTickAt(snap.at != null ? new Date(snap.at) : null);
  }, []);

  const handleScopeTick = useCallback((at: Date) => {
    setTickCount((n) => {
      const next = n >= GROWTHBAR_MAX ? 1 : n + 1;
      writeGrowthbar({ count: next, at: at.getTime() });
      return next;
    });
    setTickAt(at);
  }, []);

  const cancelReset = () => { setResetConfirm(false); setResetConfirmText(""); };

  // PLA-0026 / Story 00510 (F4) — smoke probe for GET
  // /api/workspace/{id}/fields. Picks the first live workspace in the
  // caller's tenant, calls getWorkspaceFields, reports the row count.
  // Diagnostic only; no consumer wiring yet.
  const probeWorkspaceFields = async () => {
    setFieldsProbeLoading(true);
    setFieldsProbe(null);
    try {
      const workspaces = await workspacesApi.list();
      if (workspaces.length === 0) {
        setFieldsProbe({ ok: false, message: "No workspaces in tenant — cannot probe." });
        return;
      }
      const ws = workspaces[0];
      const fields = await getWorkspaceFields(ws.id);
      setFieldsProbe({ ok: true, message: `${fields.length} field(s) admitted for workspace "${ws.name}".` });
    } catch (error: any) {
      setFieldsProbe({ ok: false, message: error?.message || "Probe failed." });
    } finally {
      setFieldsProbeLoading(false);
    }
  };

  const copyCommand = () => {
    navigator.clipboard.writeText("bash dev/scripts/ssh_manager.sh");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirmReset = async () => {
    setResetConfirm(false);
    setResetConfirmText("");
    setResetLoading(true);
    setResetResult(null);

    try {
      const response = (await apiSite("/admin/dev/adoption-reset", { method: "POST" })) as { message?: string };
      setResetResult({
        success: true,
        message: response.message || "Adoption state reset successfully.",
      });
    } catch (error: any) {
      setResetResult({
        success: false,
        message: error?.message || "Failed to reset adoption state.",
      });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <StrictRoute>
    <div className="dev-root">
      <div className="dui-sticky-subheader">
        <DevTabNav
          tabs={DEV_TABS}
          active={tab}
          onChange={(key) => setTab(key as Parameters<typeof setTab>[0])}
          storageKey="dev.tabs"
        />
        {tab === "scope" && (
          <div className="dui-sticky-subheader__row">
            <span className="dui-growthbar" aria-label={`Live updates: ${tickCount}`}>
              {Array.from({ length: tickCount }, (_, i) => (
                <span key={i} className="dui-growthbar__tick" />
              ))}
              <span className="dui-growthbar__time">
                {tickAt
                  ? `Updated ${formatGrowthbarTime(tickAt)}`
                  : "Waiting for first update…"}
              </span>
            </span>
          </div>
        )}
      </div>

      {tab === "shortcuts" && <DevShortcutsPanel />}
      {tab === "reports" && <DevReportsPanel />}
      {tab === "research" && <DevResearchPanel />}
      {tab === "operations" && <DevOperationsPanel />}
      {tab === "plans" && <DevPlansPanel />}
      {tab === "retros" && <DevRetrosPanel />}
      {tab === "page-help" && <DevPageHelpPanel />}
      {tab === "ui-catalog" && <DevUiCatalogPanel />}
      {tab === "api-v2-tests" && <DevApiV2TestsPanel />}
      {tab === "api-changelog" && <DevApiChangelogPanel />}
      {tab === "scope" && <DevScopePanel onTick={handleScopeTick} />}
      {tab === "icons" && (
        <div className="dui-icons-host">
          <UiAppIconbrowser />
        </div>
      )}

      {tab === "setup" && <div className="dev-doc">
        <Panel name="dev_health" title="Service health">
          <ServiceHealthPanel />
        </Panel>

        <Panel name="dev_debug" title="Debug">
          <label className="form__switch">
            <input
              type="checkbox"
              checked={masterDebug}
              onChange={(e) => setMasterDebug(e.target.checked)}
            />
            Master debug {masterDebug ? "on" : "off"}
          </label>
          <p className="dev-p">
            Session-scoped flag (resets on tab close / hard reload). Read it via <code>useMasterDebug()</code>.
          </p>
        </Panel>

        <Panel name="dev_portfolio_adoption" title="Portfolio Adoption">
          <p className="dev-p">
            Reset adoption state to zero (gadmin only). Deletes all adoption records and mirror tables.
          </p>
          <div className="dev-btn-group">
            <button
              onClick={() => { setResetConfirm(true); setResetResult(null); }}
              disabled={resetLoading || resetConfirm}
              className="dev-btn dev-btn--danger"
            >
              {resetLoading ? "Resetting..." : "Reset Adoption State"}
            </button>
            {resetConfirm && (
              <>
                <input
                  autoFocus
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  className={`dev-confirm-input${resetConfirmText === "RESET" ? " dev-confirm-input--ready" : ""}`}
                  placeholder="Type RESET"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && resetConfirmText === "RESET") handleConfirmReset();
                    if (e.key === "Escape") cancelReset();
                  }}
                />
                <span className="dev-confirm-hint">
                  Type <strong>RESET</strong> and press ↵ to permanently delete all adoption records and mirror tables. Esc to cancel.
                </span>
              </>
            )}
          </div>
          {resetResult && (
            <div className={`dev-alert dev-alert--${resetResult.success ? "success" : "error"}`}>
              {resetResult.message}
            </div>
          )}
        </Panel>

        <Panel name="dev_field_schema_probe" title="Field schema probe">
          <p className="dev-p">
            Calls <code>GET /api/workspace/{"{id}"}/fields</code> for the first workspace in
            your tenant and reports the admitted-field count. Verifies the F4 client
            wiring for PLA-0026.
          </p>
          <div className="dev-btn-group">
            <button
              onClick={probeWorkspaceFields}
              disabled={fieldsProbeLoading}
              className="dev-btn dev-btn--primary"
            >
              {fieldsProbeLoading ? "Probing..." : "Probe field schema"}
            </button>
          </div>
          {fieldsProbe && (
            <div className={`dev-alert dev-alert--${fieldsProbe.ok ? "success" : "error"}`}>
              {fieldsProbe.message}
            </div>
          )}
        </Panel>

        <Panel name="dev_ssh_tunnel" title="SSH Tunnel Setup">
          <p className="dev-p">
            Run the setup script to configure your laptop for server access:
          </p>

          <code className="dev-cmd">bash dev/scripts/ssh_manager.sh</code>

          <button onClick={copyCommand} className="dev-btn dev-btn--primary">
            {copied ? "Copied!" : "Copy Command"}
          </button>
        </Panel>

        <Panel name="dev_ssh_what" title="What it does">
          <ul className="dev-list">
            <li>Installs Homebrew, libpq, autossh, Node 20</li>
            <li>Generates or verifies SSH ed25519 key</li>
            <li>Pushes public key to server</li>
            <li>Creates SSH config aliases (mmffdev-pg, mmffdev-admin)</li>
            <li>Establishes SSH tunnel on localhost:5434</li>
            <li>Writes backend/.env.local with tunnel DB config</li>
            <li>Verifies PostgreSQL connectivity</li>
          </ul>
        </Panel>

        <Panel name="dev_ssh_reqs" title="Requirements">
          <ul className="dev-list">
            <li>macOS with Homebrew</li>
            <li>SSH access to server (mmffdev.com)</li>
            <li>Server password (will be prompted)</li>
          </ul>
        </Panel>
      </div>}
    </div>
    </StrictRoute>
  );
}
