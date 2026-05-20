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
 *                        pinBookmark, unpinBookmark, checkBookmark, listEntities,
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
 *                        listChildren, getFieldValues, upsertFieldValues, deleteFieldValue
 *   portfolioItems     — list, get, create, patch, archive, bulk, summary, listFlowStates,
 *                        listChildren, getFieldValues, upsertFieldValues, deleteFieldValue
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
 *   addressables       — buildReconcile, register, snapshot, getPageHelp, adminListPageHelp,
 *                        adminPutPageHelp, adminDeletePageHelp, adminUpdateHelpable
 */

import { apiSite } from "@/app/lib/api";

// ─── Shared primitives ────────────────────────────────────────────────────────

export type ID = string;
export type ISODate = string;

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

  pinBookmark: (entityKind: string, entityId: ID) =>
    apiSite<void>("/nav/bookmark", {
      method: "POST",
      body: JSON.stringify({ entity_kind: entityKind, entity_id: entityId }),
    }),

  unpinBookmark: (entityKind: string, entityId: ID) =>
    apiSite<void>("/nav/bookmark", {
      method: "DELETE",
      body: JSON.stringify({ entity_kind: entityKind, entity_id: entityId }),
    }),

  checkBookmark: (entityKind: string, entityId: ID) =>
    apiSite<{ pinned: boolean }>(`/nav/bookmark/check?entity_kind=${entityKind}&entity_id=${entityId}`),

  listEntities: () =>
    apiSite<{ entities: unknown[] }>("/nav/entities"),

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

  bulk: (data: unknown) =>
    apiSite<unknown>("/work-items/bulk", { method: "POST", body: JSON.stringify(data) }),

  summary: (params?: string) =>
    apiSite<unknown>(params ? `/work-items/summary?${params}` : "/work-items/summary"),

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
    apiSite<unknown>(params ? `/portfolio-items/summary?${params}` : "/portfolio-items/summary"),

  listFlowStates: (params: string) =>
    apiSite<{ flow_states: unknown[] }>(`/portfolio-items/flow-states?${params}`),

  listChildren: (id: ID) =>
    apiSite<{ items: unknown[] }>(`/portfolio-items/${id}/children`),

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

export const sprints = {
  list: (params?: string) =>
    apiSite<{ sprints: Timebox[] }>(params ? `/timeboxes/sprints?${params}` : "/timeboxes/sprints/"),

  get: (id: ID) =>
    apiSite<Timebox>(`/timeboxes/sprints/${id}`),

  create: (data: unknown) =>
    apiSite<Timebox>("/timeboxes/sprints/", { method: "POST", body: JSON.stringify(data) }),

  bulkCreate: (data: unknown) =>
    apiSite<{ sprints: Timebox[] }>("/timeboxes/sprints/bulk-create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: ID, data: unknown) =>
    apiSite<Timebox>(`/timeboxes/sprints/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  delete: (id: ID) =>
    apiSite<void>(`/timeboxes/sprints/${id}`, { method: "DELETE" }),

  start: (id: ID) =>
    apiSite<void>(`/timeboxes/sprints/${id}/start`, { method: "POST" }),

  close: (id: ID) =>
    apiSite<void>(`/timeboxes/sprints/${id}/close`, { method: "POST" }),
};

// Pages: app/components/TimeboxManager.tsx, app/hooks/useTimebox.ts
// ─── Timeboxes — Releases  (/timeboxes/releases) ─────────────────────────────

export const releases = {
  list: (params?: string) =>
    apiSite<{ releases: Timebox[] }>(params ? `/timeboxes/releases?${params}` : "/timeboxes/releases/"),

  get: (id: ID) =>
    apiSite<Timebox>(`/timeboxes/releases/${id}`),

  create: (data: unknown) =>
    apiSite<Timebox>("/timeboxes/releases/", { method: "POST", body: JSON.stringify(data) }),

  bulkCreate: (data: unknown) =>
    apiSite<{ releases: Timebox[] }>("/timeboxes/releases/bulk-create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: ID, data: unknown) =>
    apiSite<Timebox>(`/timeboxes/releases/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  delete: (id: ID) =>
    apiSite<void>(`/timeboxes/releases/${id}`, { method: "DELETE" }),
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
  list: (params?: string) =>
    apiSite<{ milestones: Milestone[]; count: number }>(
      params ? `/timeboxes/milestones?${params}` : "/timeboxes/milestones/",
    ),

  get: (id: ID) => apiSite<Milestone>(`/timeboxes/milestones/${id}`),

  create: (data: unknown) =>
    apiSite<Milestone>("/timeboxes/milestones/", { method: "POST", body: JSON.stringify(data) }),

  update: (id: ID, data: unknown) =>
    apiSite<Milestone>(`/timeboxes/milestones/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: ID) =>
    apiSite<void>(`/timeboxes/milestones/${id}`, { method: "DELETE" }),
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

  markRead: (id: ID) =>
    apiSite<void>(`/notifications/${id}/read`, { method: "POST" }),

  markAllRead: () =>
    apiSite<{ marked_read: number }>("/notifications/read-all", { method: "POST" }),

  listPrefs: () =>
    apiSite<{ prefs: NotificationPref[]; count: number }>("/notifications/prefs"),

  upsertPref: (kind: string, channel: NotificationPref["channel"], enabled: boolean) =>
    apiSite<void>("/notifications/prefs", {
      method: "PUT",
      body: JSON.stringify({ kind, channel, enabled }),
    }),
};
