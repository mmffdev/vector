// Typed client for the master_record_tenants sole-writer service
// (PLA-0050 / Story 00571 — subscription-tier defaults).
// Backend: backend/internal/tenantmasterrecord/{handler,service}.go
// Routes mounted under /_site/tenant-settings — auth + fresh-password
// gated; gadmin enforcement delegated to page-access middleware once
// va-tenant-settings page row is seeded (story 00572).
//
// The row is keyed by the caller's subscription_id, so there is no id
// in the path; GET returns the caller's tenant row, PATCH updates it.
//
// Distinct from workspaceSettingsApi (workspace-tier sidecar) — see
// docs/c_c_db_routing.md. Tenant settings are the per-subscription
// "London HQ" defaults; workspace settings override them per-workspace.

import { apiSite as api } from "@/app/lib/api";

export type DayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeekStart = "mon" | "sun";
export type RankMethod = "manual" | "dragdrop";

export interface TenantSettings {
  tenant_id: string;
  tenant_name: string;
  tenant_description: string | null;
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

export interface TenantSettingsPatch {
  tenant_name?: string;
  tenant_description?: string | null;
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

export const tenantSettingsApi = {
  get() {
    return api<TenantSettings>(`/tenant-settings`);
  },
  patch(input: TenantSettingsPatch) {
    return api<TenantSettings>(`/tenant-settings`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
};
