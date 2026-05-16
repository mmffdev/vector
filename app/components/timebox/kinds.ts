// PLA-0027 / Story 00518 — Timebox kind registry.
// One entry per kind; adding a new kind = add a row here + write the migration
// + write the Go service. TimeboxManager.tsx is not edited per kind.

export const TIMEBOX_KINDS = {
  sprint: {
    table: "timeboxes_sprints",
    apiBase: "/timeboxes/sprints",
    namePrefix: "Sprint",
    listKey: "sprints",
    // rowPrefix is the wire-field stem the frontend uses to build payload
    // keys (e.g. `${rowPrefix}_name`). After RF1.4.2.timeboxes the column
    // names carry the full table prefix, so the frontend prefix matches.
    rowPrefix: "timeboxes_sprints",
    bindsToTeam: true,
    enforcesNonOverlap: true,
    tracksCreep: true,
  },
  release: {
    table: "timeboxes_releases",
    apiBase: "/timeboxes/releases",
    namePrefix: "Release",
    listKey: "releases",
    rowPrefix: "timeboxes_releases",
    bindsToTeam: false,
    enforcesNonOverlap: true,
    tracksCreep: true,
  },
} as const;

export type TimeboxKind = keyof typeof TIMEBOX_KINDS;
