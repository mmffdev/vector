// Dashboard.jsx — full dashboard view
function Dashboard() {
  const tx = [
    { id: "#04910", customer: "Ryan Korsgaard",  product: "Ergo Office Chair",  status: ["success","Success"], qty: 12, price: 3450, total: 41400 },
    { id: "#04911", customer: "Madelyn Lubin",    product: "Sunset Desk 02",     status: ["success","Success"], qty: 20, price: 2980, total: 89200 },
    { id: "#04912", customer: "Abram Bergson",    product: "Eco Bookshelf",      status: ["warning","Pending"], qty: 22, price: 1750, total: 75900 },
    { id: "#04913", customer: "Phillip Mango",    product: "Green Leaf Desk",    status: ["neutral","Refunded"], qty: 24, price: 1950, total: 19500 },
    { id: "#04914", customer: "Kierra Press",     product: "Minimal Lamp",       status: ["success","Success"], qty: 8,  price: 850,  total: 6800 },
  ];
  const fmt = (n) => "$" + n.toLocaleString();

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Welcome back, Salung</h1>
          <p className="page__sub">Your workspace overview · 6 Nov 2026</p>
        </div>
        <div className="page__actions">
          <div className="seg">
            <button>Daily</button>
            <button className="on">Monthly</button>
            <button>Yearly</button>
          </div>
          <button className="btn btn--secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            6 Nov 2026
          </button>
          <button className="btn btn--primary">Export CSV</button>
        </div>
      </div>

      <div className="tile-grid">
        <MetricTile eyebrow="Total revenue" value="$20,320" unit="" delta="+0.94" spark={[3,4,3,5,4,6,5,7,6,8,7,9]} />
        <MetricTile eyebrow="Total orders"  value="10,320"  unit="Orders"   delta="+0.94" spark={[5,4,6,5,7,6,8,5,7,6,8,7]} />
        <MetricTile eyebrow="New customers" value="4,305"   unit="New users" delta="+0.94" spark={[2,3,2,4,3,5,4,6,5,4,6,5]} />
        <MetricTile eyebrow="Conversion rate" value="3.9%"  unit=""         delta="+0.94" spark={[3,3,4,3,5,4,6,5,4,5,6,5]} />
      </div>

      <div className="chart-grid">
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <span className="eyebrow">Sales trend</span>
            <div style={{display:"flex",alignItems:"center",gap:18,fontSize:12,color:"var(--ink-muted)"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,background:"#1A1A1A",borderRadius:2}}></span>This year</span>
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,background:"#B8B5AF",borderRadius:2}}></span>Last year</span>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
            <span style={{fontSize:13,color:"var(--ink-muted)"}}>Total revenue</span>
            <span style={{fontSize:20,fontWeight:600,fontVariantNumeric:"tabular-nums"}}>$20,320</span>
          </div>
          <BarChart
            thisYear={[42, 58, 50, 78, 70, 100, 88, 60, 55, 72, 64, 50]}
            lastYear={[30, 48, 38, 60, 52, 80, 70, 50, 42, 58, 50, 38]}
            labels={["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]}
          />
        </div>
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <span className="eyebrow">Revenue breakdown</span>
            <span style={{fontSize:12,color:"var(--ink-muted)"}}>Jan 1 – Aug 30</span>
          </div>
          <div style={{fontSize:13,color:"var(--ink-muted)",marginBottom:4}}>Revenue by category</div>
          <div style={{fontSize:24,fontWeight:600,fontVariantNumeric:"tabular-nums",marginBottom:12}}>$20,320</div>
          <VertBarChart data={[60, 70, 45, 90, 50, 75, 40, 80, 55, 65]} />
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div className="table-head__title">
            <span className="eyebrow" style={{fontSize:12}}>Recent transactions</span>
          </div>
          <div className="table-head__spacer"></div>
          <div className="tb__search" style={{width:220,height:32}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
            <input placeholder="Search transactions…"/>
          </div>
          <button className="btn btn--primary btn--sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add transaction
          </button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width:40}}><input type="checkbox" /></th>
              <th>ID</th><th>Customer</th><th>Product</th><th>Status</th>
              <th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {tx.map(r => (
              <tr key={r.id}>
                <td><input type="checkbox" /></td>
                <td className="id">{r.id}</td>
                <td>{r.customer}</td>
                <td>{r.product}</td>
                <td><StatusPill kind={r.status[0]}>{r.status[1]}</StatusPill></td>
                <td className="num">{r.qty}</td>
                <td className="num">{fmt(r.price)}</td>
                <td className="num">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
window.Dashboard = Dashboard;
