// Typed helpers for the flow states feature, backed by the apiSite registry.
// Re-exports the registry types so callers import from one place.
export type {
  FlowState,
  FlowTransition,
  FlowGroup,
  FlowsResponse,
  ResetPreview,
  ResetApplyResult,
  ResetPillDelta,
  ResetTransitionDelta,
  ResetArtefactImpact,
} from "@/app/lib/apiSite/index";

import { flows as flowsApi, flowStates as flowStatesApi_ } from "@/app/lib/apiSite/index";
import type {
  FlowState,
  FlowTransition,
  FlowsResponse,
  ResetPreview,
  ResetApplyResult,
} from "@/app/lib/apiSite/index";

// Module-level cache so layout + page both resolve from the same in-flight request.
let _cache: FlowsResponse | null = null;
let _promise: Promise<FlowsResponse> | null = null;

function invalidate() {
  _cache = null;
  _promise = null;
}

async function list(): Promise<FlowsResponse> {
  if (_cache) return _cache;
  if (!_promise) {
    _promise = flowsApi.list().then((r) => {
      _cache = r;
      return r;
    });
  }
  return _promise;
}

async function patchState(
  stateId: string,
  patch: { colour?: string | null; name?: string; kind?: string; sort_order?: number; is_initial?: boolean; is_pullable?: boolean },
): Promise<FlowState> {
  const result = await flowStatesApi_.patch(stateId, patch);
  invalidate();
  return result;
}

async function deleteState(stateId: string): Promise<void> {
  await flowStatesApi_.delete(stateId);
  invalidate();
}

async function createState(
  flowId: string,
  data: { name: string; kind: string; sort_order?: number; is_initial?: boolean; is_pullable?: boolean },
): Promise<FlowState> {
  const result = await flowsApi.createState(flowId, data);
  invalidate();
  return result;
}

async function createTransition(flowId: string, from: string, to: string): Promise<FlowTransition> {
  const result = await flowsApi.createTransition(flowId, from, to);
  invalidate();
  return result;
}

async function deleteTransition(flowId: string, from: string, to: string): Promise<void> {
  await flowsApi.deleteTransition(flowId, from, to);
  invalidate();
}

async function resetPreview(artefactTypeId: string): Promise<ResetPreview> {
  return flowsApi.resetPreview(artefactTypeId);
}

async function resetApply(artefactTypeId: string): Promise<ResetApplyResult> {
  const result = await flowsApi.resetApply(artefactTypeId);
  invalidate();
  return result;
}

export const flowStatesApi = {
  list,
  patchState,
  deleteState,
  createState,
  createTransition,
  deleteTransition,
  resetPreview,
  resetApply,
};
