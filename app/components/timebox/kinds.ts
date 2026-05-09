// PLA-0027 / Story 00518 — Timebox kind registry.
// One entry per kind; adding a new kind = add a row here + write the migration
// + write the Go service. TimeboxManager.tsx is not edited per kind.

export const TIMEBOX_KINDS = {
  sprint: {
    table: "timebox_sprints",
    apiBase: "/timeboxes/sprints",
    namePrefix: "Sprint",
    listKey: "sprints",
    rowPrefix: "sprint",
    bindsToTeam: true,
    enforcesNonOverlap: true,
    tracksCreep: true,
  },
  release: {
    table: "timebox_releases",
    apiBase: "/timeboxes/releases",
    namePrefix: "Release",
    listKey: "releases",
    rowPrefix: "release",
    bindsToTeam: false,
    enforcesNonOverlap: true,
    tracksCreep: true,
  },
} as const;

export type TimeboxKind = keyof typeof TIMEBOX_KINDS;
