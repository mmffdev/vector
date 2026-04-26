// Hold the overlay on the 'connected' state before animating progress boxes — gives the user a moment of confidence the connection succeeded.
export const ADOPTION_CONFIDENCE_PAUSE_MS: number = 5000;

// Canonical adoption step order — must match backend SSE `event: step` `name`
// values emitted by GET /api/portfolio-models/{id}/adopt/stream. Shared across
// the overlay (00017), smart router (00015), and any other adoption surface.
export const ADOPTION_STEPS = [
  "validate",
  "layers",
  "workflows",
  "transitions",
  "artifacts",
  "terminology",
  "finalize",
] as const;

export type AdoptionStepName = (typeof ADOPTION_STEPS)[number];

// Human-friendly labels rendered inside each progress box.
export const ADOPTION_STEP_LABELS: Record<AdoptionStepName, string> = {
  validate: "Validate",
  layers: "Layers",
  workflows: "Workflows",
  transitions: "Transitions",
  artifacts: "Artifacts",
  terminology: "Terminology",
  finalize: "Finalize",
};

// Endpoints used by the wizard model-card list (00019). Centralised here
// so the smart router (00015) and overlay (00017) can reuse identical
// paths if needed — additive; existing exports above are unchanged.
export const PORTFOLIO_MODELS_LIST_PATH = "/api/portfolio-models";
export function adoptModelPath(modelId: string): string {
  return `/api/portfolio-models/${modelId}/adopt`;
}
export function adoptStreamPath(modelId: string): string {
  return `/api/portfolio-models/${modelId}/adopt/stream`;
}

// Retry policy for the adoption overlay (card 00018). Auto-retry up to
// ADOPTION_MAX_RETRIES on `event: fail`; the saga is idempotent on
// (subscription_id, source_library_id) so re-POSTing /adopt resumes from
// the failed step. Backoff schedule (ms) doubles each attempt; if more
// retries are configured than entries, the last value is reused.
export const ADOPTION_MAX_RETRIES: number = 5;
export const ADOPTION_RETRY_BACKOFF_MS: readonly number[] = [
  2000, 4000, 8000, 16000, 32000,
] as const;
