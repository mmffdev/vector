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
  scope_changes: SprintScopeChange[];
  kpis: SprintKPIs;
}

export const sprintMetrics = {
  get: (sprintId: ID): Promise<SprintMetricsModel> =>
    apiSite<SprintMetricsModel>(`/timeboxes/sprints/${sprintId}/metrics`),
};
