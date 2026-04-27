"use client";

// /my-vista — personal work view.
// Story 00095 restyle: header (28px / --ink + --ink-muted subtitle)
// comes from PageShell + .page__head. The body shows the user's
// assigned items as a .backlog-list — keeps the Vector list spec
// consistent across /backlog and /my-vista. Status and priority use
// the .pill family (no legacy .tag classes); empty state uses the
// Vector .placeholder kit (story 00079) on --canvas. No flat grey
// fills, no decorative colour.

import PageShell from "@/app/components/PageShell";

const ASSIGNED: Array<{
  id: string;
  type: "story" | "epic" | "task";
  title: string;
  status: string;
  statusClass: string;
  priority: string;
  priorityClass: string;
}> = [
  {
    id: "STR-00094",
    type: "story",
    title: "Backlog work item rows + status pills",
    status: "In progress",
    statusClass: "pill--info",
    priority: "P1",
    priorityClass: "pill--neutral",
  },
  {
    id: "TSK-00310",
    type: "task",
    title: "Verify .t-mono renders in JetBrains Mono",
    status: "Blocked",
    statusClass: "pill--danger",
    priority: "P2",
    priorityClass: "pill--neutral",
  },
];

const ICONS: Record<"story" | "epic" | "task", React.ReactNode> = {
  story: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="13" x2="13" y2="13" />
    </svg>
  ),
  epic: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7l8-4 8 4-8 4-8-4z" />
      <path d="M4 12l8 4 8-4" />
      <path d="M4 17l8 4 8-4" />
    </svg>
  ),
  task: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
};

export default function MyVista() {
  const empty = ASSIGNED.length === 0;
  return (
    <PageShell title="My Vista" subtitle="Your personalised view">
      <h3 className="eyebrow">Assigned to you</h3>
      {empty ? (
        <div className="placeholder">
          <h3 className="placeholder__title">Nothing assigned</h3>
          <p className="placeholder__body">
            Items assigned to you will appear here. Check the backlog to pick
            something up.
          </p>
        </div>
      ) : (
        <ul className="backlog-list" aria-label="Assigned work items">
          {ASSIGNED.map((row) => (
            <li key={row.id} className="backlog-row">
              <span className="backlog-row__type" aria-hidden="true">
                {ICONS[row.type]}
              </span>
              <span className="backlog-row__id">{row.id}</span>
              <span className="backlog-row__title">{row.title}</span>
              <span className={`backlog-row__status pill ${row.statusClass}`}>{row.status}</span>
              <span className={`backlog-row__priority pill ${row.priorityClass}`}>{row.priority}</span>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
