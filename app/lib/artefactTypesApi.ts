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

export const artefactTypesApi = { list, patch };
