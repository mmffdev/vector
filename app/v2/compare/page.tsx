"use client";

// Phase 3 PoC: lightweight A/B rig. Renders the production page and the
// v2/vector_artefacts PoC page side-by-side as same-origin iframes so the
// user can eyeball parity without a bench harness or screenshot diff.
//
// Production routes need a real Go session — open this page only after
// logging into the (user) shell at /dashboard. /v2 routes are public.

import { useState } from "react";

interface Pair {
  id:    string;
  label: string;
  prod:  string;
  v2:    string;
}

const PAIRS: Pair[] = [
  { id: "work-items",      label: "Work Items",      prod: "/work-items",                              v2: "/v2/work-items"      },
  { id: "portfolio-model", label: "Portfolio Model", prod: "/portfolio-model",                         v2: "/v2/portfolio-model" },
  { id: "custom-fields",   label: "Custom Fields",   prod: "/workspace-settings/custom-fields/work-items", v2: "/v2/custom-fields"   },
];

export default function CompareV2Page() {
  const [pairId, setPairId] = useState(PAIRS[0].id);
  const pair = PAIRS.find((p) => p.id === pairId) ?? PAIRS[0];

  return (
    <>
      <header style={{ marginBottom: "16px" }}>
        <h1 className="page-title">A/B compare (v2 PoC)</h1>
        <p className="page-subtitle">
          Production (left) vs. vector_artefacts PoC (right). Same browser
          session — production needs you logged in via the (user) shell.
        </p>
      </header>

      <div className="form__row form__row--inline" style={{ alignItems: "center", marginBottom: "16px" }}>
        <span className="pill pill--warning">Vector Artefacts · PoC</span>
        <label className="form__label" style={{ flex: "0 0 auto" }}>
          Pair
          <select
            className="form__select"
            value={pairId}
            onChange={(e) => setPairId(e.target.value)}
          >
            {PAIRS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <span className="form__hint">
          Comparing <code>{pair.prod}</code> ↔ <code>{pair.v2}</code>
        </span>
      </div>

      <div
        style={{
          display:             "grid",
          gridTemplateColumns: "1fr 1fr",
          gap:                 "16px",
          height:              "calc(100vh - 220px)",
          minHeight:           "640px",
        }}
      >
        <Pane title="Production" url={pair.prod} variant="neutral" />
        <Pane title="v2 PoC"     url={pair.v2}   variant="warning" />
      </div>
    </>
  );
}

function Pane({ title, url, variant }: { title: string; url: string; variant: "neutral" | "warning" }) {
  return (
    <section
      style={{
        display:       "flex",
        flexDirection: "column",
        border:        "1px solid var(--border-subtle, #d0d4dc)",
        borderRadius:  "8px",
        overflow:      "hidden",
        background:    "var(--surface, #fff)",
      }}
    >
      <header
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "8px 12px",
          borderBottom:   "1px solid var(--border-subtle, #d0d4dc)",
          background:     "var(--surface-muted, #f4f5f8)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`pill pill--${variant}`}>{title}</span>
          <code className="form__hint">{url}</code>
        </span>
        <a href={url} target="_blank" rel="noreferrer" className="form__hint" style={{ textDecoration: "underline" }}>
          Open ↗
        </a>
      </header>
      <iframe
        src={url}
        title={title}
        style={{ flex: 1, border: "none", width: "100%", background: "#fff" }}
      />
    </section>
  );
}
