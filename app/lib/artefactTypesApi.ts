import { apiSite } from "@/app/lib/api";

export interface ArtefactType {
  id: string;
  scope: "work" | "strategy";
  source: "system" | "tenant";
  name: string;
  prefix: string;
  description: string | null;
  colour: string | null;
  // PLA-0054 / story 00584. Project-locked handle (wrk_epic, wrk_story,
  // wrk_defect, wrk_task, wrk_risk) for canonical work types; null on
  // custom tenant types. The frontend resolves slot → id via the
  // workspace catalogue so chip filters survive gadmin renames.
  slot: string | null;
  parent_type_id: string | null;
  allows_children: boolean;
  layer_depth: number | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtefactTypePatch {
  name?: string;
  prefix?: string;
  description?: string | null;
  colour?: string | null;
  // Empty string clears to NULL on the wire; a UUID string sets.
  // Drives useParentCandidates' dynamic parent-prefix resolution so
  // tenant-renamed types (e.g. "Feature" → "Capability") flow through
  // without code change.
  parent_type_id?: string | null;
  // Empty string clears to NULL; integer-as-string sets. 0 means
  // top-of-ladder (no parent allowed by the UI).
  layer_depth?: string | null;
}

export interface Violation {
  field: string;
  message: string;
}

async function list(): Promise<ArtefactType[]> {
  const data = await apiSite<{ types: ArtefactType[] }>("/artefact-types");
  return data.types;
}

async function patch(id: string, body: ArtefactTypePatch): Promise<ArtefactType> {
  return apiSite<ArtefactType>(`/artefact-types/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Re-runs the strategy + work-type adoption writers against the
// already-adopted bundle so schema changes (layer_depth recompute,
// parent_type_id chain) reach existing rows without a destructive
// re-adoption. Returns the workspace + model the resync targeted.
async function resync(): Promise<{ workspace_id: string; model_id: string }> {
  return apiSite("/artefact-types/resync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export const artefactTypesApi = { list, patch, resync };
