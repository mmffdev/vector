// Sidebar.jsx — Vector left navigation, mirrors live Portfolio Model layout
const { useState } = React;

function Icon({ name }) {
  const props = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.75", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "dashboard":  return <svg {...props}><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>;
    case "backlog":    return <svg {...props}><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
    case "portfolio":  return <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>;
    case "planning":   return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
    case "risk":       return <svg {...props}><path d="M10.3 3.86l-8.5 14.7A2 2 0 0 0 3.5 22h17a2 2 0 0 0 1.7-3.4L13.7 3.85a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>;
    case "users":      return <svg {...props}><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0"/><circle cx="17" cy="9" r="3"/><path d="M22 18a5 5 0 00-7-4.5"/></svg>;
    case "settings":   return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    case "billing":    return <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>;
    case "bookmark":   return <svg {...props}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>;
    case "resources":  return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>;
    case "doc":        return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case "vista":      return <svg {...props}><path d="M3 12c2-3 5-5 9-5s7 2 9 5c-2 3-5 5-9 5s-7-2-9-5z"/><circle cx="12" cy="12" r="2"/></svg>;
    case "model":      return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "library":    return <svg {...props}><path d="M4 19a2 2 0 012-2h14V5a2 2 0 00-2-2H6a2 2 0 00-2 2zM4 19a2 2 0 002 2h14"/></svg>;
    case "docsetup":   return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8L7 17M17 7l2.8-2.8"/></svg>;
    default: return null;
  }
}

function Sidebar({ active, onNavigate }) {
  const groups = [
    { label: "Bookmarks", items: [
      { key: "product", icon: "bookmark", label: "Product" },
    ]},
    { label: "Personal", items: [
      { key: "resources",  icon: "resources", label: "Resources" },
      { key: "dashboard",  icon: "dashboard", label: "Dashboard" },
      { key: "blog-pageA", icon: "doc",       label: "Blog Page · 1/PHTM-101" },
      { key: "vista",      icon: "vista",     label: "My Vista" },
    ]},
    { label: "Admin Settings", items: [
      { key: "portfolio-settings", icon: "settings", label: "Portfolio Settings" },
      { key: "portfolio-model",    icon: "model",    label: "Portfolio Model" },
    ]},
    { label: "Planning", items: [
      { key: "backlog",   icon: "backlog",   label: "Backlog" },
      { key: "planning",  icon: "planning",  label: "Planning" },
      { key: "portfolio", icon: "portfolio", label: "Portfolio" },
    ]},
    { label: "Strategic", items: [
      { key: "risk", icon: "risk", label: "Risk" },
    ]},
  ];

  return (
    <nav className="sb">
      <div className="sb__tenant" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 16px 10px",margin:"0 12px 6px",borderBottom:"1px solid var(--border)"}}>
        <button className="sb__item" style={{width:"auto",padding:"4px 6px",height:28}} aria-label="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button className="sb__item" style={{width:"auto",padding:"4px 6px",height:28}} aria-label="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4z"/></svg>
        </button>
      </div>
      {groups.map((g, gi) => (
        <React.Fragment key={gi}>
          <div className="sb__section">{g.label}</div>
          {g.items.map(it => (
            <button key={it.key} className={`sb__item ${active === it.key ? "active" : ""}`} onClick={() => onNavigate(it.key)}>
              <Icon name={it.icon}/>
              <span>{it.label}</span>
            </button>
          ))}
        </React.Fragment>
      ))}
      <div className="sb__user" style={{flexDirection:"column",alignItems:"flex-start",gap:6,padding:"16px 24px 0"}}>
        <button className="sb__item" style={{padding:0,height:28,color:"var(--ink-muted)"}}>
          <Icon name="docsetup"/><span>Doc Setup</span>
        </button>
        <button className="sb__item" style={{padding:0,height:28,color:"var(--ink-muted)"}}>
          <Icon name="library"/><span>Library</span>
        </button>
      </div>
    </nav>
  );
}

window.Sidebar = Sidebar;
window.SBIcon = Icon;
