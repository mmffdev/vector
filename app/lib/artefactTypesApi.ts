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
  // PLA add-artefact-type. Work-scope allowed-parent rule: list of parent
  // type SLOTS (wrk_story, wrk_epic, ...) this work type may nest under.
  // Entries are usually slots, but the migration backfill may store a PREFIX
  // fallback for a parent type whose slot is NULL (e.g. "FE" for Feature) —
  // the resolver matches slot-first-then-prefix. Null for strategy types.
  // Replaces the retired PARENT_PREFIX_MAP.
  execution_parent_slots: string[] | null;
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

// Create a tenant WORK type as a sibling at the execution level. Its
// allowed-parent rule (execution_parent_slots) is copied from the
// behaves-like rung server-side. Strategy types are created only via
// insertLayer.
async function create(body: {
  scope: "work";
  tag: string;
  name: string;
  description?: string | null;
  colour?: string | null;
  behaves_like_type_id: string;
}): Promise<ArtefactType> {
  return apiSite<ArtefactType>("/artefact-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface InsertLayerBody {
  tag: string;
  name: string;
  description?: string | null;
  colour?: string | null;
  child_type_id: string;
}

export interface InsertLayerPreview {
  parent_layer: { id: string; name: string };
  child_layer: { id: string; name: string };
  impacted: { id: string; name: string; current_parent_name: string | null }[];
  passthrough_count: number;
  rejection?: string | null;
}

// Dry-run the insert-layer operation: returns the gap (parent/child layers),
// the impacted child instances, and a non-null `rejection` when the insertion
// is structurally blocked (e.g. top-layer / depth cap). The commit path
// re-validates everything; this is purely so the flyout can explain the impact.
async function previewInsertLayer(body: InsertLayerBody): Promise<InsertLayerPreview> {
  return apiSite<InsertLayerPreview>("/artefact-types/insert-layer/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Commit the insert-layer operation: creates the new strategy type between the
// chosen child and its current parent, re-stitches the type chain, and
// backfills one pass-through artefact per live child instance.
async function insertLayer(
  body: InsertLayerBody,
): Promise<{ new_type: ArtefactType; created_count: number }> {
  return apiSite("/artefact-types/insert-layer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const artefactTypesApi = {
  list,
  patch,
  resync,
  create,
  previewInsertLayer,
  insertLayer,
};
