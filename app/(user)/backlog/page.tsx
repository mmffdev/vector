"use client";

// /backlog — list of user stories, epics, and portfolio items.
// Story 00093 restyle: page header (28px title + ink-muted subtitle
// + flex-end actions) comes from PageShell + .page__head. The filter
// bar is .backlog-filter on --canvas (no card / no shadow) — search
// input sits on --surface with 1px --border / --radius-md at the
// 36px height called out by the AC; filter toggles use .pill /
// .pill--neutral; column controls are .btn--ghost. The work-item
// rows below are a placeholder until 00094 lands.

import { useState } from "react";
import PageShell from "@/app/components/PageShell";

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "mine", label: "Assigned to me" },
  { key: "open", label: "Open" },
  { key: "blocked", label: "Blocked" },
  { key: "due", label: "Due this week" },
];

export default function Backlog() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<string>("all");

  return (
    <PageShell
      title="Backlog"
      subtitle="User stories, epics, and portfolio items"
      actions={
        <>
          <button type="button" className="btn btn--ghost">Export</button>
          <button type="button" className="btn btn--primary">New item</button>
        </>
      }
    >
      <div className="backlog-filter" role="search">
        <input
          type="search"
          className="backlog-filter__search"
          placeholder="Search by title, tag, or owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search backlog"
        />
        <ul className="backlog-filter__pills" aria-label="Quick filters">
          {FILTERS.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                className={
                  "pill " +
                  (active === f.key ? "pill--info" : "pill--neutral")
                }
                aria-pressed={active === f.key}
                onClick={() => setActive(f.key)}
              >
                {f.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="backlog-filter__controls">
          <button type="button" className="btn btn--ghost">Columns</button>
          <button type="button" className="btn btn--ghost">Sort</button>
        </div>
      </div>

      <ul className="backlog-list" aria-label="Backlog items">
        {SAMPLE_ROWS.map((row) => (
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
    </PageShell>
  );
}

// Sample data — replaced by real /api/backlog wiring in a later card.
// Kept inline so the page renders the Vector row spec without backend
// dependencies for the design audit.
const ICONS: Record<"story" | "epic" | "task", React.ReactNode> = {
  // Lucide-style stroked SVGs at 16px — currentColor, no fill.
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

const SAMPLE_ROWS: Array<{
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
    id: "EPC-00021",
    type: "epic",
    title: "Vector Design System rebrand",
    status: "On track",
    statusClass: "pill--success",
    priority: "P0",
    priorityClass: "pill--warning",
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
  {
    id: "STR-00088",
    type: "story",
    title: "Portfolio overview list refresh",
    status: "Done",
    statusClass: "pill--success",
    priority: "P3",
    priorityClass: "pill--neutral",
  },
];
