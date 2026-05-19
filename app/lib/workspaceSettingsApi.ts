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

import { apiSite } from "@/app/lib/api";

export type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeekStart = "mon" | "sun";
export type RankMethod = "manual" | "dragdrop";

// PLA-0051 / Story 4 — per-field source marker. `workspace` = the
// workspace row holds an explicit override; `tenant` = inherited from
// the subscription's master_record_tenants row; `system_default` =
// neither tier has a value, the schema default applies.
export type FieldSource = "workspace" | "tenant" | "system_default";

// The 11 inheritable fields (keys without the trailing _source).
// Used by the UI to enumerate which fields show the inherit/override
// toggle. Identity/audit fields (tenant_id/name/owner/created_at/...)
// are NOT inheritable — they stay on the workspace tier always.
export const INHERITABLE_FIELDS = [
  "tenant_data_region",
  "tenant_timezone",
  "tenant_date_format",
  "tenant_datetime_format",
  "tenant_workdays",
  "tenant_week_start",
  "tenant_rank_method",
  "tenant_build_changeset_tracking",
  "tenant_primary_contact_email",
  "tenant_description",
  "tenant_notes",
] as const;
export type InheritableField = (typeof INHERITABLE_FIELDS)[number];

export interface WorkspaceSettings {
  tenant_id: string;
  tenant_name: string;
  tenant_description: string | null;
  tenant_description_source?: FieldSource;
  tenant_owner_user_id: string | null;
  tenant_primary_contact_email: string | null;
  tenant_primary_contact_email_source?: FieldSource;
  tenant_data_region: string;
  tenant_data_region_source?: FieldSource;
  tenant_timezone: string;
  tenant_timezone_source?: FieldSource;
  tenant_date_format: string;
  tenant_date_format_source?: FieldSource;
  tenant_datetime_format: string;
  tenant_datetime_format_source?: FieldSource;
  tenant_workdays: DayCode[];
  tenant_workdays_source?: FieldSource;
  tenant_week_start: WeekStart;
  tenant_week_start_source?: FieldSource;
  tenant_rank_method: RankMethod;
  tenant_rank_method_source?: FieldSource;
  tenant_build_changeset_tracking: boolean;
  tenant_build_changeset_tracking_source?: FieldSource;
  tenant_notes: string | null;
  tenant_notes_source?: FieldSource;
  tenant_created_at: string;
  tenant_updated_at: string;
  tenant_archived_at: string | null;
}

// PatchInput mirrors the backend pointer-field shape. Every key is
// optional; `null` clears nullable text fields. Send only the keys
// the user actually changed — the backend builds its UPDATE SET
// dynamically from whatever arrives.
//
// PLA-0051 / Story 5 — `clear_overrides` nulls the workspace column
// for each named inheritable field so the row falls back to inheriting
// from tenantmasterrecord. Field names match the JSON keys above
// (tenant_*); the backend validates them against its
// inheritableFieldColumn map and returns 422 on unknown entries.
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
  clear_overrides?: InheritableField[];
}

export const workspaceSettingsApi = {
  get() {
    return apiSite<WorkspaceSettings>(`/workspace-settings`);
  },
  patch(input: WorkspaceSettingsPatch) {
    return apiSite<WorkspaceSettings>(`/workspace-settings`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
};
