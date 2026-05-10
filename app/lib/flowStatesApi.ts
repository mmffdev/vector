import { apiSite } from "@/app/lib/api";

export interface FlowState {
  id: string;
  name: string;
  kind: "todo" | "in_progress" | "done" | "accepted" | "cancelled";
  sort_order: number;
  is_initial: boolean;
  colour?: string | null;
}

export interface FlowGroup {
  flow_id: string;
  flow_name: string;
  is_default: boolean;
  type_id: string;
  type_name: string;
  type_scope: "work" | "strategy";
  states: FlowState[];
}

export interface FlowsResponse {
  work: FlowGroup[];
  strategy: FlowGroup[];
}

// Module-level cache so layout + page both resolve from the same in-flight request.
let _cache: FlowsResponse | null = null;
let _promise: Promise<FlowsResponse> | null = null;

async function list(): Promise<FlowsResponse> {
  if (_cache) return _cache;
  if (!_promise) {
    _promise = apiSite<FlowsResponse>("/flows/").then((r) => {
      _cache = r;
      return r;
    });
  }
  return _promise;
}

function invalidate() {
  _cache = null;
  _promise = null;
}

async function patchState(stateId: string, colour: string | null): Promise<FlowState> {
  const result = await apiSite<FlowState>(`/flow-states/${stateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colour }),
  });
  invalidate();
  return result;
}

export const flowStatesApi = { list, patchState };
