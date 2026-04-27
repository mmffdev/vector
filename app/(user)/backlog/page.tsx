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

      <div className="placeholder">
        <h3 className="placeholder__title">Backlog rows land in 00094</h3>
        <p className="placeholder__body">
          Artefact tables and hierarchy view ship in the next story; this page
          currently demonstrates the filter bar layout only.
        </p>
      </div>
    </PageShell>
  );
}
