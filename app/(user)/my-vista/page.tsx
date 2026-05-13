"use client";

// /my-vista — personal work view.
// Body shows the user's assigned items as a .backlog-list — keeps the
// Vector list spec consistent across /backlog and /my-vista. Status and
// priority use the .pill family; empty state uses .placeholder.

import { useEffect, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { SkeletonFade } from "@/app/components/Skeleton";
import { ListRowSkeleton } from "@/app/components/SkeletonCompositions";
import { usePageTitle } from "@/app/hooks/usePageTitle";

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
  const { full } = usePageTitle();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(t);
  }, []);

  const empty = ASSIGNED.length === 0;
  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Your personal view of work items, goals, and activity." />
      <Panel
        name="panel_my_vista_header"
        className="page-panel-heading"
        title="My Vista"
        description="A personalised view of your assigned work, goals, and recent activity."
      />
      <h3 className="eyebrow">Assigned to you</h3>
      <SkeletonFade
        loaded={!loading}
        skeleton={
          <ul className="backlog-list" aria-hidden="true">
            <ListRowSkeleton wave={1} />
            <ListRowSkeleton wave={3} />
            <ListRowSkeleton wave={5} />
          </ul>
        }
      >
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
      </SkeletonFade>
    </PageContent>
  );
}
