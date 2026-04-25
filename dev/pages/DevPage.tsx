"use client";

import { useState } from "react";
import "@dev/styles/dev.css";
import { useMasterDebug } from "@/app/contexts/MasterDebugContext";

export default function DevPage() {
  const [copied, setCopied] = useState(false);
  const { enabled: masterDebug, setEnabled: setMasterDebug } = useMasterDebug();

  const copyCommand = () => {
    navigator.clipboard.writeText("bash dev/scripts/ssh_manager.sh");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="dev-root">
      <header className="dev-page-header">
        <h1 className="dev-page-header__title">Dev Setup</h1>
        <p className="dev-page-header__subtitle">Server access & SSH tunnel configuration</p>
      </header>

      <div className="dev-doc">
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
