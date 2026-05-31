// Typed client for the Form Layout Builder (2026-05-30 — see
// docs/superpowers/specs/2026-05-30-form-layout-builder-design.md).
//
// Mirrors backend/internal/formlayouts (types.go + handler.go). The
// server is the gate: it validates core-field presence and rejects
// unknown fieldKeys / malformed templates. The client mirrors the
// mandatory-core rule for live UX only — never as the authoritative
// check.
//
// Routes are mounted at /_site/api/form-layouts; apiSite composes
// relative to /_site, so paths here start at /api/form-layouts.

import { apiSite } from "@/app/lib/api";

// RowTemplate enumerates the fixed grid templates. Cell spans derive
// from the template, never free-form (keeps snap-to-slot clean).
export type RowTemplate = "100" | "50-50" | "30-70" | "70-30" | "30-30-30";

// templateSpans mirrors backend/internal/formlayouts/types.go. The
// builder uses this to materialise a row's empty cells when a template
// is chosen.
export const TEMPLATE_SPANS: Record<RowTemplate, number[]> = {
  "100": [100],
  "50-50": [50, 50],
  "30-70": [30, 70],
  "70-30": [70, 30],
  "30-30-30": [33, 33, 33],
};

export const ROW_TEMPLATES: { template: RowTemplate; label: string }[] = [
  { template: "100", label: "1 column" },
  { template: "50-50", label: "2 column · 50 / 50" },
  { template: "30-70", label: "2 column · 30 / 70" },
  { template: "70-30", label: "2 column · 70 / 30" },
  { template: "30-30-30", label: "3 column · equal" },
];

// FormCell is one slot in a row. fieldKey is a core field's stable key
// ("title"), or "custom:<artefacts_fields_library_id>", or null for an
// empty slot (an anchor point in the builder).
//
// Vertical merge (2026-05-31): a cell may span several stacked rows of the
// SAME template. The TOP cell of a merge carries rowSpan > 1; the cells it
// covers in the rows below become TOMBSTONES — fieldKey:null + absorbedBy set
// to the top cell's id. Tombstones keep the rows[] array rectangular (indices
// never shift) and the renderer skips them (the tall cell's grid-row span
// covers their track). Absent rowSpan/absorbedBy ⇒ a plain 1-row cell, so old
// layouts are valid untouched. See
// docs/superpowers/specs/2026-05-31-flb-vertical-merge-design.md.
export interface FormCell {
  id: string;
  fieldKey: string | null;
  span: number;
  /** Vertical extent in sub-rows. Default 1 (omitted). */
  rowSpan?: number;
  /** Horizontal extent in column tracks. Default 1 (omitted). A cell with
   *  colSpan > 1 has absorbed the cell(s) to its right in the same row; those
   *  become tombstones. Its `span` already carries the summed width. */
  colSpan?: number;
  /** If set, this cell is a tombstone covered by another cell (vertical OR
   *  horizontal merge) whose id === absorbedBy. The renderer skips it. */
  absorbedBy?: string;
}

export interface FormRow {
  id: string;
  template: RowTemplate;
  cells: FormCell[];
}

// FormLayoutDoc is the JSON document stored server-side. version is
// stamped by the server on save.
export interface FormLayoutDoc {
  version: number;
  artefactTypeId: string;
  rows: FormRow[];
}

// FormLayout is a stored version row (the GET response shape).
export interface FormLayout {
  id: string;
  topologyNodeId: string;
  artefactTypeId: string;
  workspaceId: string;
  version: number;
  isCurrent: boolean;
  isDraft: boolean;
  doc: FormLayoutDoc;
  createdAt: string;
  updatedAt: string;
}

// CoreFieldDescriptor is one entry in the builder's field sidebar.
// kind is "core" (a first-class artefacts column) or "custom" (a
// catalogue field bound to the type).
//
// isCompulsory marks a field the type REQUIRES on every form (per-type
// compulsory set, resolved server-side via CompulsoryFieldsForType). It
// drives two things: (1) which sidebar group the field lands in —
// "Mandatory fields" vs "Optional fields" — and (2) the save gate (the
// layout must place every compulsory field SOMEWHERE). The author is free
// to position them anywhere on the canvas. The server re-checks on save
// (SERVER IS THE GATE). isMandatory is a strict subset of isCompulsory
// (the three universal save-blockers), kept distinct only for the sidebar
// red-dot legend.
export interface CoreFieldDescriptor {
  fieldKey: string;
  label: string;
  dataType: string;
  kind: "core" | "custom";
  group: string;
  isMandatory: boolean;
  isCompulsory: boolean;
  // valueLocation tells a consumer (e.g. the form-viewer preview) WHERE this
  // field's value physically lives, so it knows how to read it. The unified
  // field model keeps values in two homes: "artefacts_column" for core fields
  // (a typed column on the artefacts row) and "eav" for custom fields (an
  // artefacts_fields_values row). Mirrors backend
  // formlayouts.CoreFieldDescriptor.ValueLocation (mig 167 / Option A registry).
  valueLocation: "artefacts_column" | "eav";
}

interface CoreFieldsResponse {
  fields: CoreFieldDescriptor[];
}

// MANDATORY_CORE_KEYS mirrors backend mandatoryCoreFieldKeys — the three
// universal save-blockers. The save gate uses the full isCompulsory set
// (this is a strict subset); kept as a documented mirror of the backend
// contract. The server is the authoritative gate.
export const MANDATORY_CORE_KEYS = ["title", "flow_state_name", "owner"];

// getCurrentLayout fetches the current layout for (node, type), or null
// if none exists yet (the builder then starts from an empty canvas, the
// runtime falls back to the default form).
export async function getCurrentLayout(
  nodeId: string,
  typeId: string,
): Promise<FormLayout | null> {
  try {
    return await apiSite<FormLayout>(
      `/api/form-layouts?node=${encodeURIComponent(nodeId)}&type=${encodeURIComponent(typeId)}`,
    );
  } catch (err) {
    // 404 = no layout authored yet; surface as null, re-throw anything else.
    if (isNotFound(err)) return null;
    throw err;
  }
}

// getLayoutForBuilder is the BUILDER's load path: it returns the WIP draft
// for (node, type) if one exists, else the published current layout, or null
// if neither exists (empty canvas). The runtime renderer must keep using
// getCurrentLayout — drafts are never rendered live.
export async function getLayoutForBuilder(
  nodeId: string,
  typeId: string,
): Promise<FormLayout | null> {
  try {
    return await apiSite<FormLayout>(
      `/api/form-layouts?node=${encodeURIComponent(nodeId)}&type=${encodeURIComponent(typeId)}&draft=1`,
    );
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// getLayoutById fetches one specific version row — used by the runtime
// to render a story stamped with artefacts_id_form_layout.
export async function getLayoutById(layoutId: string): Promise<FormLayout> {
  return apiSite<FormLayout>(`/api/form-layouts/${encodeURIComponent(layoutId)}`);
}

// getCoreFields returns the sidebar catalogue: core (must-have first)
// then custom fields bound to the type.
export async function getCoreFields(typeId: string): Promise<CoreFieldDescriptor[]> {
  const res = await apiSite<CoreFieldsResponse>(
    `/api/form-layouts/core-fields?type=${encodeURIComponent(typeId)}`,
  );
  return res.fields ?? [];
}

// SaveLayoutInput is the POST body. Identity/tenant/workspace are NOT
// sent — the server resolves them from the sentinel clamp.
export interface SaveLayoutInput {
  nodeId: string;
  artefactTypeId: string;
  rows: FormRow[];
}

// LayoutValidationError is the structured 422 the server returns when a
// layout omits a mandatory core field or references an unknown key.
export interface LayoutValidationError {
  error: string;
  missing: string[];
  field: string;
}

// saveLayout upserts a layout (server does the version flip). On a
// validation failure the server returns 422 with { error, missing,
// field } — callers should catch and surface `missing` to the author.
export async function saveLayout(input: SaveLayoutInput): Promise<FormLayout> {
  return apiSite<FormLayout>(`/api/form-layouts`, {
    method: "POST",
    body: JSON.stringify({
      nodeId: input.nodeId,
      artefactTypeId: input.artefactTypeId,
      rows: input.rows,
    }),
  });
}

// saveDraft persists the WIP draft for (node, type) WITHOUT publishing it.
// No version flip, no compulsory-field gate (a draft may be incomplete), and
// the runtime never renders it. Re-saving overwrites the single draft row.
// Reopening the builder reloads it via getLayoutForBuilder.
export async function saveDraft(input: SaveLayoutInput): Promise<FormLayout> {
  return apiSite<FormLayout>(`/api/form-layouts/draft`, {
    method: "POST",
    body: JSON.stringify({
      nodeId: input.nodeId,
      artefactTypeId: input.artefactTypeId,
      rows: input.rows,
    }),
  });
}

// isNotFound / extractValidation are thin helpers over ApiError without
// importing its concrete type (api.ts shape varies); we duck-type the
// status.
function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

// extractValidation pulls the structured 422 body off an ApiError if
// present, so the builder can show which mandatory fields are missing.
export function extractValidation(err: unknown): LayoutValidationError | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: number; body?: unknown; data?: unknown };
  if (e.status !== 422) return null;
  const body = (e.body ?? e.data) as LayoutValidationError | undefined;
  if (body && Array.isArray(body.missing)) return body;
  return null;
}
