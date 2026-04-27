"use client";

// /planning — roadmap, capacity, release planning.
// Story 00096 restyle: header + actions come from PageShell. The
// body shows a 3-column swimlane (.planning-board) and a simple
// timeline (.planning-timeline) — both built from Vector tokens.
// Columns use --surface cards on --canvas with a 1px --border;
// timeline bars fill with --ink on a --surface-sunken track (no
// brand colour); status indicators use .pill variants. Empty
// state uses .placeholder.

import PageShell from "@/app/components/PageShell";

const COLUMNS: Array<{ key: string; label: string; cards: PlanCard[] }> = [
  {
    key: "this-quarter",
    label: "This quarter",
    cards: [
      { id: "STR-00094", title: "Backlog rows", status: "In progress", statusClass: "pill--info" },
      { id: "STR-00095", title: "My Vista refresh", status: "Done", statusClass: "pill--success" },
    ],
  },
  {
    key: "next-quarter",
    label: "Next quarter",
    cards: [
      { id: "EPC-00021", title: "Vector rebrand wrap", status: "Planned", statusClass: "pill--neutral" },
    ],
  },
  {
    key: "later",
    label: "Later",
    cards: [
      { id: "EPC-00022", title: "Theme system", status: "Backlog", statusClass: "pill--neutral" },
    ],
  },
];

const TIMELINE: Array<{ name: string; start: number; end: number }> = [
  { name: "Vector rebrand", start: 5, end: 70 },
  { name: "Backlog APIs", start: 30, end: 90 },
  { name: "Theme system", start: 60, end: 95 },
];

interface PlanCard {
  id: string;
  title: string;
  status: string;
  statusClass: string;
}

export default function Planning() {
  return (
    <PageShell
      title="Planning"
      subtitle="Timeline, capacity, and release planning"
      actions={
        <>
          <button type="button" className="btn btn--ghost">Export</button>
          <button type="button" className="btn btn--primary">New initiative</button>
        </>
      }
    >
      <h3 className="eyebrow">Roadmap board</h3>
      <div className="planning-board" role="list">
        {COLUMNS.map((col) => (
          <section key={col.key} className="planning-column" role="listitem">
            <header className="planning-column__head">
              <h4 className="planning-column__title">{col.label}</h4>
              <span className="planning-column__count">{col.cards.length}</span>
            </header>
            <ul className="planning-column__list">
              {col.cards.map((c) => (
                <li key={c.id} className="planning-card">
                  <div className="planning-card__id t-mono">{c.id}</div>
                  <div className="planning-card__title">{c.title}</div>
                  <span className={`pill ${c.statusClass}`}>{c.status}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <h3 className="eyebrow" style={{ marginTop: "var(--space-8)" }}>
        Initiative timeline
      </h3>
      <div className="card chart-card">
        <ul className="planning-timeline" aria-label="Initiative timeline">
          {TIMELINE.map((t) => (
            <li key={t.name} className="planning-timeline__row">
              <span className="planning-timeline__label">{t.name}</span>
              <div className="planning-timeline__track" aria-hidden="true">
                <span
                  className="planning-timeline__bar"
                  style={{ left: `${t.start}%`, width: `${t.end - t.start}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
