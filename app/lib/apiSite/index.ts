/**
 * siteApi — typed master registry for all /_site backend calls.
 *
 * Every call the frontend makes to the Go backend's mountSiteRoutes block
 * should live here. Pages and components import from this file instead of
 * calling apiSite() directly. That keeps every route path in one place and
 * makes it easy to see what exists, rename paths, and add logging/tracing.
 *
 * Backend reference: backend/cmd/server/main.go → mountSiteRoutes (L646–967)
 *
 * Exports:
 *   auth               — login, logout, refresh, me, changePassword, requestPasswordReset, confirmPasswordReset
 *   me                 — getThemePack, setThemePack
 *   nav                — getCatalogue, getPrefs, putPrefs, deletePrefs, getStartPage,
 *                        listProfiles, createProfile, reorderProfiles, setActiveProfile,
 *                        renameProfile, deleteProfile, listProfileGroups, setProfileGroups
 *   userTabOrder       — get, put, delete
 *   customPages        — list, create, get, patch, delete
 *   workspaces         — list, listArchived, create, rename, archive, restore
 *   webhooks           — list, create, update, delete
 *   admin              — listUsers, createUser, patchUser, deleteUser, issuePasswordReset,
 *                        listApiKeys, issueApiKey, revokeApiKey, devAdoptionReset
 *   portfolioModels    — list, getAdoptionState, getLatestByFamily, getById, adopt, adoptStreamUrl
 *   portfolio          — getMasterRecord, getWorkspaceLayers
 *   subscriptionLayers — get, batchPatch
 *   flows              — list
 *   flowStates         — patch
 *   workspaceFields    — list
 *   workItems          — list, get, create, patch, archive, bulk, summary, listFlowStates,
 *                        listChildren, query, getFieldValues, upsertFieldValues, deleteFieldValue
 *   portfolioItems     — list, get, create, patch, archive, bulk, summary, listFlowStates,
 *                        listChildren, query, getFieldValues, upsertFieldValues, deleteFieldValue
 *   ranking            — move
 *   sprints            — list, get, create, bulkCreate, update, delete, start, close
 *   releases           — list, get, create, bulkCreate, update, delete
 *   topology           — tree, ancestors, archivedDescendants, previewMove, disconnected,
 *                        commitStatus, putViewState, createNode, patchNode, archiveNode,
 *                        disconnectNode, duplicateNode, restoreNode, bulkPosition,
 *                        grantRole, revokeRole, commit, reset
 *   roles              — list, listCreatable, listPermissionsCatalogue, get, create, update,
 *                        archive, listPermissions, assignPermissions, revokePermissions
 *   errors             — report
 *   libraryReleases    — list, count, ack
 *   flowBoard          — listWip, upsertWip, getCardPrefs, upsertCardPrefs, putWip
 *   topologyMembers    — listNodeMembers
 *   addressables       — buildReconcile, register, snapshot, getPageHelp, adminListPageHelp,
 *                        adminPutPageHelp, adminDeletePageHelp, adminUpdateHelpable
 */

import { apiSite } from "@/app/lib/api";

// ─── Shared primitives ────────────────────────────────────────────────────────

export type ID = string;
export type ISODate = string;

// Body DTO for the audited POST read-gateway (POST /work-items/query +
// /portfolio-items/query). Unifies "list roots" (no parentId) and "list
// children" (parentId set) behind one body-driven endpoint so every read
// is logged uniformly for SOC 2 — no identifiers in any URL. The server
// clamp (subscription + workspace from ctx) is the authority; every field
// here is a re-validated NARROW hint that can only sub-select within it.
export interface WorkItemQueryBody {
  parentId?: ID;
  filters?: {
    itemTypeId?: ID[];
    flowStateId?: ID[];
    priorityId?: ID[];
    ownerId?: ID[];
    sprintId?: string; // UUID, or "__none__" for "no sprint assigned"
  };
  page?: { limit?: number; offset?: number };
  sort?: { key: string; dir: string };
}

// Roots path returns { items, total }; children path returns { items }
// (no total, matching the GET /{id}/children contract) — total optional.
export interface WorkItemQueryResult {
  items: unknown[];
  total?: number;
}

export interface WorkItemQueryOptions {
  meg?: ID;
}

export interface WorkItemsSummary {
  total: number;
  blocked: number;
  by_type: Record<string, number>;
}

// Pages: app/login/page.tsx, app/login/reset/page.tsx, app/login/reset/confirm/page.tsx,
//        app/change-password/page.tsx, app/contexts/AuthContext.tsx
// ─── Auth  (/auth) ───────────────────────────────────────────────────────────

export interface AuthUser {
  id: ID;
  subscription_id: ID;
  email: string;
  role: { id: ID; code: string; label: string; rank: number };
  is_active: boolean;
  force_password_change: boolean;
  auth_method: "local" | "ldap";
  permissions: string[];
}

export interface LoginResult {
  access_token: string;
  user: AuthUser;
}

export const auth = {
  login: (email: string, password: string) =>
    apiSite<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    }),

  refresh: () =>
    apiSite<LoginResult>("/auth/refresh", { method: "POST", skipAuth: true }),
  // Logout ME
  logout: () =>
    apiSite<void>("/auth/logout", { method: "POST" }),

  me: () =>
    apiSite<AuthUser>("/auth/me"),

  changePassword: (current: string, next: string) =>
    apiSite<void>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current, new: next }),
    }),

  requestPasswordReset: (email: string) =>
    apiSite<void>("/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipAuth: true,
    }),

  confirmPasswordReset: (token: string, password: string) =>
    apiSite<void>("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, password }),
      skipAuth: true,
    }),
};

// Pages: app/hooks/useThemePack.ts
// ─── Me  (/me) ───────────────────────────────────────────────────────────────

export const me = {
  getThemePack: () =>
    apiSite<{ theme_pack: string | null }>("/me/theme-pack"),

  setThemePack: (pack: string | null) =>
    apiSite<void>("/me/theme-pack", {
      method: "PUT",
      body: JSON.stringify({ theme_pack: pack }),
    }),
};

// Pages: app/contexts/NavPrefsContext.tsx, app/login/page.tsx (start-page redirect),
//        app/components/SecondaryNavigation.tsx (profile ops)
// ─── Nav  (/nav) ─────────────────────────────────────────────────────────────

export interface NavCatalogueEntry {
  key: string;
  label: string;
  href: string;
  kind: "static" | "entity" | "user_custom";
  roles: string[];
  pinnable: boolean;
  defaultPinned: boolean;
  defaultOrder: number;
  icon: string;
  tagEnum: string;
}

export interface NavProfile {
  id: ID;
  label: string;
  position: number;
  is_default: boolean;
  start_page_key: string | null;
}

export interface NavPrefRow {
  item_key: string;
  position: number;
  is_start_page: boolean;
  parent_item_key: string | null;
  group_id: string | null;
  icon_override: string | null;
}

export const nav = {
  getCatalogue: () =>
    apiSite<{ catalogue: NavCatalogueEntry[]; tags: unknown[] }>("/nav/catalogue"),

  getPrefs: (profileId?: string) =>
    apiSite<{ prefs: NavPrefRow[]; groups: unknown[]; profile_id: string }>(
      profileId ? `/nav/prefs?profile_id=${encodeURIComponent(profileId)}` : "/nav/prefs"
    ),

  putPrefs: (body: unknown) =>
    apiSite<{ groups: unknown[] }>("/nav/prefs", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deletePrefs: (profileId?: string) =>
    apiSite<void>(
      profileId ? `/nav/prefs?profile_id=${encodeURIComponent(profileId)}` : "/nav/prefs",
      { method: "DELETE" }
    ),

  getStartPage: () =>
    apiSite<{ key: string | null }>("/nav/start-page"),

  // Entity bookmarks (pinBookmark/unpinBookmark/checkBookmark) deleted with
  // TD-CUT1.1.1-BOOKMARK-SURFACE — see backend/internal/nav/bookmarks.go.
  // Page bookmarks (PageBookmarks) survive on their own routes.

  listProfiles: () =>
    apiSite<{ profiles: NavProfile[]; active_profile_id: string | null }>("/nav/profiles"),

  createProfile: (label: string) =>
    apiSite<NavProfile>("/nav/profiles", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),

  reorderProfiles: (profileIds: ID[]) =>
    apiSite<void>("/nav/profiles/order", {
      method: "PUT",
      body: JSON.stringify({ profile_ids: profileIds }),
    }),

  setActiveProfile: (profileId: ID) =>
    apiSite<void>("/nav/profiles/active", {
      method: "PUT",
      body: JSON.stringify({ profile_id: profileId }),
    }),

  renameProfile: (profileId: ID, label: string) =>
    apiSite<void>(`/nav/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  deleteProfile: (profileId: ID) =>
    apiSite<void>(`/nav/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" }),

  listProfileGroups: (profileId: ID) =>
    apiSite<{ placements: unknown[] }>(`/nav/profiles/${encodeURIComponent(profileId)}/groups`),

  setProfileGroups: (profileId: ID, placements: unknown[]) =>
    apiSite<void>(`/nav/profiles/${encodeURIComponent(profileId)}/groups`, {
      method: "PUT",
      body: JSON.stringify({ placements }),
    }),
};

// Pages: app/components/SecondaryNavigation.tsx
// ─── User tab order  (/user/tab-order) ───────────────────────────────────────

export const userTabOrder = {
  get: (pageId: string) =>
    apiSite<{ order: string[] }>(`/user/tab-order/${encodeURIComponent(pageId)}`),

  put: (pageId: string, order: string[]) =>
    apiSite<void>(`/user/tab-order/${encodeURIComponent(pageId)}`, {
      method: "PUT",
      body: JSON.stringify({ order }),
    }),

  delete: (pageId: string) =>
    apiSite<void>(`/user/tab-order/${encodeURIComponent(pageId)}`, { method: "DELETE" }),
};

// Pages: app/lib/customPages.ts (shared helper), nav catalogue population
// ─── Custom pages  (/custom-pages) ───────────────────────────────────────────

export interface CustomPage {
  id: ID;
  label: string;
  href: string;
  icon: string;
}

export const customPages = {
  list: () =>
    apiSite<{ pages: CustomPage[] }>("/custom-pages/"),

  create: (data: Omit<CustomPage, "id">) =>
    apiSite<CustomPage>("/custom-pages/", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  get: (id: ID) =>
    apiSite<CustomPage>(`/custom-pages/${id}`),

  patch: (id: ID, data: Partial<Omit<CustomPage, "id">>) =>
    apiSite<CustomPage>(`/custom-pages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: ID) =>
    apiSite<void>(`/custom-pages/${id}`, { method: "DELETE" }),
};

// Pages: app/lib/workspacesApi.ts (shared helper),
//        gadmin workspace management UI
// ─── Workspaces  (/workspaces) ────────────────────────────────────────────────

export interface Workspace {
  id: ID;
  subscription_id: ID;
  name: string;
  slug: string;
  description: string | null;
  created_by: ID;
  created_at: ISODate;
  updated_at: ISODate;
  archived_at: ISODate | null;
  archived_by: ID | null;
}

export const workspaces = {
  list: () =>
    apiSite<Workspace[]>("/workspaces"),

  listArchived: () =>
    apiSite<Workspace[]>("/workspaces?archived=true"),

  create: (data: { name: string; slug: string; description?: string }) =>
    apiSite<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(data) }),

  rename: (id: ID, name: string) =>
    apiSite<void>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  archive: (id: ID) =>
    apiSite<void>(`/workspaces/${id}/archive`, { method: "POST" }),

  restore: (id: ID) =>
    apiSite<void>(`/workspaces/${id}/restore`, { method: "POST" }),
};

// Pages: app/(user)/vector-admin/api-manager/webhooks/page.tsx, WebhookForm.tsx
// ─── Webhooks  (/workspaces/{workspaceId}/webhooks) ──────────────────────────

export interface Webhook {
  id: ID;
  url: string;
  events: string | null;
  secret: string | null;
  created_at: ISODate;
}

export const webhooks = {
  list: (workspaceId: ID) =>
    apiSite<{ webhooks: Webhook[] }>(`/workspaces/${workspaceId}/webhooks`),

  create: (workspaceId: ID, data: Pick<Webhook, "url" | "events" | "secret">) =>
    apiSite<Webhook>(`/workspaces/${workspaceId}/webhooks`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (workspaceId: ID, webhookId: ID, data: Partial<Pick<Webhook, "url" | "events" | "secret">>) =>
    apiSite<Webhook>(`/workspaces/${workspaceId}/webhooks/${webhookId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (workspaceId: ID, webhookId: ID) =>
    apiSite<void>(`/workspaces/${workspaceId}/webhooks/${webhookId}`, { method: "DELETE" }),
};

// Pages: app/(user)/user-management/page.tsx (user management),
//        app/(user)/admin/api-keys/page.tsx (API key issuance),
//        dev/pages/DevPage.tsx (devAdoptionReset, devMasterReset — gadmin dev only)
// ─── Admin  (/admin) ─────────────────────────────────────────────────────────

export const admin = {
  listUsers: () =>
    apiSite<{ users: unknown[] }>("/admin/users"),

  createUser: (data: unknown) =>
    apiSite<unknown>("/admin/users", { method: "POST", body: JSON.stringify(data) }),

  patchUser: (id: ID, data: unknown) =>
    apiSite<unknown>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteUser: (id: ID) =>
    apiSite<void>(`/admin/users/${id}`, { method: "DELETE" }),

  issuePasswordReset: (userId: ID) =>
    apiSite<void>(`/admin/users/${userId}/password-reset`, { method: "POST" }),

  listApiKeys: () =>
    apiSite<{ keys: unknown[] }>("/admin/api-keys"),

  issueApiKey: (data: unknown) =>
    apiSite<unknown>("/admin/api-keys/issue", { method: "POST", body: JSON.stringify(data) }),

  revokeApiKey: (data: unknown) =>
    apiSite<void>("/admin/api-keys/revoke", { method: "POST", body: JSON.stringify(data) }),

  /** padmin-only (dev): wipe adoption state so you can re-adopt in dev/staging */
  devAdoptionReset: () =>
    apiSite<void>("/admin/dev/adoption-reset", { method: "POST" }),

  /** gadmin-only (dev): full testbed reset — clears all tenant data across both
   *  DBs and re-seeds master_record_tenant + one root topology node "ACME Bank".
   *  Does NOT touch users, roles, permissions, pages, or nav prefs. */
  devMasterReset: () =>
    apiSite<{ success: boolean; message: string }>("/admin/dev/master-reset", { method: "POST" }),

  /** gadmin-only (dev): seed N Risk artefacts (default 200) into the caller's
   *  subscription, assigned to assignee_id (default: caller). Defined in
   *  backend/internal/portfoliomodels/dev_reset.go (SeedRisks). */
  devSeedRisks: (params: { count?: number; assignee_id?: string } = {}) =>
    apiSite<{ success: boolean; inserted: number; message: string }>(
      "/admin/dev/seed-risks",
      { method: "POST", body: JSON.stringify(params) },
    ),

  /** gadmin-only (dev): insert a fresh workspace + root topology node for the
   *  caller's subscription. Each call produces a distinct workspace (random UUID).
   *  Defined in backend/internal/portfoliomodels/dev_reset.go (SeedWorkspace). */
  devSeedWorkspace: (params: { name?: string } = {}) =>
    apiSite<{ success: boolean; workspace_id: string; name: string }>(
      "/admin/dev/seed-workspace",
      { method: "POST", body: JSON.stringify(params) },
    ),
};

// Pages: dev/pages/DevReportingPanel.tsx
// ─── Dev reporting  (/admin/dev/reporting) ───────────────────────────────────
// Reads/writes the dev_reports table in mmff_dev (research, plan, security,
// retro, code, api, misc). Backend handler: backend/internal/devreports.

export type DevReportType =
  | "research" | "plan" | "security" | "retro" | "code" | "api" | "misc" | "system";

export interface DevReportMeta {
  id: string;
  type: DevReportType;
  title: string;
  category: string;
  topic: string;
  summary: string;
  content_text: string;
  report_date: string;
  created_at: string;
  updated_at: string;
}

export interface DevReportFull extends DevReportMeta {
  content: string;
  payload?: Record<string, unknown>;
}

export interface DevReportUpsert {
  id: string;
  type: DevReportType;
  title: string;
  category?: string;
  topic?: string;
  summary?: string;
  content: string;
  content_text?: string;
  payload?: Record<string, unknown>;
  report_date?: string;
}

export const devReporting = {
  list: (params: { type?: DevReportType | "all"; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.type && params.type !== "all") qs.set("type", params.type);
    if (params.q) qs.set("q", params.q);
    const tail = qs.toString();
    return apiSite<{ reports: DevReportMeta[] }>(
      `/admin/dev/reporting/${tail ? "?" + tail : ""}`,
    );
  },

  get: (id: string) =>
    apiSite<DevReportFull>(`/admin/dev/reporting/${encodeURIComponent(id)}`),

  upsert: (body: DevReportUpsert) =>
    apiSite<DevReportFull>("/admin/dev/reporting/", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  delete: (id: string) =>
    apiSite<{ ok: true; id: string }>(
      `/admin/dev/reporting/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

// Pages: app/(user)/portfolio-model/page.tsx (padmin — list + adopt),
//        app/components/WizardModelCardList.tsx, app/components/AdoptionOverlay.tsx
// ─── Portfolio models  (/portfolio-models) ───────────────────────────────────
// Library catalogue of MMFF-published bundles; adoption is padmin-only.

export interface PortfolioModelLayer {
  tag: string;
  name: string;
}

export interface PortfolioModelListItem {
  id: ID;
  name: string;
  description: string | null;
  layers: PortfolioModelLayer[];
}

export interface AdoptionState {
  status: string;
  adopted: boolean;
  model_id: ID | null;
  adopted_at: ISODate | null;
  adopted_by_user_id: ID | null;
}

export interface AdoptionResult {
  state_id: ID;
  model_id: ID;
  status: string;
  adopted_at: ISODate;
}

export const portfolioModels = {
  /** padmin-only: list MMFF-published bundles available for adoption */
  list: () =>
    apiSite<{ models: PortfolioModelListItem[] }>("/portfolio-models/"),

  /** padmin-only: current adoption state for this subscription */
  getAdoptionState: () =>
    apiSite<AdoptionState>("/portfolio-models/adoption-state"),

  /** any auth'd user: fetch the latest bundle for a given family slug */
  getLatestByFamily: (family: string) =>
    apiSite<unknown>(`/portfolio-models/${encodeURIComponent(family)}/latest`),

  /** any auth'd user: fetch a specific bundle by ID */
  getById: (id: ID) =>
    apiSite<unknown>(`/portfolio-models/${id}`),

  /** padmin-only: run the adoption saga synchronously, returns final state */
  adopt: (id: ID) =>
    apiSite<AdoptionResult>(`/portfolio-models/${id}/adopt`, { method: "POST" }),

  /** padmin-only: SSE stream of adoption saga steps — use EventSource directly,
   *  not apiSite(), as this is a streaming response.
   *  Path: GET /_site/portfolio-models/{id}/adopt/stream */
  adoptStreamUrl: (id: ID) => `/_site/portfolio-models/${id}/adopt/stream`,
};

// Pages: app/(user)/portfolio-model/page.tsx (padmin — workspace layers view)
// ─── Portfolio master record  (/portfolio/master_record) ─────────────────────
// Per-workspace adopted portfolio model record — read after adoption completes.

export interface WorkspaceLayerPatchInput {
  id: ID;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
}

export const portfolio = {
  /** GET /portfolio/master_record?workspace_id={id}
   *  Returns 404 if workspace is unadopted (existence not leaked). */
  getMasterRecord: (workspaceId: ID) =>
    apiSite<unknown>(`/portfolio/master_record?workspace_id=${workspaceId}`),

  /** GET /workspace/{id}/portfolio/layers — admitted layer set for a workspace */
  getWorkspaceLayers: (workspaceId: ID) =>
    apiSite<{ layers: unknown[] }>(`/workspace/${workspaceId}/portfolio/layers`),

  /** PATCH /workspace/{id}/portfolio/layers/batch — batch update strategy
   *  artefact_types rows owned by the workspace. Returns the full updated set. */
  batchPatchWorkspaceLayers: <T = unknown>(workspaceId: ID, inputs: WorkspaceLayerPatchInput[]) =>
    apiSite<T[]>(`/workspace/${workspaceId}/portfolio/layers/batch`, {
      method: "PATCH",
      body: JSON.stringify(inputs),
    }),
};

// Pages: app/(user)/workspace-admin/flow-states/page.tsx
// Lib:   app/lib/flowStatesApi.ts
// ─── Flows  (/flows, /flow-states) ───────────────────────────────────────────

export interface FlowExitRule {
  id: ID;
  sort_order: number;
  name: string;
  colour?: string | null;
}

export interface FlowState {
  id: ID;
  name: string;
  kind: "backlog" | "todo" | "in_progress" | "done" | "accepted" | "cancelled";
  sort_order: number;
  is_initial: boolean;
  is_pullable: boolean;
  colour?: string | null;
  description?: string | null;
  exit_rules?: FlowExitRule[];
  exit_rule_count: number;
}

export interface FlowTransition {
  from: ID;
  to: ID;
}

export interface FlowGroup {
  flow_id: ID;
  flow_name: string;
  is_default: boolean;
  type_id: ID;
  type_name: string;
  type_scope: "work" | "strategy";
  states: FlowState[];
  transitions: FlowTransition[];
}

export interface FlowsResponse {
  work: FlowGroup[];
  strategy: FlowGroup[];
}

// Reset-to-default surface — diff/preview, then apply.

export interface ResetPillDelta {
  action: "keep" | "update" | "add" | "remove";
  live_state_id?: string;
  name: string;
  kind: string;
  sort_order: number;
  is_initial: boolean;
  is_pullable: boolean;
  successor_state_id?: string;
  successor_state_name?: string;
}

export interface ResetTransitionDelta {
  action: "add" | "remove";
  from_state_id: string;
  to_state_id: string;
  from_name: string;
  to_name: string;
}

export interface ResetArtefactImpact {
  removed_state_id: string;
  removed_state_name: string;
  successor_state_id: string;
  successor_state_name: string;
  artefact_count: number;
}

export interface ResetPreview {
  artefact_type_id: string;
  artefact_type_name: string;
  flow_id: string;
  flow_name: string;
  pills: ResetPillDelta[];
  transitions: ResetTransitionDelta[];
  artefact_impacts: ResetArtefactImpact[];
  already_at_default: boolean;
}

export interface ResetApplyResult {
  artefact_type_id: string;
  flow_id: string;
  pills_added: number;
  pills_updated: number;
  pills_removed: number;
  transitions_added: number;
  transitions_removed: number;
  artefacts_rebound: number;
}

export const flows = {
  list: () =>
    apiSite<FlowsResponse>("/flows/"),

  createState: (flowId: ID, data: { name: string; kind: string; sort_order?: number; is_initial?: boolean; is_pullable?: boolean }) =>
    apiSite<FlowState>(`/flows/${flowId}/states`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  createTransition: (flowId: ID, from_state_id: ID, to_state_id: ID) =>
    apiSite<FlowTransition>(`/flows/${flowId}/transitions`, {
      method: "POST",
      body: JSON.stringify({ from_state_id, to_state_id }),
    }),

  deleteTransition: (flowId: ID, from_state_id: ID, to_state_id: ID) =>
    apiSite<void>(`/flows/${flowId}/transitions`, {
      method: "DELETE",
      body: JSON.stringify({ from_state_id, to_state_id }),
    }),

  resetPreview: (artefact_type_id: ID) =>
    apiSite<ResetPreview>(`/flows/reset/preview`, {
      method: "POST",
      body: JSON.stringify({ artefact_type_id }),
    }),

  resetApply: (artefact_type_id: ID) =>
    apiSite<ResetApplyResult>(`/flows/reset/apply`, {
      method: "POST",
      body: JSON.stringify({ artefact_type_id }),
    }),
};

export const flowStates = {
  patch: (
    stateId: ID,
    patch: {
      colour?: string | null;
      name?: string;
      kind?: string;
      sort_order?: number;
      is_initial?: boolean;
      is_pullable?: boolean;
      description?: string | null;
    },
  ) =>
    apiSite<FlowState>(`/flow-states/${stateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  delete: (stateId: ID) =>
    apiSite<void>(`/flow-states/${stateId}`, { method: "DELETE" }),

  listExitRules: (stateId: ID) =>
    apiSite<{ exit_rules: FlowExitRule[] }>(`/flow-states/${stateId}/exit-rules`),

  createExitRule: (stateId: ID, data: { name: string; colour?: string | null }) =>
    apiSite<FlowExitRule>(`/flow-states/${stateId}/exit-rules`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

export const flowStateExitRules = {
  patch: (
    ruleId: ID,
    patch: { name?: string; colour?: string | null; sort_order?: number },
  ) =>
    apiSite<FlowExitRule>(`/flow-state-exit-rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  delete: (ruleId: ID) =>
    apiSite<void>(`/flow-state-exit-rules/${ruleId}`, { method: "DELETE" }),
};

// Pages: app/lib/fieldsApi.ts (shared helper), app/(user)/workspace-admin/custom-fields/
// ─── Workspace fields  (/workspace/{id}/fields) ──────────────────────────────

export const workspaceFields = {
  list: (workspaceId: ID) =>
    apiSite<{ fields: unknown[] }>(`/workspace/${workspaceId}/fields/`),
};

// Pages: app/(user)/work-items/list/page.tsx, app/components/WorkItemDetailPanel.tsx,
//        app/hooks/useWorkItemFlowStates.ts, app/lib/work-items-tree-config.tsx
// ─── Work items  (/work-items) ───────────────────────────────────────────────

export const workItems = {
  // Delegated to work-items-tree-config.tsx / WorkItemDetailPanel.tsx.
  // These use a dynamic resourceUrl pattern (scope-parameterised). Full
  // typed surface will land when those callers are migrated here.

  list: (params: string) =>
    apiSite<{ items: unknown[]; total: number }>(`/work-items?${params}`),

  get: (id: ID) =>
    apiSite<unknown>(`/work-items/${id}`),

  create: (data: unknown) =>
    apiSite<unknown>("/work-items", { method: "POST", body: JSON.stringify(data) }),

  patch: (id: ID, data: unknown) =>
    apiSite<unknown>(`/work-items/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  archive: (id: ID) =>
    apiSite<void>(`/work-items/${id}`, { method: "DELETE" }),

  listChildren: (id: ID) =>
    apiSite<{ items: unknown[] }>(`/work-items/${id}/children`),

  // Audited POST read-gateway — the canonical read path for the Grid tree.
  // body.parentId set → direct children; absent → roots (with page window).
  // No identifiers in the URL; the server clamp is the authority.
  query: (body: WorkItemQueryBody, options?: WorkItemQueryOptions) =>
    apiSite<WorkItemQueryResult>(
      options?.meg
        ? `/work-items/query?meg=${encodeURIComponent(options.meg)}`
        : "/work-items/query",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  // Parent chain — immediate-parent-first up to topmost ancestor.
  // Slim projection used by ArtefactNodeDiagram.
  listAncestors: (id: ID) =>
    apiSite<{ ancestors: unknown[] }>(`/work-items/${id}/ancestors`),

  bulk: (data: unknown) =>
    apiSite<unknown>("/work-items/bulk", { method: "POST", body: JSON.stringify(data) }),

  summary: (params?: string) =>
    apiSite<WorkItemsSummary>(
      params ? `/work-items/summary?${params}` : "/work-items/summary",
    ),

  listFlowStates: (params: string) =>
    apiSite<{ flow_states: unknown[] }>(`/work-items/flow-states?${params}`),

  getFieldValues: (id: ID) =>
    apiSite<{ field_values: unknown[] }>(`/work-items/${id}/field-values`),

  upsertFieldValues: (id: ID, values: unknown) =>
    apiSite<{ field_values: unknown[] }>(`/work-items/${id}/field-values`, {
      method: "PUT",
      body: JSON.stringify(values),
    }),

  deleteFieldValue: (id: ID, fieldLibraryId: ID) =>
    apiSite<void>(`/work-items/${id}/field-values/${fieldLibraryId}`, { method: "DELETE" }),
};

// Pages: app/(user)/portfolio-items/list/page.tsx, app/components/WorkItemDetailPanel.tsx
//        (shared detail panel), app/lib/work-items-tree-config.tsx (scope-parameterised)
// ─── Portfolio items  (/portfolio-items) ─────────────────────────────────────

export const portfolioItems = {
  // Same handler as workItems (artefactitems), different route prefix.
  list: (params: string) =>
    apiSite<{ items: unknown[]; total: number }>(`/portfolio-items?${params}`),

  get: (id: ID) =>
    apiSite<unknown>(`/portfolio-items/${id}`),

  create: (data: unknown) =>
    apiSite<unknown>("/portfolio-items", { method: "POST", body: JSON.stringify(data) }),

  patch: (id: ID, data: unknown) =>
    apiSite<unknown>(`/portfolio-items/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  archive: (id: ID) =>
    apiSite<void>(`/portfolio-items/${id}`, { method: "DELETE" }),

  bulk: (data: unknown) =>
    apiSite<unknown>("/portfolio-items/bulk", { method: "POST", body: JSON.stringify(data) }),

  summary: (params?: string) =>
    apiSite<WorkItemsSummary>(
      params ? `/portfolio-items/summary?${params}` : "/portfolio-items/summary",
    ),

  listFlowStates: (params: string) =>
    apiSite<{ flow_states: unknown[] }>(`/portfolio-items/flow-states?${params}`),

  listChildren: (id: ID) =>
    apiSite<{ items: unknown[] }>(`/portfolio-items/${id}/children`),

  // Audited POST read-gateway — parity with workItems.query.
  query: (body: WorkItemQueryBody) =>
    apiSite<WorkItemQueryResult>("/portfolio-items/query", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listAncestors: (id: ID) =>
    apiSite<{ ancestors: unknown[] }>(`/portfolio-items/${id}/ancestors`),

  getFieldValues: (id: ID) =>
    apiSite<{ field_values: unknown[] }>(`/portfolio-items/${id}/field-values`),

  upsertFieldValues: (id: ID, values: unknown) =>
    apiSite<{ field_values: unknown[] }>(`/portfolio-items/${id}/field-values`, {
      method: "PUT",
      body: JSON.stringify(values),
    }),

  deleteFieldValue: (id: ID, fieldLibraryId: ID) =>
    apiSite<void>(`/portfolio-items/${id}/field-values/${fieldLibraryId}`, { method: "DELETE" }),
};

// Pages: app/hooks/useResourceRank.ts (shared hook — called from any ranked resource list)
// ─── Ranking  (/rank) ────────────────────────────────────────────────────────

export const ranking = {
  move: (data: unknown) =>
    apiSite<void>("/rank/move", { method: "POST", body: JSON.stringify(data) }),
};

// Pages: app/components/TimeboxManager.tsx, app/hooks/useTimebox.ts
// ─── Timeboxes — Sprints  (/timeboxes/sprints) ───────────────────────────────

export interface Timebox {
  id: ID;
  label: string;
  start_date: ISODate | null;
  end_date: ISODate | null;
  status: string;
  position: number;
  workspace_id: ID;
}

// Slice 6.3a (2026-05-21) — list + bulk-create responses cut over to
// the ObjectTreeV2 `{ items, total }` contract. Old shape `{sprints}` /
// `{releases}` keys removed from the wire; legacy useTimebox +
// ArtefactInlineForm updated in slice 6.3b.

function scopedTimeboxPath(base: string, params: string): string {
  const parsed = new URLSearchParams(params);
  if (!parsed.get("workspace_id") || !parsed.get("org_node_id")) {
    throw new Error("timebox API calls require workspace_id and org_node_id");
  }
  return `${base}?${params}`;
}

export const sprints = {
  list: (params: string) =>
    apiSite<{ items: Timebox[]; total: number }>(scopedTimeboxPath("/timeboxes/sprints", params)),

  get: (id: ID, params: string) =>
    apiSite<Timebox>(scopedTimeboxPath(`/timeboxes/sprints/${id}`, params)),

  create: (data: unknown, params: string) =>
    apiSite<Timebox>(scopedTimeboxPath("/timeboxes/sprints", params), { method: "POST", body: JSON.stringify(data) }),

  bulkCreate: (data: unknown, params: string) =>
    apiSite<{ items: Timebox[]; total: number }>(scopedTimeboxPath("/timeboxes/sprints/bulk-create", params), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: ID, data: unknown, params: string) =>
    apiSite<Timebox>(scopedTimeboxPath(`/timeboxes/sprints/${id}`, params), { method: "PUT", body: JSON.stringify(data) }),

  delete: (id: ID, params: string) =>
    apiSite<void>(scopedTimeboxPath(`/timeboxes/sprints/${id}`, params), { method: "DELETE" }),

  start: (id: ID, params: string) =>
    apiSite<void>(scopedTimeboxPath(`/timeboxes/sprints/${id}/start`, params), { method: "POST" }),

  close: (id: ID, params: string) =>
    apiSite<void>(scopedTimeboxPath(`/timeboxes/sprints/${id}/close`, params), { method: "POST" }),
};

// Pages: app/components/TimeboxManager.tsx, app/hooks/useTimebox.ts
// ─── Timeboxes — Releases  (/timeboxes/releases) ─────────────────────────────

export const releases = {
  list: (params: string) =>
    apiSite<{ items: Timebox[]; total: number }>(scopedTimeboxPath("/timeboxes/releases", params)),

  get: (id: ID, params: string) =>
    apiSite<Timebox>(scopedTimeboxPath(`/timeboxes/releases/${id}`, params)),

  create: (data: unknown, params: string) =>
    apiSite<Timebox>(scopedTimeboxPath("/timeboxes/releases", params), { method: "POST", body: JSON.stringify(data) }),

  bulkCreate: (data: unknown, params: string) =>
    apiSite<{ items: Timebox[]; total: number }>(scopedTimeboxPath("/timeboxes/releases/bulk-create", params), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: ID, data: unknown, params: string) =>
    apiSite<Timebox>(scopedTimeboxPath(`/timeboxes/releases/${id}`, params), { method: "PUT", body: JSON.stringify(data) }),

  delete: (id: ID, params: string) =>
    apiSite<void>(scopedTimeboxPath(`/timeboxes/releases/${id}`, params), { method: "DELETE" }),
};

// Pages: app/components/ArtefactInlineForm/* (form Milestone dropdown)
// ─── Timeboxes — Milestones  (/timeboxes/milestones) ─────────────────────────
//
// Point-in-time markers (no date range, no cadence). Backend handlers in
// backend/internal/timeboxmilestones; table timeboxes_milestones added by
// migrations 085 + 087.

export interface Milestone {
  timeboxes_milestones_id: ID;
  timeboxes_milestones_id_subscription: ID;
  timeboxes_milestones_id_workspace: ID;
  timeboxes_milestones_id_topology_node: ID | null;
  timeboxes_milestones_name: string;
  timeboxes_milestones_description: string | null;
  timeboxes_milestones_id_user_owner: ID | null;
  timeboxes_milestones_date_target: ISODate;
  timeboxes_milestones_status: string;
  timeboxes_milestones_position: number;
  timeboxes_milestones_created_at: string;
  timeboxes_milestones_updated_at: string;
  timeboxes_milestones_archived_at: string | null;
}

export const milestones = {
  list: (params: string) =>
    apiSite<{ milestones: Milestone[]; count: number }>(scopedTimeboxPath("/timeboxes/milestones", params)),

  get: (id: ID, params: string) =>
    apiSite<Milestone>(scopedTimeboxPath(`/timeboxes/milestones/${id}`, params)),

  create: (data: unknown, params: string) =>
    apiSite<Milestone>(scopedTimeboxPath("/timeboxes/milestones", params), { method: "POST", body: JSON.stringify(data) }),

  update: (id: ID, data: unknown, params: string) =>
    apiSite<Milestone>(scopedTimeboxPath(`/timeboxes/milestones/${id}`, params), { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: ID, params: string) =>
    apiSite<void>(scopedTimeboxPath(`/timeboxes/milestones/${id}`, params), { method: "DELETE" }),
};

// Pages: app/components/ArtefactInlineForm/* (Owner dropdown)
// ─── Lookups — scope-bound reference data  (/lookups) ────────────────────────

export interface UserInScope {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export const lookups = {
  usersInScope: () =>
    apiSite<{ users: UserInScope[]; count: number }>(`/lookups/users-in-scope`),
};

// Pages: app/lib/topologyApi.ts (shared helper), app/(user)/topology/page.tsx,
//        app/components/topology/ (DiagramCanvas nodes)
// ─── Topology  (/topology) ───────────────────────────────────────────────────

// Wire shape mirrors the Go Node struct in backend/internal/topology/types.go.
// The handler returns the full row (PLA-0044 — rich fields + sort_order +
// archive metadata) so the canvas can render layout/colour/icon without a
// second round-trip. Form callers only need id/parent_id/name/label_override
// but the rest is included so the type stays in lockstep with the backend.
export interface OrgNode {
  id: ID;
  subscription_id?: ID;
  parent_id: ID | null;
  name: string;
  description?: string;
  label_override: string | null;
  icon: string | null;
  colour: string | null;
  avatar_url?: string | null;
  position?: number;
  archived_at: ISODate | null;
  archived_descendant_count?: number;
  created_at?: ISODate;
  updated_at?: ISODate;
}

export const topology = {
  // GET /_site/topology/tree[?root=<id>]
  // Backend resolves workspace via JWT clamp (WorkspaceClampMiddleware) and
  // narrows the result by the active topology scope via the ?meg= forwarder
  // in app/lib/api.ts. Empty topology → [], not 500.
  // Wire shape is a BARE ARRAY of OrgNode — no { nodes: [] } envelope.
  tree: (rootId?: ID) =>
    apiSite<OrgNode[]>(rootId ? `/topology/tree?root=${rootId}` : "/topology/tree"),

  ancestors: (nodeId: ID) =>
    apiSite<OrgNode[]>(`/topology/nodes/${nodeId}/ancestors`),

  archivedDescendants: (nodeId: ID) =>
    apiSite<{ nodes: OrgNode[] }>(`/topology/nodes/${nodeId}/archived-descendants`),

  previewMove: (params: string) =>
    apiSite<unknown>(`/topology/preview-move?${params}`),

  disconnected: () =>
    apiSite<{ nodes: OrgNode[] }>("/topology/disconnected"),

  commitStatus: () =>
    apiSite<unknown>("/topology/commit"),

  putViewState: (data: unknown) =>
    apiSite<void>("/topology/view-state", { method: "PUT", body: JSON.stringify(data) }),

  createNode: (data: unknown) =>
    apiSite<OrgNode>("/topology/nodes", { method: "POST", body: JSON.stringify(data) }),

  patchNode: (id: ID, data: unknown) =>
    apiSite<OrgNode>(`/topology/nodes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  archiveNode: (id: ID) =>
    apiSite<void>(`/topology/nodes/${id}`, { method: "DELETE" }),

  disconnectNode: (id: ID) =>
    apiSite<void>(`/topology/nodes/${id}/disconnect`, { method: "POST" }),

  duplicateNode: (id: ID, data?: unknown) =>
    apiSite<OrgNode>(`/topology/nodes/${id}/duplicate`, { method: "POST", body: JSON.stringify(data ?? {}) }),

  restoreNode: (id: ID) =>
    apiSite<void>(`/topology/nodes/${id}/restore`, { method: "POST" }),

  bulkPosition: (data: unknown) =>
    apiSite<void>("/topology/nodes/bulk-position", { method: "POST", body: JSON.stringify(data) }),

  grantRole: (nodeId: ID, data: unknown) =>
    apiSite<void>(`/topology/nodes/${nodeId}/roles`, { method: "POST", body: JSON.stringify(data) }),

  revokeRole: (grantId: ID) =>
    apiSite<void>(`/topology/roles/${grantId}`, { method: "DELETE" }),

  commit: () =>
    apiSite<void>("/topology/commit", { method: "POST" }),

  reset: () =>
    apiSite<void>("/topology/reset", { method: "POST" }),
};

// Pages: app/(user)/admin/roles/page.tsx (gadmin role management),
//        app/(user)/user-management/page.tsx (role assignment to users),
//        app/(user)/topology/ (node role grants)
// ─── Roles  (/roles) ─────────────────────────────────────────────────────────

export const roles = {
  list: () =>
    apiSite<{ roles: unknown[] }>("/roles/"),

  listCreatable: () =>
    apiSite<{ roles: unknown[] }>("/roles/creatable"),

  listPermissionsCatalogue: () =>
    apiSite<{ permissions: unknown[] }>("/roles/permissions/catalogue"),

  get: (id: ID) =>
    apiSite<unknown>(`/roles/${id}`),

  create: (data: unknown) =>
    apiSite<unknown>("/roles/", { method: "POST", body: JSON.stringify(data) }),

  update: (id: ID, data: unknown) =>
    apiSite<unknown>(`/roles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  archive: (id: ID) =>
    apiSite<void>(`/roles/${id}`, { method: "DELETE" }),

  listPermissions: (id: ID) =>
    apiSite<{ permissions: unknown[] }>(`/roles/${id}/permissions`),

  assignPermissions: (id: ID, data: unknown) =>
    apiSite<void>(`/roles/${id}/permissions`, { method: "POST", body: JSON.stringify(data) }),

  revokePermissions: (id: ID, data: unknown) =>
    apiSite<void>(`/roles/${id}/permissions`, { method: "DELETE", body: JSON.stringify(data) }),
};

// Pages: app/lib/reportError.ts (shared helper — called from any component on unhandled error)
// ─── Errors  (/errors) ───────────────────────────────────────────────────────

export const errors = {
  report: (data: unknown) =>
    apiSite<void>("/errors/report", { method: "POST", body: JSON.stringify(data) }),
};

// Pages: app/(user)/library-releases/page.tsx, app/contexts/LibraryReleasesContext.tsx
// ─── Library releases  (/library/releases) ───────────────────────────────────

export const libraryReleases = {
  list: () =>
    apiSite<{ releases: unknown[] }>("/library/releases/"),

  count: () =>
    apiSite<{ count: number }>("/library/releases/count"),

  ack: (id: ID) =>
    apiSite<void>(`/library/releases/${id}/ack`, { method: "POST" }),
};

// Pages: app/components/Panel.tsx + app/components/Header.tsx (register/reconcile on mount),
//        dev/pages/DevPageHelpPanel.tsx (admin helpable toggle + page-help CRUD),
//        app/help/[id]/page.tsx (getPageHelp read)
// ─── Addressables + page help  (/addressables, /page-help) ──────────────────

export const addressables = {
  buildReconcile: (data: unknown) =>
    apiSite<void>("/addressables/build-reconcile", { method: "POST", body: JSON.stringify(data) }),

  register: (data: unknown) =>
    apiSite<void>("/addressables/register", { method: "POST", body: JSON.stringify(data) }),

  snapshot: () =>
    apiSite<unknown>("/addressables/snapshot"),

  getPageHelp: (addressableId: string) =>
    apiSite<unknown>(`/page-help/${encodeURIComponent(addressableId)}`),

  adminListPageHelp: () =>
    apiSite<unknown>("/page-help/admin/"),

  adminPutPageHelp: (addressableId: string, data: unknown) =>
    apiSite<void>(`/page-help/admin/${encodeURIComponent(addressableId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  adminDeletePageHelp: (addressableId: string) =>
    apiSite<void>(`/page-help/admin/${encodeURIComponent(addressableId)}`, { method: "DELETE" }),

  adminUpdateHelpable: (id: ID, data: unknown) =>
    apiSite<void>(`/addressables/admin/${id}/helpable`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// Pages: app/components/MentionPicker.tsx, app/components/MentionToolbarButton.tsx
// ─── Mentions  (/mentions) ───────────────────────────────────────────────────

export interface Mentionable {
  user_id: ID;
  email: string;
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface MentionRow {
  users_mentions_id: ID;
  users_mentions_id_subscription: ID;
  users_mentions_id_workspace: ID;
  users_mentions_id_user_author: ID;
  users_mentions_id_user_mentioned: ID;
  users_mentions_context_kind: string;
  users_mentions_context_id: string;
  users_mentions_context_label: string;
  users_mentions_snippet: string;
  users_mentions_created_at: string;
  users_mentions_read_at?: string | null;
}

export interface CreateMentionBody {
  mentioned_user_ids: ID[];
  context_kind: string;
  context_id: string;
  snippet?: string;
}

export const mentions = {
  search: (q: string, limit = 10) =>
    apiSite<{ mentionables: Mentionable[]; count: number }>(
      `/mentions/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  create: (data: CreateMentionBody) =>
    apiSite<{ mentions: MentionRow[]; count: number }>("/mentions/", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  inbox: (onlyUnread = false, limit = 50) =>
    apiSite<{ mentions: MentionRow[]; count: number }>(
      `/mentions/inbox?only_unread=${onlyUnread ? "true" : "false"}&limit=${limit}`,
    ),

  markRead: (id: ID) =>
    apiSite<void>(`/mentions/${id}/read`, { method: "POST" }),
};

// Pages: app/components/NotificationBell.tsx, app/hooks/useNotificationsStream.ts
// ─── Notifications  (/notifications) ─────────────────────────────────────────

export interface UserNotification {
  users_notifications_id: ID;
  users_notifications_id_subscription: ID;
  users_notifications_id_user: ID;
  users_notifications_kind: string;
  users_notifications_title: string;
  users_notifications_body: string;
  users_notifications_context_kind?: string | null;
  users_notifications_context_id?: string | null;
  users_notifications_context_label?: string | null;
  users_notifications_created_at: string;
  users_notifications_read_at?: string | null;
}

export interface NotificationPref {
  kind: string;
  channel: "in_app" | "email" | "sse";
  enabled: boolean;
}

export const notifications = {
  list: (onlyUnread = false, limit = 50) =>
    apiSite<{ notifications: UserNotification[]; count: number }>(
      `/notifications/?only_unread=${onlyUnread ? "true" : "false"}&limit=${limit}`,
    ),

  unreadCount: () =>
    apiSite<{ unread: number }>("/notifications/unread-count"),

  // Mutation helpers dispatch a `notifications:changed` window event
  // on success so subscribers (the rail bell badge in particular)
  // refetch immediately instead of waiting up to 60s for the next
  // poll cycle. Listeners are wired in IconRail.
  markRead: async (id: ID) => {
    const out = await apiSite<void>(`/notifications/${id}/read`, { method: "POST" });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("notifications:changed"));
    }
    return out;
  },

  markAllRead: async () => {
    const out = await apiSite<{ marked_read: number }>("/notifications/read-all", { method: "POST" });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("notifications:changed"));
    }
    return out;
  },

  listPrefs: () =>
    apiSite<{ prefs: NotificationPref[]; count: number }>("/notifications/prefs"),

  upsertPref: (kind: string, channel: NotificationPref["channel"], enabled: boolean) =>
    apiSite<void>("/notifications/prefs", {
      method: "PUT",
      body: JSON.stringify({ kind, channel, enabled }),
    }),
};

// Pages: app/user/notifications/settings/page.tsx
// ─── Notification rules  (/notifications/rules + /rule-schema) ───────────────

export type RuleOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "contains"
  | "changed"
  | "changed_from"
  | "changed_to"
  | "was"
  | "was_not"
  | "was_in"
  | "was_not_in";

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: unknown;
}

export interface NotificationRule {
  users_notification_rules_id: ID;
  users_notification_rules_id_subscription: ID;
  users_notification_rules_id_user?: ID | null;
  users_notification_rules_id_workspace?: ID | null;
  users_notification_rules_name: string;
  users_notification_rules_type: string;
  // Artefact-type NAME (e.g. "Defect") not a UUID. Mig 237 shifted
  // the semantics so rules are unambiguous within a workspace.
  users_notification_rules_target?: string | null;
  users_notification_rules_conditions: RuleCondition[];
  users_notification_rules_enabled: boolean;
  users_notification_rules_created_at: string;
  users_notification_rules_updated_at: string;
}

export interface RuleTypeEntry {
  value: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface RuleTargetEntry {
  value: string;
  label: string;
}

export interface RuleOperatorEntry {
  value: RuleOperator;
  label: string;
  needs_value: boolean;
}

export interface RuleFieldEntry {
  value: string;
  label: string;
  value_type:
    | "boolean"
    | "date"
    | "decimal"
    | "integer"
    | "multiselect"
    | "richtext"
    | "select"
    | "textbox"
    | "user";
  operators: RuleOperatorEntry[];
  options?: Array<{ value: string; label: string }>;
}

export const notificationRules = {
  list: () =>
    apiSite<{ rules: NotificationRule[]; count: number }>("/notifications/rules/"),

  get: (id: ID) =>
    apiSite<NotificationRule>(`/notifications/rules/${id}`),

  create: (body: {
    name: string;
    type: string;
    workspace_id: string;
    target?: string;
    conditions: RuleCondition[];
  }) =>
    apiSite<NotificationRule>("/notifications/rules/", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  update: (
    id: ID,
    body: { name?: string; conditions?: RuleCondition[]; enabled?: boolean },
  ) =>
    apiSite<NotificationRule>(`/notifications/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  delete: (id: ID) =>
    apiSite<void>(`/notifications/rules/${id}`, { method: "DELETE" }),

  // Schema endpoints — drive the rule builder dropdowns. All artefact
  // queries beyond schemaTypes require workspace_id; the catalogue is
  // workspace-scoped (one "Defect" per workspace with its own fields).
  schemaTypes: () =>
    apiSite<{ types: RuleTypeEntry[] }>("/notifications/rule-schema"),

  schemaTargets: (type: string, workspaceId: string) =>
    apiSite<{ targets: RuleTargetEntry[] }>(
      `/notifications/rule-schema?type=${encodeURIComponent(type)}&workspace_id=${encodeURIComponent(workspaceId)}`,
    ),

  schemaFields: (type: string, workspaceId: string, target: string) =>
    apiSite<{ fields: RuleFieldEntry[] }>(
      `/notifications/rule-schema?type=${encodeURIComponent(type)}&workspace_id=${encodeURIComponent(workspaceId)}&target=${encodeURIComponent(target)}`,
    ),
};

// Pages: app/components/FlowBoard/hooks/useFlowBoardData.ts
// ─── Flow board  (/flowboard) ────────────────────────────────────────────────
// Backend: backend/internal/flowboard/handler.go (FB1.2.2)

/** Wire shape returned by GET /_site/flowboard/wip */
export interface FlowBoardWipRow {
  flow_state_id: string;
  flow_state_name: string;
  /** null = unlimited (no cap). */
  limit: number | null;
  updated_at: string;
  updated_by: string | null;
}

export const flowBoard = {
  /**
   * GET /_site/flowboard/wip?node_id={topologyNodeId}&artefact_type_id={artefactTypeId}
   * Returns WIP-limit rows for the given topology node + artefact type.
   * Sentinel-clamped server-side; missing clamp → 403.
   */
  listWip: (topologyNodeId: ID, artefactTypeId: ID) =>
    apiSite<FlowBoardWipRow[]>(
      `/flowboard/wip?node_id=${encodeURIComponent(topologyNodeId)}&artefact_type_id=${encodeURIComponent(artefactTypeId)}`
    ),

  /**
   * PUT /_site/flowboard/wip
   * Upsert a WIP limit for a single (node, flow_state) pair.
   * limit === null clears the cap (unlimited semantics per spec §3.2).
   */
  upsertWip: (body: {
    node_id: ID;
    flow_state_id: ID;
    limit: number | null;
  }) =>
    apiSite<FlowBoardWipRow>("/flowboard/wip", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  /**
   * GET /_site/flowboard/prefs?artefact_type_id={id}
   * Returns the calling user's card-field preferences for the given artefact
   * type. 404 when no prefs saved → caller falls back to sidecar defaults.
   */
  getCardPrefs: (artefactTypeId: ID) =>
    apiSite<{ artefact_type_id: ID; card_fields: string[]; updated_at: string }>(
      `/flowboard/prefs?artefact_type_id=${encodeURIComponent(artefactTypeId)}`
    ),

  /**
   * PUT /_site/flowboard/prefs
   * Upsert the calling user's card-field preferences for one artefact type.
   */
  upsertCardPrefs: (body: { artefact_type_id: ID; card_fields: string[] }) =>
    apiSite<{ artefact_type_id: ID; card_fields: string[]; updated_at: string }>(
      "/flowboard/prefs",
      { method: "PUT", body: JSON.stringify(body) }
    ),

  /**
   * PUT /_site/flowboard/wip (alias used by WipSettingsModal — same endpoint
   * as upsertWip but named to match the story spec's AC wording).
   * Upserts a WIP limit for a single (node, flow_state) pair.
   * 403 when caller is not in topology_nodes_members for the node.
   */
  putWip: (body: {
    nodeId: ID;
    flowStateId: ID;
    limit: number | null;
  }) =>
    apiSite<FlowBoardWipRow>("/flowboard/wip", {
      method: "PUT",
      body: JSON.stringify({
        node_id: body.nodeId,
        flow_state_id: body.flowStateId,
        limit: body.limit,
      }),
    }),
};

// Pages: app/components/FlowBoard/hooks/useNodeMembership.ts
// ─── Topology members  (/topology/{nodeId}/members) ──────────────────────────
// FB1.2.4 — returns member rows for a topology node. Sentinel-clamped.

/** Wire shape for a single member row returned by GET /_site/topology/{id}/members */
export interface TopologyNodeMember {
  user_id: ID;
  role: string;
  created_at: ISODate;
}

export const topologyMembers = {
  /**
   * GET /_site/topology/{nodeId}/members
   * Returns the list of users who have an explicit row in
   * topology_nodes_members for the given node.
   * Sentinel-clamped — 403 when caller has no access to the node.
   */
  listNodeMembers: (nodeId: ID) =>
    apiSite<TopologyNodeMember[]>(
      `/topology/${encodeURIComponent(nodeId)}/members`
    ),
};

// PLA074 / B23.2.3 — artefact dependency maps client. Module lives in
// its own file (app/lib/apiSite/dependencies.ts) so it can grow
// without inflating this barrel; re-exported here so existing
// `import { dependencies } from "@/app/lib/apiSite"` callers work.
export {
  dependencies,
  type DependencyMap,
  type DependencyEdge,
  type DependencyEdgeKind,
  type DependencyBucketEdge,
  type DependencyBucketProjection,
  type DependencyCandidate,
  type DependencyImpactReport,
  type DependencyImpactConflict,
  type DependencyReachableNode,
  type DependencyTransitiveImpactReport,
} from "@/app/lib/apiSite/dependencies";
