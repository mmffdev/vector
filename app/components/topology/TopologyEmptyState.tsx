"use client";

import { useState } from "react";
import { topologyApi } from "@/app/lib/topologyApi";

export function TopologyEmptyState({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await topologyApi.create({ name: name.trim() });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create node");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="topo-overlay__empty">
      <div className="topo-overlay__empty-card">
        <h2>Welcome to Topology</h2>
        <p>Add your first office or department to start building your org chart.</p>
        <div className="topo-overlay__empty-row">
          <input
            type="text"
            className="form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Head office"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            autoFocus
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void submit()}
            disabled={!name.trim() || busy}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
        {error && <p className="form__error">{error}</p>}
      </div>
    </div>
  );
}
