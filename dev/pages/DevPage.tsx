"use client";

import { useState } from "react";
import "@dev/styles/dev.css";
import { useMasterDebug } from "@/app/contexts/MasterDebugContext";
import { api } from "@/app/lib/api";
import DevServicesPanel from "./DevServicesPanel";

export default function DevPage() {
  const [copied, setCopied] = useState(false);
  const { enabled: masterDebug, setEnabled: setMasterDebug } = useMasterDebug();
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);

  const copyCommand = () => {
    navigator.clipboard.writeText("bash dev/scripts/ssh_manager.sh");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetAdoption = async () => {
    if (!window.confirm("Reset portfolio adoption to zero state? This will delete all adoption records and mirrors.")) {
      return;
    }

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
        <p className="dev-page-header__subtitle">Server access & SSH tunnel configuration</p>
      </header>

      <div className="dev-doc">
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
          <button
            onClick={handleResetAdoption}
            disabled={resetLoading}
            className="dev-btn dev-btn--danger"
          >
            {resetLoading ? "Resetting..." : "Reset Adoption State"}
          </button>
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
      </div>
    </div>
  );
}
