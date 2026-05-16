import { apiSite } from "@/app/lib/api";

// PLA-0055 / story 00598 — typed client for /artefact-priorities.
// Parallel to artefactTypesApi: the only consumer today is the
// ArtefactPriorityCatalogueProvider context; gadmin admin UI for
// editing custom priorities is a follow-up surface (not in this plan).

export interface ArtefactPriority {
  id: string;
  workspace_id: string;
  name: string;
  // Project-locked slot: one of pri_critical/pri_high/pri_medium/pri_low
  // for system rows, null for tenant-added custom priorities. The
  // catalogue's useDefaultPriority resolves the slot to find the
  // "Medium" row when present, falling back to first-by-sort-order.
  slot: string | null;
  sort_order: number;
  colour: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtefactPriorityCreate {
  name: string;
  sort_order: number;
  colour?: string | null;
}

export interface ArtefactPriorityPatch {
  name?: string;
  sort_order?: number;
  colour?: string | null;
}

async function list(): Promise<ArtefactPriority[]> {
  const data = await apiSite<{ priorities: ArtefactPriority[] }>("/artefact-priorities");
  return data.priorities;
}

async function create(body: ArtefactPriorityCreate): Promise<ArtefactPriority> {
  return apiSite<ArtefactPriority>("/artefact-priorities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patch(id: string, body: ArtefactPriorityPatch): Promise<ArtefactPriority> {
  return apiSite<ArtefactPriority>(`/artefact-priorities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function archive(id: string): Promise<void> {
  await apiSite<void>(`/artefact-priorities/${id}`, { method: "DELETE" });
}

export const artefactPrioritiesApi = { list, create, patch, archive };
