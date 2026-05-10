// Typed helpers for the flow states feature, backed by the apiSite registry.
// Re-exports the registry types so callers import from one place.
export type {
  FlowState,
  FlowTransition,
  FlowGroup,
  FlowsResponse,
} from "@/app/lib/apiSite/index";

import { flows as flowsApi, flowStates as flowStatesApi_ } from "@/app/lib/apiSite/index";
import type { FlowState, FlowsResponse } from "@/app/lib/apiSite/index";

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

async function patchState(stateId: string, colour: string | null): Promise<FlowState> {
  const result = await flowStatesApi_.patch(stateId, colour);
  invalidate();
  return result;
}

export const flowStatesApi = { list, patchState };
