// PLA-0026 / Story 00510 (F4) — typed client for the workspace field
// schema endpoint. Mirrors the Go handler at
// backend/internal/fields/handler.go (fieldRowOut + listResponse).
//
// The backend resolves admission server-side (scope=global ∪ tenant ∪
// per-workspace whitelist). Frontend MUST NOT recompute admission;
// callers render whatever this function returns.

import { apiSite } from "@/app/lib/api";

// WorkspaceField is the wire shape for one row in the response. Field
// names mirror artefact_field_library — `name` is the machine identifier
// (column field_name), `data_type` is the field type discriminator
// (column field_type), `scope` is one of "global" | "tenant" | "workspace".
//
// `subscription_id` is null for scope=global rows. `options_json` and
// `config_json` are emitted by the server with omitempty; treat absence
// as empty / no extra config. `description` is similarly optional.
export interface WorkspaceField {
  id: string;
  subscription_id: string | null;
  name: string;
  label: string;
  data_type: string;
  options_json?: unknown;
  config_json?: unknown;
  description?: string;
  scope: "global" | "tenant" | "workspace";
  created_at: string;
  updated_at: string;
}

// listResponse wire shape — server returns { workspace_id, fields }.
interface FieldsListResponse {
  workspace_id: string;
  fields: WorkspaceField[];
}

// getWorkspaceFields fetches the admitted field set for one workspace.
// Returns just the fields array — the workspace_id echo is dropped
// because callers already know it (they passed it in).
//
// Errors surface as ApiError from app/lib/api: 401 (auth), 400 (bad
// UUID), 404 (workspace not found OR cross-tenant), 403 (in-tenant
// but caller lacks workspace membership / tenant-admin role), 500
// (plumbing).
export async function getWorkspaceFields(workspaceId: string): Promise<WorkspaceField[]> {
  const res = await apiSite<FieldsListResponse>(`/workspaces/${encodeURIComponent(workspaceId)}/fields`);
  return res.fields;
}

// CreateWorkspaceFieldInput mirrors backend/internal/fields/handler.go's
// createFieldIn struct. `scope` is "tenant" or "workspace" — "global"
// is rejected server-side (gadmin tooling, not this surface).
//
// `options_json` / `config_json` accept any JSON-serialisable shape (the
// backend stores them as JSONB and never reinterprets). They're optional;
// omit for field types that don't use them.
export interface CreateWorkspaceFieldInput {
  name: string;
  label: string;
  data_type: string;
  scope: "tenant" | "workspace";
  options_json?: unknown;
  config_json?: unknown;
  description?: string;
}

// FieldCreate is the short alias the editor page imports. Kept distinct
// from CreateWorkspaceFieldInput so we can rename one without breaking
// callers of the other.
export type FieldCreate = CreateWorkspaceFieldInput;

// createWorkspaceField creates one custom field in the catalogue and
// returns the hydrated row. POST /workspaces/{id}/fields → 201.
//
// Error codes surfaced through ApiError:
//   400 — missing required field, invalid scope/data_type, malformed body
//   403 — scope clamp (e.g. workspace-admin trying tenant-scope) or
//         scope='global' attempt
//   404 — workspace not found OR cross-tenant probe (same shape so we
//         don't leak existence)
//   409 — duplicate slug within tenant
//   503 — vector_artefacts pool not wired at boot
export async function createWorkspaceField(
  workspaceId: string,
  input: CreateWorkspaceFieldInput,
): Promise<WorkspaceField> {
  return apiSite<WorkspaceField>(
    `/workspaces/${encodeURIComponent(workspaceId)}/fields`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

// UpdateWorkspaceFieldInput is the sparse-patch shape — every column is
// optional. Send only the columns the user touched. Field NAME (slug)
// is intentionally NOT patchable on the backend; the `name` field here
// is accepted on the wire (legacy editor form binds to it) but the
// service layer silently ignores it and returns the existing slug.
// Archive + recreate is the supported rename migration path.
//
// data_type CAN be patched but the backend will 409 if any values
// already reference the field (typed-EAV column swap would corrupt
// existing data; archive + recreate instead).
export interface UpdateWorkspaceFieldInput {
  name?: string;
  label?: string;
  data_type?: string;
  options_json?: unknown;
  config_json?: unknown;
  description?: string;
}

// FieldUpdate is the short alias the editor page imports.
export type FieldUpdate = UpdateWorkspaceFieldInput;

// updateWorkspaceField patches one custom field and returns the hydrated
// row. PATCH /workspaces/{id}/fields/{field_id} → 200.
//
// Error codes:
//   400 — invalid data_type, malformed body, bad UUID
//   403 — caller is not authorised for this field's scope or it belongs
//         to a different tenant
//   404 — field not found OR already archived
//   409 — data_type change blocked because values exist
//   503 — vector_artefacts pool missing
export async function updateWorkspaceField(
  workspaceId: string,
  fieldId: string,
  input: UpdateWorkspaceFieldInput,
): Promise<WorkspaceField> {
  return apiSite<WorkspaceField>(
    `/workspaces/${encodeURIComponent(workspaceId)}/fields/${encodeURIComponent(fieldId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

// archiveWorkspaceField soft-deletes the field (sets archived_at = now()
// server-side). Existing artefacts_fields_values rows are preserved —
// the field just disappears from new pickers and the admitted set.
// DELETE /workspaces/{id}/fields/{field_id} → 204.
//
// Error codes:
//   400 — bad UUID
//   403 — wrong scope/tenant, or attempting to archive a scope='global' row
//   404 — field not found OR already archived
//   503 — vector_artefacts pool missing
export async function archiveWorkspaceField(
  workspaceId: string,
  fieldId: string,
): Promise<void> {
  await apiSite<void>(
    `/workspaces/${encodeURIComponent(workspaceId)}/fields/${encodeURIComponent(fieldId)}`,
    {
      method: "DELETE",
    },
  );
}
