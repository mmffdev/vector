/**
 * taskMetrics — typed client for the TASK-count burndown engine.
 * Backend: backend/internal/taskmetrics/handler.go → GET
 *   /_site/timeboxes/sprints/{id}/task-metrics (Sentinel-clamped server-side).
 * Wire shapes mirror taskmetrics.Model (types.go). Count metric, not points.
 *
 * The engineering-team view: a task burns when its owner marks it "done"
 * (not the PO's "accepted", which drives the story-points burndown).
 */
import { apiSite } from "@/app/lib/api";
import type { ID } from "@/app/lib/apiSite";

export interface TaskWindow { start: string; end: string; today: number; sprint_days: number; }
export interface TaskScopeChange { day: number; delta: number; }
export interface TaskCone { optimistic: number[]; pessimistic: number[]; }
export interface TaskKPIs {
  total: number; completed: number; remaining: number;
  days_left: number; on_track: boolean; projected_short: number;
}
export interface TaskMetricsModel {
  window: TaskWindow;
  scope: number[];
  remaining: number[];        // values < 0 = "no actual" sentinel
  earned: number[];
  ideal_a: number[];
  ideal_b: number[];
  ideal_original: number[];
  cone: TaskCone;
  rate: number;
  scope_changes: TaskScopeChange[];
  kpis: TaskKPIs;
}

export const taskMetrics = {
  get: (sprintId: ID): Promise<TaskMetricsModel> =>
    apiSite<TaskMetricsModel>(`/timeboxes/sprints/${sprintId}/task-metrics`),
};
