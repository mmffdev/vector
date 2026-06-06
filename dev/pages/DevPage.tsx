"use client";

import { useState } from "react";
import "@dev/styles/dev.css";
import "@dev/styles/dev-ui.css";
import { useMasterDebug } from "@/app/contexts/MasterDebugContext";
import { usePageHeader } from "@/app/contexts/PageHeaderContext";
import { apiSite } from "@/app/lib/api";
import { admin } from "@/app/lib/apiSite";
import { getWorkspaceFields } from "@/app/lib/fieldsApi";
import { workspacesApi } from "@/app/lib/workspacesApi";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import ServiceHealthPanel from "@/app/components/ServiceHealthPanel";

export default function DevSetupPage() {
  usePageHeader({
    title: "Dev Setup · Setup",
    subtitle: "Standalone diagnostic tool for monitoring and managing the local and remote development environment",
  });
  const [copied, setCopied] = useState(false);
  const { enabled: masterDebug, setEnabled: setMasterDebug } = useMasterDebug();
  const [resetLoading, setResetLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [masterResetLoading, setMasterResetLoading] = useState(false);
  const [masterResetConfirm, setMasterResetConfirm] = useState(false);
  const [masterResetConfirmText, setMasterResetConfirmText] = useState("");
  const [masterResetResult, setMasterResetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fieldsProbe, setFieldsProbe] = useState<{ ok: boolean; message: string } | null>(null);
  const [fieldsProbeLoading, setFieldsProbeLoading] = useState(false);
  const [seedRisksCount, setSeedRisksCount] = useState(200);
  const [seedRisksLoading, setSeedRisksLoading] = useState(false);
  const [seedRisksResult, setSeedRisksResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSeedRisks = async () => {
    setSeedRisksLoading(true);
    setSeedRisksResult(null);
    try {
      const res = await admin.devSeedRisks({ count: seedRisksCount });
      setSeedRisksResult({ ok: true, message: res.message ?? `Inserted ${res.inserted} risk(s).` });
    } catch (error: unknown) {
      setSeedRisksResult({ ok: false, message: error instanceof Error ? error.message : "Seed failed." });
    } finally {
      setSeedRisksLoading(false);
    }
  };

  const cancelReset = () => { setResetConfirm(false); setResetConfirmText(""); };
  const cancelMasterReset = () => { setMasterResetConfirm(false); setMasterResetConfirmText(""); };

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
    } catch (error: unknown) {
      setFieldsProbe({ ok: false, message: error instanceof Error ? error.message : "Probe failed." });
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
      setResetResult({ success: true, message: response.message || "Adoption state reset successfully." });
    } catch (error: unknown) {
      setResetResult({ success: false, message: error instanceof Error ? error.message : "Failed to reset adoption state." });
    } finally {
      setResetLoading(false);
    }
  };

  const handleConfirmMasterReset = async () => {
    setMasterResetConfirm(false);
    setMasterResetConfirmText("");
    setMasterResetLoading(true);
    setMasterResetResult(null);
    try {
      const response = await admin.devMasterReset();
      setMasterResetResult({ success: true, message: response?.message || "Master reset complete." });
    } catch (error: unknown) {
      setMasterResetResult({ success: false, message: error instanceof Error ? error.message : "Master reset failed." });
    } finally {
      setMasterResetLoading(false);
    }
  };

  return (
    <StrictRoute>
    <div className="dev-root">
      <div className="dev-doc">
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

        <Panel name="dev_master_reset" title="Master Reset">
          <p className="dev-p">
            Full testbed reset (gadmin only). Wipes <strong>all</strong> tenant data across both databases — artefacts, topology, workspaces, adoption state, and tenant settings — then re-seeds ACME Bank defaults with a single root topology node. Does <strong>not</strong> touch users, passwords, roles, permissions, pages, or nav prefs.
          </p>
          <div className="dev-btn-group">
            <button
              onClick={() => { setMasterResetConfirm(true); setMasterResetResult(null); }}
              disabled={masterResetLoading || masterResetConfirm}
              className="dev-btn dev-btn--danger"
            >
              {masterResetLoading ? "Resetting..." : "Master Reset"}
            </button>
            {masterResetConfirm && (
              <>
                <input
                  autoFocus
                  value={masterResetConfirmText}
                  onChange={(e) => setMasterResetConfirmText(e.target.value)}
                  className={`dev-confirm-input${masterResetConfirmText === "MASTER RESET" ? " dev-confirm-input--ready" : ""}`}
                  placeholder="Type MASTER RESET"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && masterResetConfirmText === "MASTER RESET") handleConfirmMasterReset();
                    if (e.key === "Escape") cancelMasterReset();
                  }}
                />
                <span className="dev-confirm-hint">
                  Type <strong>MASTER RESET</strong> and press ↵ to wipe all tenant data and re-seed testbed defaults. Esc to cancel.
                </span>
              </>
            )}
          </div>
          {masterResetResult && (
            <div className={`dev-alert dev-alert--${masterResetResult.success ? "success" : "error"}`}>
              {masterResetResult.message}
            </div>
          )}
        </Panel>

        <Panel name="dev_seed_risks" title="Seed Risks">
          <p className="dev-p">
            Inserts N Risk artefacts into <code>vector_artefacts.artefacts</code> for the current
            subscription, assigned to you. Each batch round-robins across the default Risk flow's
            states and the four priority levels so the <code>/risk</code> dashboard fills with
            varied data. Mirrors <code>db/vector_artefacts/dev-seeds/seed_risks.sql</code>.
          </p>
          <div className="dev-btn-group">
            <input
              type="number"
              min={1}
              max={5000}
              value={seedRisksCount}
              onChange={(e) => setSeedRisksCount(Math.max(1, Math.min(5000, Number(e.target.value) || 0)))}
              className="dev-num-input"
              disabled={seedRisksLoading}
            />
            <button
              onClick={handleSeedRisks}
              disabled={seedRisksLoading}
              className="dev-btn dev-btn--primary"
            >
              {seedRisksLoading ? "Seeding..." : `Seed ${seedRisksCount} risks`}
            </button>
          </div>
          {seedRisksResult && (
            <div className={`dev-alert dev-alert--${seedRisksResult.ok ? "success" : "error"}`}>
              {seedRisksResult.message}
            </div>
          )}
        </Panel>

        <Panel name="dev_field_schema_probe" title="Field schema probe">
          <p className="dev-p">
            Calls <code>GET /api/workspace/{"{id}"}/fields</code> for the first workspace in
            your tenant and reports the admitted-field count.
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
          <p className="dev-p">Run the setup script to configure your laptop for server access:</p>
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
      </div>
    </div>
    </StrictRoute>
  );
}
