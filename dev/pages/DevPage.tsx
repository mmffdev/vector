"use client";

import { useState } from "react";
import "@dev/styles/dev.css";
import { useMasterDebug } from "@/app/contexts/MasterDebugContext";
import { api } from "@/app/lib/api";
import DevServicesPanel from "./DevServicesPanel";
import DevShortcutsPanel from "./DevShortcutsPanel";
import DevReportsPanel from "./DevReportsPanel";
import DevResearchPanel from "./DevResearchPanel";

type DevTab = "setup" | "shortcuts" | "reports" | "research";

export default function DevPage() {
  const [tab, setTab] = useState<DevTab>("setup");
  const [copied, setCopied] = useState(false);
  const { enabled: masterDebug, setEnabled: setMasterDebug } = useMasterDebug();
  const [resetLoading, setResetLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);

  const cancelReset = () => { setResetConfirm(false); setResetConfirmText(""); };

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
      const response = await api("/api/admin/dev/adoption-reset", { method: "POST" });
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
    <div className="dev-root">
      <header className="dev-page-header">
        <h1 className="dev-page-header__title">Dev Setup</h1>
        <p className="dev-page-header__subtitle">Standalone diagnostic tool for monitoring and managing the local and remote development environment</p>
      </header>

      <nav className="dev-tabs">
        <button
          className={`dev-tab${tab === "setup" ? " dev-tab--active" : ""}`}
          onClick={() => setTab("setup")}
        >
          Setup
        </button>
        <button
          className={`dev-tab${tab === "shortcuts" ? " dev-tab--active" : ""}`}
          onClick={() => setTab("shortcuts")}
        >
          Shortcuts
        </button>
        <button
          className={`dev-tab${tab === "reports" ? " dev-tab--active" : ""}`}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
        <button
          className={`dev-tab${tab === "research" ? " dev-tab--active" : ""}`}
          onClick={() => setTab("research")}
        >
          Research
        </button>
      </nav>

      {tab === "shortcuts" && <DevShortcutsPanel />}
      {tab === "reports" && <DevReportsPanel />}
      {tab === "research" && <DevResearchPanel />}

      {tab === "setup" && <div className="dev-doc">
        <DevServicesPanel />

        <section className="dev-section">
          <h2 className="dev-h2">Debug</h2>
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
        </section>

        <section className="dev-section">
          <h2 className="dev-h2">Portfolio Adoption</h2>
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
        </section>

        <section className="dev-section">
          <h2 className="dev-h2">SSH Tunnel Setup</h2>
          <p className="dev-p">
            Run the setup script to configure your laptop for server access:
          </p>

          <code className="dev-cmd">bash dev/scripts/ssh_manager.sh</code>

          <button onClick={copyCommand} className="dev-btn dev-btn--primary">
            {copied ? "Copied!" : "Copy Command"}
          </button>
        </section>

        <section className="dev-section">
          <h3 className="dev-h3">What it does:</h3>
          <ul className="dev-list">
            <li>Installs Homebrew, libpq, autossh, Node 20</li>
            <li>Generates or verifies SSH ed25519 key</li>
            <li>Pushes public key to server</li>
            <li>Creates SSH config aliases (mmffdev-pg, mmffdev-admin)</li>
            <li>Establishes SSH tunnel on localhost:5434</li>
            <li>Writes backend/.env.local with tunnel DB config</li>
            <li>Verifies PostgreSQL connectivity</li>
          </ul>
        </section>

        <section className="dev-section">
          <h3 className="dev-h3">Requirements:</h3>
          <ul className="dev-list">
            <li>macOS with Homebrew</li>
            <li>SSH access to server (mmffdev.com)</li>
            <li>Server password (will be prompted)</li>
          </ul>
        </section>
      </div>}
    </div>
  );
}
