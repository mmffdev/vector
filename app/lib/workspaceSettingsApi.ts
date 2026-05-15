// Typed client for the master_record_workspaces sole-writer service
// (table renamed from master_record_tenant by migration 067 on 2026-05-15).
// Backend: backend/internal/tenantmasterrecord/{handler,service}.go
// (directory rename to workspacemasterrecord deferred to sub-story 00565b).
// Routes mounted under /_site/workspace-settings — auth + fresh-password
// gated. The row is keyed by the caller's workspace_id, so there is no id
// in the path; GET returns the caller's row, PATCH updates it.
//
// PATCH semantics: every field is optional. Absent = no change. Sending
// `tenant_description: null` clears that nullable text column; sending
// `tenant_description: ""` is treated identically by the server (collapsed
// to NULL). Validation failures come back as 422 with `violations[]` on
// ApiError, matching the workspaces handler shape.
//
// NB: wire-shape field keys retain tenant_* prefixes because the Go service
// still emits those JSON tags (the JSON-tag rename is deferred per
// TD-NAME-001 §2.9 trade-off). Only the TS type names switched from
// Tenant* → Workspace* — the keys are honest to the Go wire format.

import { apiSite as api } from "@/app/lib/api";

export type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeekStart = "mon" | "sun";
export type RankMethod = "manual" | "dragdrop";

export interface WorkspaceSettings {
  tenant_id: string;
  tenant_name: string;
  tenant_description: string | null;
  tenant_owner_user_id: string | null;
  tenant_primary_contact_email: string | null;
  tenant_data_region: string;
  tenant_timezone: string;
  tenant_date_format: string;
  tenant_datetime_format: string;
  tenant_workdays: DayCode[];
  tenant_week_start: WeekStart;
  tenant_rank_method: RankMethod;
  tenant_build_changeset_tracking: boolean;
  tenant_notes: string | null;
  tenant_created_at: string;
  tenant_updated_at: string;
  tenant_archived_at: string | null;
}

// PatchInput mirrors the backend pointer-field shape. Every key is
// optional; `null` clears nullable text fields. Send only the keys
// the user actually changed — the backend builds its UPDATE SET
// dynamically from whatever arrives.
export interface WorkspaceSettingsPatch {
  tenant_name?: string;
  tenant_description?: string | null;
  tenant_owner_user_id?: string | null;
  tenant_data_region?: string;
  tenant_timezone?: string;
  tenant_date_format?: string;
  tenant_datetime_format?: string;
  tenant_workdays?: DayCode[];
  tenant_week_start?: WeekStart;
  tenant_rank_method?: RankMethod;
  tenant_build_changeset_tracking?: boolean;
  tenant_notes?: string | null;
  tenant_primary_contact_email?: string | null;
}

export const workspaceSettingsApi = {
  get() {
    return api<WorkspaceSettings>(`/workspace-settings`);
  },
  patch(input: WorkspaceSettingsPatch) {
    return api<WorkspaceSettings>(`/workspace-settings`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
};
