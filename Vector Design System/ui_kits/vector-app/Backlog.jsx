// Backlog.jsx — secondary view
function Backlog() {
  const items = [
    { id: "VEC-1042", title: "Tenant brand contrast validator should fall back to ink", kind: "Story",   status: ["info","In review"],   pts: 5 },
    { id: "VEC-1041", title: "Sidebar peek-on-hover when collapsed",                    kind: "Story",   status: ["success","Done"],     pts: 3 },
    { id: "VEC-1040", title: "Charts: dashed gridlines at 50% opacity",                  kind: "Story",   status: ["warning","Pending"],  pts: 2 },
    { id: "VEC-1039", title: "Status pill spec — icon + label parity",                   kind: "Spike",   status: ["success","Done"],     pts: 1 },
    { id: "VEC-1038", title: "Backlog table — checkbox column, hover row tint",          kind: "Story",   status: ["info","In review"],   pts: 3 },
    { id: "VEC-1037", title: "Removing emoji from system emails",                         kind: "Chore",   status: ["warning","Pending"],  pts: 1 },
    { id: "VEC-1036", title: "Dark theme — verify ink-faint contrast",                   kind: "Bug",     status: ["danger","Failed"],    pts: 2 },
  ];
  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1 className="page__title">Backlog</h1>
          <p className="page__sub">User stories, epics, and portfolio items</p>
        </div>
        <div className="page__actions">
          <button className="btn btn--secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
            Filter
          </button>
          <button className="btn btn--primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New story
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{width:40}}><input type="checkbox" /></th>
              <th>ID</th><th>Title</th><th>Type</th><th>Status</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id}>
                <td><input type="checkbox" /></td>
                <td className="id">{r.id}</td>
                <td>{r.title}</td>
                <td style={{color:"var(--ink-muted)"}}>{r.kind}</td>
                <td><StatusPill kind={r.status[0]}>{r.status[1]}</StatusPill></td>
                <td className="num">{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
window.Backlog = Backlog;
