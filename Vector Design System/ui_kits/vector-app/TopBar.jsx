// TopBar.jsx — breadcrumb + search + notifications + avatar
function TopBar({ crumb }) {
  return (
    <header className="tb">
      <div className="tb__bc">
        <span>{crumb[0]}</span>
        <span className="tb__sep">›</span>
        <strong>{crumb[1]}</strong>
      </div>
      <div className="tb__spacer"></div>
      <div className="tb__search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <input placeholder="Search…"/>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ink-faint)",border:"1px solid var(--border)",borderRadius:4,padding:"1px 5px"}}>K</span>
      </div>
      <button className="tb__icon-btn" aria-label="Notifications">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
      </button>
      <button className="tb__icon-btn" aria-label="Help">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17h.01"/></svg>
      </button>
      <div className="tb__avatar" aria-label="Account"></div>
    </header>
  );
}
window.TopBar = TopBar;
