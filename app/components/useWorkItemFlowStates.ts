"use client";

import { useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";

export interface WorkItemFlowState {
  id: string;
  flow_position: number;
  name: string;
  canonical_code: string;
  // Tenant-set hex (#RRGGBB) on the state. NULL when the tenant hasn't
  // overridden the system default — FlowStatePillRow falls back to the
  // canonical_code class in that case.
  colour?: string | null;
  // Present when the response came from the by-type fetch
  // (?artefact_type_id=...). useFlowStatesByType groups by this.
  artefact_type_id?: string;
}

// Maps canonical_code → pill modifier class suffix (pill--<mod>).
export const CANONICAL_PILL: Record<string, string> = {
  backlog:   "neutral",
  ready:     "info",
  doing:     "info",
  completed: "success",
  accepted:  "success",
};

// useWorkItemFlowStates fetches the ordered flow states from
// GET /samantha/v2/work-items/flow-states. Returns an empty array
// while loading; callers fall back to the current item's flow_state_name.
export function useWorkItemFlowStates(): WorkItemFlowState[] {
  const [states, setStates] = useState<WorkItemFlowState[]>([]);

  useEffect(() => {
    apiSite<{ states: WorkItemFlowState[] }>("/work-items/flow-states")
      .then((r) => setStates(r.states))
      .catch(() => {});
  }, []);

  return states;
}
