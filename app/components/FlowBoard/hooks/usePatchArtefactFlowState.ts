"use client";

// usePatchArtefactFlowState — FB1.3.4
//
// Thin wrapper around `workItems.patch` that fires the flow-state PATCH for a
// single artefact. Exposes the raw async call; optimistic update + revert
// lives in the parent component (p_FlowBoard, FB1.3.7) which owns board state.
//
// Wire path: PATCH /_site/work-items/{id}  body: { flow_states_id: <uuid> }
//
// The patch call re-uses the existing `workItems.patch(id, data)` function
// from `app/lib/apiSite/index.ts` — no new endpoint added. The backend
// validates the transition server-side (artefactitems service + recalc.go)
// and returns 4xx on invalid transitions. The caller is responsible for
// handling 4xx (revert optimistic update + toast).
//
// Error handling pattern: callers should catch the thrown Error and call
// `notify.apiError(err, fallback)` — see app/lib/toast.ts.

import { workItems } from "@/app/lib/apiSite";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Fires PATCH /_site/work-items/{artefactId} with the new flow state ID.
 *
 * Throws on any non-2xx response (the `apiSite` layer wraps HTTP errors in
 * `ApiError`). Callers should catch and handle — typically: revert optimistic
 * update, then call `notify.apiError(err, "Failed to move card.")`.
 *
 * @param artefactId   UUID of the artefact to transition.
 * @param newFlowStateId  UUID of the target flow_states row.
 */
export async function patchArtefactFlowState(
  artefactId: string,
  newFlowStateId: string,
): Promise<void> {
  await workItems.patch(artefactId, { flow_states_id: newFlowStateId });
}
