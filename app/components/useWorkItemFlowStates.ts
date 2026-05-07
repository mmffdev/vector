"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/lib/api";

export interface WorkItemFlowState {
  id: string;
  flow_position: number;
  name: string;
  canonical_code: string;
}

// Maps canonical_code → pill modifier class suffix (pill--<mod>).
export const CANONICAL_PILL: Record<string, string> = {
  backlog:   "neutral",
  ready:     "info",
  doing:     "info",
  completed: "success",
  accepted:  "success",
};

// useWorkItemFlowStates fetches the ordered flow states for the
// execution_work_items flow from GET /api/work-items/flow-states.
// Returns an empty array while loading; callers should fall back
// to whatever the current item's flow_state_name already shows.
export function useWorkItemFlowStates(): WorkItemFlowState[] {
  const [states, setStates] = useState<WorkItemFlowState[]>([]);

  useEffect(() => {
    api<{ states: WorkItemFlowState[] }>("/api/v2/work-items/flow-states")
      .then((r) => setStates(r.states))
      .catch(() => {});
  }, []);

  return states;
}
