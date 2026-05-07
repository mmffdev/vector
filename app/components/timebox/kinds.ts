// PLA-0027 / Story 00518 — Timebox kind registry.
// One entry per kind; adding a new kind = add a row here + write the migration
// + write the Go service. TimeboxManager.tsx is not edited per kind.

export const TIMEBOX_KINDS = {
  sprint: {
    table: "timebox_sprints",
    apiBase: "/api/v2/timeboxes/sprints",
    namePrefix: "Sprint",
    bindsToTeam: true,
    enforcesNonOverlap: true,
    tracksCreep: true,
  },
  // release: { … } — lands when timebox_releases ships
} as const;

export type TimeboxKind = keyof typeof TIMEBOX_KINDS;
