// PortfolioModel.jsx — converted from live "Vector + Portfolio Model" page
const { useState } = React;

function Chip({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "var(--surface-sunken)", fg: "var(--ink-muted)" },
    info:    { bg: "var(--info-bg)",        fg: "var(--info)" },
    success: { bg: "var(--success-bg)",     fg: "var(--success)" },
  };
  const t = tones[tone];
  return <span style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",borderRadius:9999,fontSize:11,fontWeight:500,letterSpacing:"0.04em",background:t.bg,color:t.fg}}>{children}</span>;
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width:36, height:20, padding:0, border:"none",
        background: on ? "var(--ink)" : "var(--border-strong)",
        borderRadius:9999, position:"relative", cursor:"pointer",
        transition:"background .15s ease",
      }}
      aria-pressed={on}
    >
      <span style={{
        position:"absolute", top:2, left: on ? 18 : 2,
        width:16, height:16, borderRadius:"50%", background:"#fff",
        transition:"left .15s ease",
      }}/>
    </button>
  );
}

function PortfolioModel() {
  const [artifacts, setArtifacts] = useState({ epic: true, ot: false, agreed: false });
  const set = (k) => (v) => setArtifacts({ ...artifacts, [k]: v });

  const layers = [
    { ord: 1, tag: "PFR", name: "Portfolio Review",   desc: "Business review — sells the outcomes & vision." },
    { ord: 2, tag: "PR",  name: "Product",            desc: "Logical sets that share roadmap or release cadence." },
    { ord: 3, tag: "BO",  name: "Business Objective", desc: "Measurable outcome the portfolio is pursuing." },
    { ord: 4, tag: "TH",  name: "Theme",              desc: "Recurring topics or strategic capability that ties stories." },
    { ord: 5, tag: "FE",  name: "Feature",            desc: "Actionable user-facing change that delivers value to a user." },
  ];

  const workflows = [
    { tag: "PFR", name: "Portfolio Review" },
    { tag: "PR",  name: "Product" },
    { tag: "BO",  name: "Business Objective" },
    { tag: "FEA", name: "Features" },
    { tag: "TH",  name: "Theme" },
  ];

  const terms = [
    { key: "portfolio.feature",   value: "Feature" },
    { key: "portfolio.objective", value: "Business Objective" },
    { key: "portfolio.product",   value: "Product" },
    { key: "portfolio.review",    value: "Portfolio Review" },
    { key: "portfolio.theme",     value: "Theme" },
  ];

  return (
    <main className="page" style={{maxWidth:1200}}>
      {/* Page intro card */}
      <div className="card" style={{padding:"24px 28px",marginBottom:20}}>
        <button className="btn btn--ghost btn--sm" style={{marginBottom:10,paddingLeft:0}}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <h1 style={{fontSize:24,fontWeight:600,letterSpacing:"-0.01em",margin:0}}>MMFF Standard</h1>
          <Chip tone="info">DEFAULT</Chip>
          <Chip tone="success">v3.1</Chip>
          <Chip>PUBLISHED</Chip>
        </div>
        <p style={{margin:"0 0 14px",fontSize:14,color:"var(--ink-muted)",lineHeight:"22px",maxWidth:880}}>
          The default MMFF portfolio model. Portfolio Review → Product → Business Objective → Theme → Feature, with workflows for each.
        </p>
        <div style={{display:"flex",gap:32,flexWrap:"wrap",fontSize:12,color:"var(--ink-muted)"}}>
          <div style={{flexShrink:0,minWidth:240}}><div className="eyebrow" style={{marginBottom:4,whiteSpace:"nowrap"}}>Model ID</div><span style={{fontFamily:"var(--font-mono)",color:"var(--ink)"}}>mmff-2024-portfolio-model-standard</span></div>
          <div style={{flexShrink:0,minWidth:80}}><div className="eyebrow" style={{marginBottom:4,whiteSpace:"nowrap"}}>Version</div><span style={{color:"var(--ink)"}}>v3.1</span></div>
          <div style={{flexShrink:0,minWidth:120}}><div className="eyebrow" style={{marginBottom:4,whiteSpace:"nowrap"}}>Last updated</div><span style={{color:"var(--ink)"}}>26 Apr 2026</span></div>
        </div>
      </div>

      {/* LAYERS */}
      <div style={{marginBottom:8}}><span className="eyebrow">Layers</span></div>
      <div className="table-wrap" style={{marginBottom:24}}>
        <table className="tbl">
          <thead><tr>
            <th style={{width:80}}>Order</th>
            <th style={{width:100}}>Tag</th>
            <th style={{width:220}}>Name</th>
            <th>Description</th>
          </tr></thead>
          <tbody>
            {layers.map(l => (
              <tr key={l.ord}>
                <td className="num" style={{textAlign:"left",fontVariantNumeric:"tabular-nums",color:"var(--ink-muted)"}}>{l.ord}</td>
                <td><span style={{fontFamily:"var(--font-mono)",fontSize:12,color:"var(--ink)",background:"var(--surface-sunken)",padding:"2px 8px",borderRadius:6}}>{l.tag}</span></td>
                <td style={{fontWeight:500}}>{l.name}</td>
                <td style={{color:"var(--ink-muted)"}}>{l.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
        <button className="btn btn--ghost btn--sm" style={{paddingLeft:0}}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Browse changes
        </button>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn--secondary btn--sm">Cancel</button>
          <button className="btn btn--primary btn--sm">Confirm Changes</button>
        </div>
      </div>

      {/* WORKFLOWS */}
      <div style={{marginBottom:8}}><span className="eyebrow">Workflows</span></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
        {workflows.map(w => (
          <button key={w.tag} className="card" style={{padding:"14px 16px",textAlign:"left",cursor:"pointer",border:"1px solid var(--border)",background:"var(--surface)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ink-muted)",background:"var(--surface-sunken)",padding:"1px 6px",borderRadius:4}}>{w.tag}</span>
            </div>
            <div style={{fontSize:13,fontWeight:500,color:"var(--ink)"}}>{w.name}</div>
          </button>
        ))}
      </div>

      {/* ARTIFACTS */}
      <div style={{marginBottom:8}}><span className="eyebrow">Artifacts</span></div>
      <div className="table-wrap" style={{marginBottom:24}}>
        <table className="tbl">
          <thead><tr><th>Key</th><th style={{width:120}}>Enabled</th></tr></thead>
          <tbody>
            <tr><td style={{fontFamily:"var(--font-mono)",fontSize:13}}>epic</td><td><Toggle on={artifacts.epic} onChange={set("epic")}/></td></tr>
            <tr><td style={{fontFamily:"var(--font-mono)",fontSize:13}}>ot</td><td><Toggle on={artifacts.ot} onChange={set("ot")}/></td></tr>
            <tr><td style={{fontFamily:"var(--font-mono)",fontSize:13}}>agreed</td><td><Toggle on={artifacts.agreed} onChange={set("agreed")}/></td></tr>
          </tbody>
        </table>
      </div>

      {/* TERMINOLOGY */}
      <div style={{marginBottom:8}}><span className="eyebrow">Terminology</span></div>
      <div className="table-wrap" style={{marginBottom:32}}>
        <table className="tbl">
          <thead><tr><th>Key</th><th>Value</th></tr></thead>
          <tbody>
            {terms.map(t => (
              <tr key={t.key}>
                <td style={{fontFamily:"var(--font-mono)",fontSize:13,color:"var(--ink-muted)"}}>{t.key}</td>
                <td style={{fontWeight:500}}>{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

window.PortfolioModel = PortfolioModel;
