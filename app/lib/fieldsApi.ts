// PLA-0026 / Story 00510 (F4) — typed client for the workspace field
// schema endpoint. Mirrors the Go handler at
// backend/internal/fields/handler.go (fieldRowOut + listResponse).
//
// The backend resolves admission server-side (scope=global ∪ tenant ∪
// per-workspace whitelist). Frontend MUST NOT recompute admission;
// callers render whatever this function returns.

import { apiSite as api } from "@/app/lib/api";

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
  const res = await api<FieldsListResponse>(`/workspaces/${encodeURIComponent(workspaceId)}/fields`);
  return res.fields;
}
