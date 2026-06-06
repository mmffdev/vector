/**
 * sprintMetrics — typed client for the sprint metrics engine.
 * Backend: backend/internal/sprintmetrics/handler.go → GET
 *   /_site/timeboxes/sprints/{id}/metrics (Sentinel-clamped server-side).
 * Wire shapes mirror sprintmetrics.Model (types.go). This is the ONE
 * source every sprint chart reads — charts are dumb.
 */
import { apiSite } from "@/app/lib/api";
import type { ID } from "@/app/lib/apiSite";

export interface SprintWindow { start: string; end: string; today: number; sprint_days: number; }
export interface SprintScopeChange { day: number; delta: number; }
export interface SprintCone { optimistic: number[]; pessimistic: number[]; }
// Researched completion forecast (parity with TaskForecast). landing days may
// exceed sprint_days; -1 = never lands.
export interface SprintForecast {
  optimistic_velocity: number;
  average_velocity: number;
  pessimistic_velocity: number;
  opt_landing_day: number;
  avg_landing_day: number;
  pess_landing_day: number;
  pess_landing_date: string;
  projected_past_end: boolean;
}
export interface SprintKPIs {
  committed: number; remaining: number; velocity: number;
  days_left: number; on_track: boolean; projected_short: number;
}
export interface SprintMetricsModel {
  window: SprintWindow;
  scope: number[];
  remaining: number[];        // values < 0 = "no actual" sentinel
  earned: number[];
  ideal_a: number[];
  ideal_b: number[];
  ideal_original: number[];
  cone: SprintCone;
  velocity: number;
  forecast: SprintForecast;
  scope_changes: SprintScopeChange[];
  kpis: SprintKPIs;
}

// TeamVelocity — the cross-sprint metric (mean net-accepted points per
// COMPLETED sprint over a rolling window), distinct from the burndown's
// intra-sprint "recent rate" (SprintKPIs.velocity, pts/day, 3-day rolling).
// Backend: sprintmetrics.VelocityResult → GET /_site/timeboxes/velocity.
// Standalone endpoint so any consumer reads team velocity the same way.
export interface TeamVelocity {
  points_per_sprint: number;
  window_size: number;        // n actually averaged (≤ eligible)
  eligible_sprints: number;   // past-dated sprints available
  sampled_sprint_ids: string[];
  low_confidence: boolean;    // < 3 sprints fed the average
  has_data: boolean;          // false → show "—", not "0"
}

export const sprintMetrics = {
  get: (sprintId: ID): Promise<SprintMetricsModel> =>
    apiSite<SprintMetricsModel>(`/timeboxes/sprints/${sprintId}/metrics`),

  // Workspace-level; Sentinel resolves the clamp server-side (no args).
  teamVelocity: (): Promise<TeamVelocity> =>
    apiSite<TeamVelocity>(`/timeboxes/velocity`),
};
