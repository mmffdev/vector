// B20.4.3 — typed client for /_site/cost-centres. Subscription-scoped
// reference data; reads available to any authenticated tenant member
// (the per-user dropdown depends on it), writes require the
// cost_centres.manage permission server-side.

import { apiSite } from "@/app/lib/api";

export interface CostCentre {
  id: string;
  subscription_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostCentreCreate {
  parent_id?: string | null;
  code: string;
  name: string;
  is_active?: boolean;
}

export interface CostCentreUpdate {
  parent_id?: string | null;
  code?: string;
  name?: string;
  is_active?: boolean;
}

export const costCentresApi = {
  list() {
    return apiSite<CostCentre[]>("/cost-centres");
  },
  create(input: CostCentreCreate) {
    return apiSite<CostCentre>("/cost-centres", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  patch(id: string, input: CostCentreUpdate) {
    return apiSite<CostCentre>(`/cost-centres/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  archive(id: string) {
    return apiSite<void>(`/cost-centres/${id}`, { method: "DELETE" });
  },
};
