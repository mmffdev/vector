// Tiles, Pills, Charts, Table — small components

function Sparkline({ data, color = "var(--ink)" }) {
  const w = 64, h = 36, pad = 2;
  const max = Math.max(...data), min = Math.min(...data);
  const sx = (i) => pad + (i * (w - pad * 2)) / (data.length - 1);
  const sy = (v) => pad + (h - pad * 2) * (1 - (v - min) / (max - min || 1));
  const bw = (w - pad * 2) / data.length - 1.5;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`}>
      {data.map((v, i) => (
        <rect key={i} x={sx(i) - bw / 2} y={sy(v)} width={bw} height={h - pad - sy(v)} fill={color} />
      ))}
    </svg>
  );
}

function MetricTile({ eyebrow, value, unit, delta, spark }) {
  return (
    <div className="card tile">
      <span className="eyebrow">{eyebrow}</span>
      <div className="tile__row">
        <div className="tile__metric">{value}{unit && <small>{unit}</small>}</div>
        {spark && <Sparkline data={spark} />}
      </div>
      <div className="tile__delta"><strong>{delta}</strong> last year</div>
    </div>
  );
}

function StatusPill({ kind, children }) {
  const icons = {
    success: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    warning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5"/><circle cx="12" cy="16" r=".8" fill="currentColor"/></svg>,
    danger:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>,
    info:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/></svg>,
    neutral: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/></svg>,
  };
  return <span className={`pill pill--${kind}`}>{icons[kind]}{children}</span>;
}

function BarChart({ thisYear, lastYear, labels }) {
  const w = 600, h = 220, pad = 28;
  const max = Math.max(...thisYear, ...lastYear);
  const cw = (w - pad * 2) / thisYear.length;
  const bw = (cw - 6) / 2;
  const bh = (v) => ((v / max) * (h - pad * 2));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",height:"auto"}}>
      <g stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" opacity="0.7">
        {[1,2,3,4].map(i => <line key={i} x1={pad} y1={pad + (h - pad*2)*(i/4)} x2={w-pad} y2={pad + (h - pad*2)*(i/4)} />)}
      </g>
      {thisYear.map((v, i) => {
        const x = pad + i * cw + 3;
        const ly = lastYear[i];
        return (
          <g key={i}>
            <rect x={x} y={h - pad - bh(ly)} width={bw} height={bh(ly)} fill="#B8B5AF"/>
            <rect x={x + bw + 2} y={h - pad - bh(v)} width={bw} height={bh(v)} fill="#1A1A1A"/>
          </g>
        );
      })}
      {labels.map((lb, i) => (
        <text key={i} x={pad + i * cw + cw / 2} y={h - 8} fontSize="10" textAnchor="middle" fill="#8A8A8A" letterSpacing="0.04em">{lb}</text>
      ))}
    </svg>
  );
}

function VertBarChart({ data }) {
  const w = 320, h = 180, pad = 20;
  const max = Math.max(...data);
  const cw = (w - pad * 2) / data.length;
  const bw = cw - 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",height:"auto"}}>
      <g stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" opacity="0.7">
        {[1,2,3].map(i => <line key={i} x1={pad} y1={pad + (h - pad*2)*(i/3)} x2={w-pad} y2={pad + (h - pad*2)*(i/3)} />)}
      </g>
      {data.map((v, i) => {
        const bh = (v / max) * (h - pad*2);
        const muted = i % 3 === 1;
        return <rect key={i} x={pad + i * cw + 2} y={h - pad - bh} width={bw} height={bh} fill={muted ? "#B8B5AF" : "#1A1A1A"} />;
      })}
    </svg>
  );
}

window.Sparkline = Sparkline;
window.MetricTile = MetricTile;
window.StatusPill = StatusPill;
window.BarChart = BarChart;
window.VertBarChart = VertBarChart;
